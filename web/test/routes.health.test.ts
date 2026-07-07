import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { buildRegistry } from "../src/providers.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";
import { ForecastService } from "../src/forecastService.js";
import { AnalyzeService } from "../src/analyzeService.js";

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
  const analyze = new AnalyzeService({ cache, risk: config.risk });
  return createApp({ config, registry, cache, signals, forecasts, analyze });
}

describe("health + 404", () => {
  it("GET /api/health returns ok", async () => {
    const res = await request(makeApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("an unknown /api route returns a JSON 404", async () => {
    const res = await request(makeApp()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});
