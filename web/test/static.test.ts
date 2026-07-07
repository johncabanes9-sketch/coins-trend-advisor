import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";
import { ForecastService } from "../src/forecastService.js";
import { AnalyzeService } from "../src/analyzeService.js";
import type { AppConfig } from "../src/config.js";
import type { AssetClass, MarketDataProvider } from "@coins-trend-advisor/core";
import { DEFAULT_RISK_CONFIG } from "@coins-trend-advisor/core";

function baseConfig(staticDir?: string): AppConfig {
  return {
    port: 3001, coinsBaseUrl: "http://example.test", finnhubBaseUrl: "http://finnhub.test",
    finnhubApiKey: undefined, watchlist: [{ assetClass: "crypto", symbol: "BTCPHP" }],
    signalTtlMs: 1000, cryptoInterval: "1h", stockInterval: "D", klineLimit: 200,
    forecastHorizon: 5, apiToken: undefined, staticDir, risk: DEFAULT_RISK_CONFIG,
  };
}

function makeApp(staticDir?: string) {
  const provider: MarketDataProvider = {
    assetClass: "crypto", allowedIntervals: ["1h", "4h"], defaultInterval: "1h",
    getKlines: vi.fn(), getPrice: vi.fn(), listSymbols: vi.fn(),
  };
  const registry = { resolve: (ac: AssetClass) => (ac === "crypto" ? provider : null) };
  const cache = new KlineCache({ resolveProvider: (ac) => registry.resolve(ac)!, ttlMs: 1000, klineLimit: 200 });
  const signals = new SignalService({ cache });
  const forecasts = new ForecastService({ cache });
  const config = baseConfig(staticDir);
  const analyze = new AnalyzeService({ cache, risk: config.risk });
  return createApp({ config, registry, cache, signals, forecasts, analyze });
}

const FIXTURE_DIST = fileURLToPath(new URL("./fixtures/dist", import.meta.url));

describe("static frontend serving", () => {
  it("serves index.html at / when the dist dir exists", async () => {
    const res = await request(makeApp(FIXTURE_DIST)).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("app-shell");
  });

  it("SPA-falls back to index.html for an unknown non-/api path", async () => {
    const res = await request(makeApp(FIXTURE_DIST)).get("/dashboard");
    expect(res.status).toBe(200);
    expect(res.text).toContain("app-shell");
  });

  it("still returns JSON 404 for unknown /api paths even with static enabled", async () => {
    const res = await request(makeApp(FIXTURE_DIST)).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("boots and serves /api when the dist dir is absent", async () => {
    const res = await request(makeApp(FIXTURE_DIST + "-does-not-exist")).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
