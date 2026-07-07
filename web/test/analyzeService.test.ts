import { describe, it, expect } from "vitest";
import { AnalyzeService } from "../src/analyzeService.js";
import { DEFAULT_RISK_CONFIG, type AccountState } from "@coins-trend-advisor/core";
import type { Kline } from "@coins-trend-advisor/core";
import type { KlineCache, KlinesResult } from "../src/klineCache.js";

function k(close: number, t: number): Kline {
  return { openTime: t, open: close, high: close + 1, low: close - 1, close, volume: 1, closeTime: t + 1 };
}
function uptrend(n = 240): Kline[] {
  return Array.from({ length: n }, (_, i) => k(100 + 0.02 * i * i, i * 1000));
}
function fakeCache(result: KlinesResult): KlineCache {
  return { getKlines: async () => result } as unknown as KlineCache;
}
const account: AccountState = {
  equity: 100000, position: null, lossToDate: { dayPct: 0, weekPct: 0 }, marketStatus: "open",
};

describe("AnalyzeService", () => {
  it("assembles a BUY signal from fixture klines", async () => {
    const svc = new AnalyzeService({ cache: fakeCache({ status: "ok", klines: uptrend() }), risk: DEFAULT_RISK_CONFIG });
    const s = await svc.analyze("crypto", "BTCPHP", "1d", account);
    expect(s.action).toBe("BUY");
    expect(s.entry_price).not.toBeNull();
  });
  it("returns a safe HOLD when klines error", async () => {
    const svc = new AnalyzeService({ cache: fakeCache({ status: "error", message: "boom" }), risk: DEFAULT_RISK_CONFIG });
    const s = await svc.analyze("crypto", "BTCPHP", "1d", account);
    expect(s.action).toBe("HOLD");
    expect(s.confidence).toBe(0);
    expect(s.risk_flags).toContain("insufficient data");
  });
  it("returns a safe HOLD when there are too few candles", async () => {
    const svc = new AnalyzeService({ cache: fakeCache({ status: "ok", klines: uptrend(50) }), risk: DEFAULT_RISK_CONFIG });
    const s = await svc.analyze("crypto", "BTCPHP", "1d", account);
    expect(s.action).toBe("HOLD");
    expect(s.risk_flags).toContain("insufficient data");
  });
});
