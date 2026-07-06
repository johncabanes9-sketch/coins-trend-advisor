import { describe, it, expect } from "vitest";
import { SignalService } from "../src/signalService.js";
import type { KlineCache, KlinesResult } from "../src/klineCache.js";
import type { Kline } from "@coins-trend-advisor/core";
import { DISCLAIMER } from "@coins-trend-advisor/core";

function candles(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000, open: 100 + i, high: 100 + i, low: 100 + i,
    close: 100 + i, volume: 1, closeTime: i * 1000 + 1,
  }));
}

function fakeCache(result: KlinesResult): KlineCache {
  return {
    getKlines: async () => result,
    getMany: async () => [result],
  } as unknown as KlineCache;
}

describe("SignalService", () => {
  it("computes an ok signal from cached klines", async () => {
    const svc = new SignalService({ cache: fakeCache({ status: "ok", klines: candles(60) }) });
    const r = await svc.get("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.symbol).toBe("BTCPHP");
    expect(r.assetClass).toBe("crypto");
    expect(r.signal.disclaimer).toBe(DISCLAIMER);
  });

  it("reports insufficient_data for a short series", async () => {
    const svc = new SignalService({ cache: fakeCache({ status: "ok", klines: candles(10) }) });
    const r = await svc.get("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("insufficient_data");
  });

  it("propagates a cache error", async () => {
    const svc = new SignalService({ cache: fakeCache({ status: "error", message: "boom" }) });
    const r = await svc.get("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("error");
    if (r.status !== "error") throw new Error("expected error");
    expect(r.message).toBe("boom");
  });

  it("carries stale markers through", async () => {
    const svc = new SignalService({
      cache: fakeCache({ status: "ok", klines: candles(60), stale: true, staleAsOf: "2020-01-01T00:00:00.000Z" }),
    });
    const r = await svc.get("crypto", "BTCPHP", "1h");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.stale).toBe(true);
    expect(r.staleAsOf).toBe("2020-01-01T00:00:00.000Z");
  });
});
