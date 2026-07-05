// core/src/signal.ts
import { rsi, macd, bollinger, ema } from "./indicators/index.js";
import {
  DISCLAIMER,
  type Kline,
  type Signal,
  type Trend,
  type Vote,
  type IndicatorSnapshot,
} from "./types.js";

const MIN_CANDLES = 35;

export function generateSignal(
  pair: string,
  candles: Kline[],
):
  | Signal
  | { pair: string; status: "insufficient_data" } {
  if (candles.length < MIN_CANDLES) {
    return { pair, status: "insufficient_data" };
  }

  const closes = candles.map((c) => c.close);
  const lastIdx = closes.length - 1;
  const lastClose = closes[lastIdx]!;

  const rsiSeries = rsi(closes, 14);
  const rsiVal = rsiSeries[lastIdx] ?? 50;

  const ema12 = ema(closes, 12)[lastIdx];
  const ema26 = ema(closes, 26)[lastIdx];
  const emaCrossover: IndicatorSnapshot["emaCrossover"] =
    ema12 !== null && ema26 !== null
      ? ema12 > ema26
        ? "bullish"
        : ema12 < ema26
          ? "bearish"
          : "none"
      : "none";

  const macdRes = macd(closes, 12, 26, 9);
  const hist = macdRes.histogram[lastIdx] ?? 0;

  const bb = bollinger(closes, 20, 2);
  const upper = bb.upper[lastIdx];
  const lower = bb.lower[lastIdx];
  const bollingerPos: IndicatorSnapshot["bollinger"] =
    lower !== null && lastClose <= lower
      ? "lower"
      : upper !== null && lastClose >= upper
        ? "upper"
        : "mid";

  // Votes
  const votes: { vote: Vote; reason: string }[] = [];
  votes.push(
    rsiVal < 30
      ? { vote: "bullish", reason: `RSI oversold at ${rsiVal.toFixed(1)}` }
      : rsiVal > 70
        ? { vote: "bearish", reason: `RSI overbought at ${rsiVal.toFixed(1)}` }
        : { vote: "neutral", reason: "" },
  );
  votes.push(
    emaCrossover === "bullish"
      ? { vote: "bullish", reason: "EMA(12) above EMA(26)" }
      : emaCrossover === "bearish"
        ? { vote: "bearish", reason: "EMA(12) below EMA(26)" }
        : { vote: "neutral", reason: "" },
  );
  votes.push(
    hist > 0
      ? { vote: "bullish", reason: "MACD histogram positive" }
      : hist < 0
        ? { vote: "bearish", reason: "MACD histogram negative" }
        : { vote: "neutral", reason: "" },
  );
  votes.push(
    bollingerPos === "lower"
      ? { vote: "bullish", reason: "price at lower Bollinger Band" }
      : bollingerPos === "upper"
        ? { vote: "bearish", reason: "price at upper Bollinger Band" }
        : { vote: "neutral", reason: "" },
  );

  const bullish = votes.filter((v) => v.vote === "bullish").length;
  const bearish = votes.filter((v) => v.vote === "bearish").length;
  const neutral = votes.filter((v) => v.vote === "neutral").length;
  const score = bullish - bearish;

  const trend: Trend =
    score >= 3
      ? "strong_buy"
      : score >= 1
        ? "buy"
        : score === 0
          ? "hold"
          : score <= -3
            ? "strong_sell"
            : "sell";

  const confidence = Math.max(bullish, bearish, neutral) / 4;

  const fragments = votes.map((v) => v.reason).filter((r) => r.length > 0);
  const reasoning =
    fragments.length > 0
      ? fragments.join(", ")
      : "No indicator extremes; mixed/neutral conditions";

  const indicators: IndicatorSnapshot = {
    rsi: rsiVal,
    emaCrossover,
    macd: hist,
    bollinger: bollingerPos,
  };

  return {
    pair,
    trend,
    confidence,
    reasoning,
    indicators,
    asOf: new Date(candles[lastIdx]!.closeTime).toISOString(),
    disclaimer: DISCLAIMER,
  };
}
