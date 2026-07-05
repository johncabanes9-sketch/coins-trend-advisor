// core/test/signal.test.ts
import { describe, it, expect } from "vitest";
import { generateSignal } from "../src/signal.js";
import type { Kline } from "../src/types.js";
import { DISCLAIMER } from "../src/types.js";

function kline(close: number, t: number): Kline {
  return {
    openTime: t,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    closeTime: t + 1,
  };
}

describe("generateSignal", () => {
  it("reports insufficient data below the candle floor", () => {
    const candles = Array.from({ length: 10 }, (_, i) => kline(100 + i, i));
    const res = generateSignal("BTCPHP", candles);
    expect(res).toEqual({ pair: "BTCPHP", status: "insufficient_data" });
  });

  it("produces a bullish trend on an accelerating uptrend", () => {
    // Use a convex (accelerating) uptrend, not a linear ramp. On a perfectly
    // linear ramp RSI pins to 100 (a *bearish* overbought vote) and the MACD
    // histogram collapses to floating-point noise (~-1e-15, a spurious bearish
    // vote), so the four equal-weight votes net out to "sell" — a degenerate
    // artifact, not a real signal. A convex series keeps MACD solidly positive
    // so EMA(12>26) + MACD outvote the RSI-overbought reading -> a genuine buy.
    const candles = Array.from({ length: 60 }, (_, i) =>
      kline(100 + 0.05 * i * i, i * 1000),
    );
    const res = generateSignal("BTCPHP", candles);
    if ("status" in res) throw new Error("expected a Signal");
    expect(["buy", "strong_buy"]).toContain(res.trend);
    expect(res.confidence).toBeGreaterThan(0);
    expect(res.confidence).toBeLessThanOrEqual(1);
    expect(res.disclaimer).toBe(DISCLAIMER);
    expect(res.asOf).toBe(new Date(candles[candles.length - 1]!.closeTime).toISOString());
    expect(res.indicators.emaCrossover).toBe("bullish");
  });
});
