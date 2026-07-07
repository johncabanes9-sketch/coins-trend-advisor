import { ema, rsi, macd } from "./indicators/index.js";
import type { Kline, AssetClass } from "./types.js";

export const STRUCTURE_LOOKBACK = 20;
const MIN_CANDLES = 200;
const ATR_PERIOD = 14;
const ATR_AVG_WINDOW = 20;

export interface SwingSnapshot {
  symbol: string;
  assetClass: AssetClass;
  lastClose: number;
  ema50: number;
  ema200: number;
  priceVsEma: "above_both" | "below_both" | "between";
  structure: "uptrend" | "downtrend" | "sideways";
  rsi: number;
  macdHistogram: number;
  momentum: "bullish" | "bearish" | "neutral";
  trendMomentumAgree: boolean;
  divergence: boolean;
  atr14: number;
  atr20Avg: number;
  volatilitySpike: boolean;
  candleCount: number;
}

function atrSeries(klines: Kline[]): number[] {
  const tr: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const h = klines[i]!.high;
    const l = klines[i]!.low;
    const pc = klines[i - 1]!.close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const out: number[] = [];
  if (tr.length < ATR_PERIOD) return out;
  let seed = 0;
  for (let i = 0; i < ATR_PERIOD; i++) seed += tr[i]!;
  seed /= ATR_PERIOD;
  out.push(seed);
  for (let i = ATR_PERIOD; i < tr.length; i++) {
    out.push((out[out.length - 1]! * (ATR_PERIOD - 1) + tr[i]!) / ATR_PERIOD);
  }
  return out;
}

function classifyStructure(klines: Kline[]): "uptrend" | "downtrend" | "sideways" {
  const n = klines.length;
  const w = STRUCTURE_LOOKBACK;
  const recent = klines.slice(n - w);
  const prior = klines.slice(n - 2 * w, n - w);
  const recentHigh = Math.max(...recent.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));
  const priorHigh = Math.max(...prior.map((c) => c.high));
  const priorLow = Math.min(...prior.map((c) => c.low));
  if (recentHigh > priorHigh && recentLow > priorLow) return "uptrend";
  if (recentHigh < priorHigh && recentLow < priorLow) return "downtrend";
  return "sideways";
}

export function buildSnapshot(
  symbol: string,
  assetClass: AssetClass,
  klines: Kline[],
): SwingSnapshot | { status: "insufficient_data" } {
  if (klines.length < MIN_CANDLES) return { status: "insufficient_data" };

  const closes = klines.map((c) => c.close);
  const lastIdx = closes.length - 1;
  const lastClose = closes[lastIdx]!;
  const ema50 = ema(closes, 50)[lastIdx]!;
  const ema200 = ema(closes, 200)[lastIdx]!;

  const priceVsEma =
    lastClose > ema50 && lastClose > ema200
      ? "above_both"
      : lastClose < ema50 && lastClose < ema200
        ? "below_both"
        : "between";

  const structure = classifyStructure(klines);

  const rsiSeries = rsi(closes, 14);
  const rsiVal = rsiSeries[lastIdx] ?? 50;
  const macdHistogram = macd(closes, 12, 26, 9).histogram[lastIdx] ?? 0;

  const momentum =
    rsiVal > 50 && macdHistogram > 0
      ? "bullish"
      : rsiVal < 50 && macdHistogram < 0
        ? "bearish"
        : "neutral";

  const trendMomentumAgree =
    (structure === "uptrend" && momentum === "bullish") ||
    (structure === "downtrend" && momentum === "bearish");

  // Divergence over the last STRUCTURE_LOOKBACK closes.
  const winStart = lastIdx - STRUCTURE_LOOKBACK + 1;
  let hiIdx = winStart;
  let loIdx = winStart;
  for (let i = winStart; i <= lastIdx; i++) {
    if (closes[i]! > closes[hiIdx]!) hiIdx = i;
    if (closes[i]! < closes[loIdx]!) loIdx = i;
  }
  const rsiStart = rsiSeries[winStart] ?? 50;
  const bearishDiv = hiIdx === lastIdx && rsiVal < rsiStart;
  const bullishDiv = loIdx === lastIdx && rsiVal > rsiStart;
  const divergence = bearishDiv || bullishDiv;

  const atr = atrSeries(klines);
  const atr14 = atr[atr.length - 1] ?? 0;
  const tail = atr.slice(Math.max(0, atr.length - ATR_AVG_WINDOW));
  const atr20Avg = tail.length > 0 ? tail.reduce((a, b) => a + b, 0) / tail.length : 0;
  const volatilitySpike = atr20Avg > 0 && atr14 > 1.5 * atr20Avg;

  return {
    symbol,
    assetClass,
    lastClose,
    ema50,
    ema200,
    priceVsEma,
    structure,
    rsi: rsiVal,
    macdHistogram,
    momentum,
    trendMomentumAgree,
    divergence,
    atr14,
    atr20Avg,
    volatilitySpike,
    candleCount: klines.length,
  };
}
