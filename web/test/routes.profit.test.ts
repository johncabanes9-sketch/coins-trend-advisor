import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { buildRegistry } from "../src/providers.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";
import { ForecastService } from "../src/forecastService.js";

function makeApp() {
  const config = loadConfig({});
  const registry = buildRegistry(config);
  const cache = new KlineCache({
    resolveProvider: (ac) => registry.resolve(ac)!,
    ttlMs: config.signalTtlMs,
    klineLimit: config.klineLimit,
  });
  const signals = new SignalService({ cache });
  const forecasts = new ForecastService({ cache });
  return createApp({ config, registry, cache, signals, forecasts });
}

describe("POST /api/profit", () => {
  it("computes a fee-bearing profit", async () => {
    const res = await request(makeApp())
      .post("/api/profit")
      .send({ entryPrice: 100, positionSize: 1000, targetPrice: 110, feePct: 1 });
    expect(res.status).toBe(200);
    expect(res.body.netProfit).toBeCloseTo(79, 6);
    expect(res.body.netProfitPct).toBeCloseTo(7.9, 6);
  });

  it("rejects a missing field with 400", async () => {
    const res = await request(makeApp())
      .post("/api/profit")
      .send({ entryPrice: 100, positionSize: 1000, targetPrice: 110 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_input");
  });

  it("rejects a non-positive entry price with 400", async () => {
    const res = await request(makeApp())
      .post("/api/profit")
      .send({ entryPrice: 0, positionSize: 1000, targetPrice: 110, feePct: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_input");
  });

  it("returns 400 invalid_json for a malformed JSON body", async () => {
    const res = await request(makeApp())
      .post("/api/profit")
      .set("Content-Type", "application/json")
      .send("{ not valid json ");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });
});
