import { describe, it, expect } from "vitest";
import { buildSnapshot, type SwingSnapshot } from "../src/analysis.js";
import type { Kline } from "../src/types.js";

function k(close: number, t: number, high = close, low = close): Kline {
  return { openTime: t, open: close, high, low, close, volume: 1, closeTime: t + 1 };
}

// 240 candles, gentle convex uptrend; caller can override the tail.
function uptrend(n = 240): Kline[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + 0.02 * i * i;
    return k(c, i * 1000, c + 1, c - 1);
  });
}

describe("buildSnapshot", () => {
  it("reports insufficient data below 200 candles", () => {
    const res = buildSnapshot("BTCPHP", "crypto", uptrend(150));
    expect(res).toEqual({ status: "insufficient_data" });
  });

  it("classifies a convex uptrend as uptrend with bullish momentum", () => {
    const res = buildSnapshot("BTCPHP", "crypto", uptrend());
    if ("status" in res) throw new Error("expected a snapshot");
    expect(res.structure).toBe("uptrend");
    expect(res.priceVsEma).toBe("above_both");
    expect(res.momentum).toBe("bullish");
    expect(res.trendMomentumAgree).toBe(true);
    expect(res.candleCount).toBe(240);
    expect(res.atr14).toBeGreaterThan(0);
  });

  it("classifies a convex downtrend as downtrend with bearish momentum", () => {
    const candles = Array.from({ length: 240 }, (_, i) => {
      const c = 1252 - 0.02 * i * i; // accelerating decline: steepest at recent candles
      return k(c, i * 1000, c + 1, c - 1);
    });
    const res = buildSnapshot("BTCPHP", "crypto", candles);
    if ("status" in res) throw new Error("expected a snapshot");
    expect(res.structure).toBe("downtrend");
    expect(res.priceVsEma).toBe("below_both");
    expect(res.momentum).toBe("bearish");
  });

  it("computes ATR(14) matching a hand-computed value on a fixed series", () => {
    // Flat-then-known-range tail so ATR is predictable: constant TR = 4.
    const base = Array.from({ length: 220 }, (_, i) => k(100, i * 1000, 102, 98));
    const res = buildSnapshot("BTCPHP", "crypto", base);
    if ("status" in res) throw new Error("expected a snapshot");
    // Every candle close=100, high=102, low=98 -> TR = max(4, 2, 2) = 4.
    expect(res.atr14).toBeCloseTo(4, 6);
    expect(res.volatilitySpike).toBe(false);
  });

  it("flags a volatility spike when the latest ranges blow out", () => {
    const candles = Array.from({ length: 240 }, (_, i) => k(100, i * 1000, 101, 99));
    // Widen the last few candles' range dramatically.
    for (let i = 236; i < 240; i++) candles[i] = k(100, i * 1000, 140, 60);
    const res = buildSnapshot("BTCPHP", "crypto", candles);
    if ("status" in res) throw new Error("expected a snapshot");
    expect(res.volatilitySpike).toBe(true);
  });

  it("classifies a flat series as sideways", () => {
    const candles = Array.from({ length: 240 }, (_, i) => k(100, i * 1000, 101, 99));
    const res = buildSnapshot("BTCPHP", "crypto", candles);
    if ("status" in res) throw new Error("expected a snapshot");
    expect(res.structure).toBe("sideways");
    expect(res.momentum).toBe("neutral");
    expect(res.trendMomentumAgree).toBe(false);
  });

  it("produces a snapshot at exactly the 200-candle floor", () => {
    // 200 is the floor (buildSnapshot rejects < 200), so exactly 200 must yield
    // a snapshot with a finite EMA200 (seeded at the last index).
    const res = buildSnapshot("BTCPHP", "crypto", uptrend(200));
    if ("status" in res) throw new Error("expected a snapshot at exactly 200 candles");
    expect(res.candleCount).toBe(200);
    expect(Number.isFinite(res.ema200)).toBe(true);
  });

  it("flags divergence when price makes a new high but RSI fails to confirm", () => {
    // Phase 1 (0..199): a pure monotonic rise pins RSI to 100 at the window
    // start (candle 200). Phase 2 introduces small losses so RSI at the last
    // candle drops below that, while the final candle still prints the window's
    // highest close — textbook bearish divergence.
    const closes: number[] = [];
    for (let i = 0; i < 200; i++) closes.push(100 + i); // monotonic -> RSI 100 at winStart
    closes.push(400); // candle 200 (window start): jump up
    for (let i = 201; i < 219; i++) closes.push(400 - (i - 200) * 0.1); // slight decline -> losses
    closes.push(400.5); // candle 219: marginal new window high, RSI now below winStart
    const candles = closes.map((c, i) => k(c, i * 1000, c + 1, c - 1));
    const res = buildSnapshot("BTCPHP", "crypto", candles);
    if ("status" in res) throw new Error("expected a snapshot");
    expect(res.divergence).toBe(true);
  });
});
