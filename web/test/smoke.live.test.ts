import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { buildRegistry } from "../src/providers.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";
import { ForecastService } from "../src/forecastService.js";

describe.skipIf(process.env.RUN_SMOKE !== "1")("live smoke", () => {
  function boot() {
    const config = loadConfig();
    const registry = buildRegistry(config);
    const cache = new KlineCache({
      resolveProvider: (ac) => {
        const p = registry.resolve(ac);
        if (!p) throw new Error(`no provider for ${ac}`);
        return p;
      },
      ttlMs: config.signalTtlMs,
      klineLimit: config.klineLimit,
    });
    const signals = new SignalService({ cache });
    const forecasts = new ForecastService({ cache });
    return createApp({ config, registry, cache, signals, forecasts });
  }

  it("computes a real crypto signal for BTCPHP", async () => {
    const res = await request(boot()).get("/api/signals/crypto/BTCPHP");
    expect([200, 422]).toContain(res.status);
  }, 20000);

  it("serves a stock signal or a clean disabled response for AAPL", async () => {
    const res = await request(boot()).get("/api/signals/stock/AAPL");
    // 200/422 with a key; 503 stocks_disabled without one; 502 if the free tier lacks candles.
    expect([200, 422, 502, 503]).toContain(res.status);
  }, 20000);

  it("computes a real crypto forecast for BTCPHP", async () => {
    const res = await request(boot()).get("/api/forecast/crypto/BTCPHP");
    expect([200, 422]).toContain(res.status);
  }, 20000);
});
