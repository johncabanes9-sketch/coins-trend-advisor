import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";
import { ForecastService } from "../src/forecastService.js";
import type { AppConfig } from "../src/config.js";
import type { AssetClass, Kline, MarketDataProvider } from "@coins-trend-advisor/core";
import { DISCLAIMER } from "@coins-trend-advisor/core";

function ramp(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000, open: 100 + i, high: 100 + i, low: 100 + i,
    close: 100 + i, volume: 1, closeTime: i * 1000 + 1,
  }));
}

function provider(assetClass: AssetClass, getKlines: MarketDataProvider["getKlines"]): MarketDataProvider {
  return {
    assetClass,
    allowedIntervals: assetClass === "crypto" ? ["1h", "4h"] : ["D", "W"],
    defaultInterval: assetClass === "crypto" ? "1h" : "D",
    getKlines, getPrice: vi.fn(), listSymbols: vi.fn(),
  };
}

function makeApp(opts: { crypto?: MarketDataProvider["getKlines"]; stockEnabled?: boolean }) {
  const crypto = provider("crypto", opts.crypto ?? (async () => ramp(60)));
  const stock = opts.stockEnabled ? provider("stock", async () => ramp(60)) : null;
  const config: AppConfig = {
    port: 3001, coinsBaseUrl: "http://example.test", finnhubBaseUrl: "http://finnhub.test",
    finnhubApiKey: opts.stockEnabled ? "fk" : undefined,
    watchlist: [{ assetClass: "crypto", symbol: "BTCPHP" }],
    signalTtlMs: 1000, cryptoInterval: "1h", stockInterval: "D", klineLimit: 200,
    apiToken: undefined, forecastHorizon: 5,
  };
  const registry = { resolve: (ac: AssetClass) => (ac === "crypto" ? crypto : ac === "stock" ? stock : null) };
  const cache = new KlineCache({ resolveProvider: (ac) => registry.resolve(ac)!, ttlMs: 1000, klineLimit: 200 });
  const signals = new SignalService({ cache });
  const forecasts = new ForecastService({ cache });
  return createApp({ config, registry, cache, signals, forecasts });
}

describe("forecast route", () => {
  it("returns a forecast for a crypto symbol", async () => {
    const res = await request(makeApp({})).get("/api/forecast/crypto/BTCPHP");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.symbol).toBe("BTCPHP");
    expect(res.body.interval).toBe("1h");
    expect(res.body.forecast.method).toBe("holt-linear");
    expect(res.body.forecast.horizon).toBe(5);
    expect(res.body.forecast.disclaimer).toBe(DISCLAIMER);
  });

  it("honors the horizon query parameter", async () => {
    const res = await request(makeApp({})).get("/api/forecast/crypto/BTCPHP?horizon=10");
    expect(res.status).toBe(200);
    expect(res.body.forecast.horizon).toBe(10);
  });

  it("rejects a non-positive horizon with 400", async () => {
    const res = await request(makeApp({})).get("/api/forecast/crypto/BTCPHP?horizon=0");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_horizon");
  });

  it("returns 422 for insufficient data", async () => {
    const res = await request(makeApp({ crypto: async () => ramp(10) })).get("/api/forecast/crypto/BTCPHP");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("insufficient_data");
  });

  it("returns 502 with a sanitized message when upstream fails", async () => {
    const res = await request(
      makeApp({ crypto: async () => { throw new Error("Coins.ph 500 for /openapi: secret upstream body"); } }),
    ).get("/api/forecast/crypto/BTCPHP");
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("upstream_unavailable");
    expect(res.body.error.message).not.toContain("secret upstream body");
  });

  it("returns 503 stocks_disabled when no finnhub key is configured", async () => {
    const res = await request(makeApp({ stockEnabled: false })).get("/api/forecast/stock/AAPL");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("stocks_disabled");
  });

  it("GET /api/forecast/:assetClass returns a list over the watchlist", async () => {
    const res = await request(makeApp({})).get("/api/forecast/crypto");
    expect(res.status).toBe(200);
    expect(res.body.assetClass).toBe("crypto");
    expect(res.body.interval).toBe("1h");
    expect(res.body.horizon).toBe(5);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].symbol).toBe("BTCPHP");
    expect(res.body.results[0].status).toBe("ok");
    expect(res.body.results[0].forecast.method).toBe("holt-linear");
  });

  it("honors ?horizon on the list route", async () => {
    const res = await request(makeApp({})).get("/api/forecast/crypto?horizon=8");
    expect(res.status).toBe(200);
    expect(res.body.horizon).toBe(8);
    expect(res.body.results[0].forecast.horizon).toBe(8);
  });

  it("sanitizes a per-symbol upstream error in the list", async () => {
    const res = await request(
      makeApp({ crypto: async () => { throw new Error("Coins.ph 500: secret upstream body"); } }),
    ).get("/api/forecast/crypto");
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("error");
    expect(res.body.results[0].message).not.toContain("secret upstream body");
  });

  it("returns 503 on the stock list when stocks are disabled", async () => {
    const res = await request(makeApp({ stockEnabled: false })).get("/api/forecast/stock");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("stocks_disabled");
  });
});
