import { describe, it, expect } from "vitest";
import { ForecastService } from "../src/forecastService.js";
import type { KlineCache, KlinesResult } from "../src/klineCache.js";
import type { Kline } from "@coins-trend-advisor/core";
import { DISCLAIMER } from "@coins-trend-advisor/core";

function ramp(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000, open: 100 + i, high: 100 + i, low: 100 + i,
    close: 100 + i, volume: 1, closeTime: i * 1000 + 1,
  }));
}

function fakeCache(result: KlinesResult): KlineCache {
  return { getKlines: async () => result, getMany: async () => [result] } as unknown as KlineCache;
}

describe("ForecastService", () => {
  it("computes a forecast over cached klines", async () => {
    const svc = new ForecastService({ cache: fakeCache({ status: "ok", klines: ramp(60) }) });
    const r = await svc.get("crypto", "BTCPHP", "1h", 5);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.symbol).toBe("BTCPHP");
    expect(r.assetClass).toBe("crypto");
    expect(r.forecast.horizon).toBe(5);
    expect(r.forecast.disclaimer).toBe(DISCLAIMER);
  });

  it("reports insufficient_data for a short series", async () => {
    const svc = new ForecastService({ cache: fakeCache({ status: "ok", klines: ramp(10) }) });
    const r = await svc.get("crypto", "BTCPHP", "1h", 5);
    expect(r.status).toBe("insufficient_data");
  });

  it("propagates a cache error", async () => {
    const svc = new ForecastService({ cache: fakeCache({ status: "error", message: "boom" }) });
    const r = await svc.get("crypto", "BTCPHP", "1h", 5);
    expect(r.status).toBe("error");
    if (r.status !== "error") throw new Error("expected error");
    expect(r.message).toBe("boom");
  });

  it("carries stale markers through", async () => {
    const svc = new ForecastService({
      cache: fakeCache({ status: "ok", klines: ramp(60), stale: true, staleAsOf: "2020-01-01T00:00:00.000Z" }),
    });
    const r = await svc.get("crypto", "BTCPHP", "1h", 5);
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.stale).toBe(true);
    expect(r.staleAsOf).toBe("2020-01-01T00:00:00.000Z");
  });

  it("getMany forecasts each entry over the shared cache", async () => {
    const cache = {
      getKlines: async () => ({ status: "ok", klines: ramp(60) }),
      getMany: async (entries: { assetClass: string; symbol: string }[]) =>
        entries.map(() => ({ status: "ok", klines: ramp(60) })),
    } as unknown as KlineCache;
    const svc = new ForecastService({ cache });
    const out = await svc.getMany(
      [
        { assetClass: "crypto", symbol: "BTCPHP" },
        { assetClass: "crypto", symbol: "ETHPHP" },
      ],
      "1h",
      5,
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.status).toBe("ok");
    expect(out[0]!.symbol).toBe("BTCPHP");
    if (out[1]!.status !== "ok") throw new Error("expected ok");
    expect(out[1]!.forecast.horizon).toBe(5);
  });
});
