import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";
import type { AppConfig, WatchlistEntry } from "../src/config.js";
import type { AssetClass, Kline, MarketDataProvider } from "@coins-trend-advisor/core";
import { DISCLAIMER } from "@coins-trend-advisor/core";

function candles(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000, open: 100 + i, high: 100 + i, low: 100 + i,
    close: 100 + i, volume: 1, closeTime: i * 1000 + 1,
  }));
}

function stockProvider(getKlines: MarketDataProvider["getKlines"]): MarketDataProvider {
  return {
    assetClass: "stock", allowedIntervals: ["D", "W"], defaultInterval: "D",
    getKlines, getPrice: vi.fn(), listSymbols: vi.fn(),
  };
}

function cryptoProvider(getKlines: MarketDataProvider["getKlines"]): MarketDataProvider {
  return {
    assetClass: "crypto", allowedIntervals: ["1h", "4h"], defaultInterval: "1h",
    getKlines, getPrice: vi.fn(), listSymbols: vi.fn(),
  };
}

function makeApp(opts: {
  crypto?: MarketDataProvider["getKlines"];
  stock?: MarketDataProvider["getKlines"] | null; // null => stocks disabled
  watchlist?: WatchlistEntry[];
  ttlMs?: number;
}) {
  const crypto = cryptoProvider(opts.crypto ?? (async () => candles(60)));
  const stock =
    opts.stock === null
      ? null
      : stockProvider(opts.stock ?? (async () => candles(60)));
  const config: AppConfig = {
    port: 3001,
    coinsBaseUrl: "http://example.test",
    finnhubBaseUrl: "http://finnhub.test",
    finnhubApiKey: opts.stock === null ? undefined : "fk",
    watchlist: opts.watchlist ?? [
      { assetClass: "crypto", symbol: "BTCPHP" },
      { assetClass: "crypto", symbol: "ETHPHP" },
    ],
    signalTtlMs: opts.ttlMs ?? 1000,
    cryptoInterval: "1h",
    stockInterval: "D",
    klineLimit: 200,
    apiToken: undefined,
  };
  const registry = {
    resolve: (ac: AssetClass) => (ac === "crypto" ? crypto : ac === "stock" ? stock : null),
  };
  const cache = new KlineCache({
    resolveProvider: (ac) => registry.resolve(ac)!,
    ttlMs: config.signalTtlMs,
    klineLimit: config.klineLimit,
  });
  const signals = new SignalService({ cache });
  return createApp({ config, registry, cache, signals });
}

describe("signals routes", () => {
  it("GET /api/signals/crypto returns the crypto watchlist", async () => {
    const res = await request(makeApp({})).get("/api/signals/crypto");
    expect(res.status).toBe(200);
    expect(res.body.assetClass).toBe("crypto");
    expect(res.body.interval).toBe("1h");
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].status).toBe("ok");
    expect(res.body.results[0].signal.disclaimer).toBe(DISCLAIMER);
  });

  it("GET /api/signals/crypto/:symbol returns a single ok signal", async () => {
    const res = await request(makeApp({})).get("/api/signals/crypto/BTCPHP");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.symbol).toBe("BTCPHP");
  });

  it("surfaces mixed per-pair statuses without failing the request", async () => {
    const crypto = vi.fn(async (symbol: string) => {
      if (symbol === "OK") return candles(60);
      if (symbol === "SHORT") return candles(10);
      throw new Error("Coins.ph 500 for /openapi/quote/v1/klines: secret upstream body");
    });
    const app = makeApp({
      crypto,
      watchlist: [
        { assetClass: "crypto", symbol: "OK" },
        { assetClass: "crypto", symbol: "SHORT" },
        { assetClass: "crypto", symbol: "ERR" },
      ],
    });
    const res = await request(app).get("/api/signals/crypto");
    expect(res.status).toBe(200);
    const byPair = Object.fromEntries(res.body.results.map((r: { symbol: string }) => [r.symbol, r]));
    expect(byPair.OK.status).toBe("ok");
    expect(byPair.SHORT.status).toBe("insufficient_data");
    expect(byPair.ERR.status).toBe("error");
    expect(byPair.ERR.message).not.toContain("secret upstream body");
  });

  it("returns 422 for insufficient data", async () => {
    const res = await request(makeApp({ crypto: async () => candles(10) })).get("/api/signals/crypto/BTCPHP");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("insufficient_data");
  });

  it("returns 502 with a sanitized message when upstream fails", async () => {
    const res = await request(
      makeApp({ crypto: async () => { throw new Error("Coins.ph 500 for /openapi: secret upstream body"); } }),
    ).get("/api/signals/crypto/BTCPHP");
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("upstream_unavailable");
    expect(res.body.error.message).not.toContain("secret upstream body");
  });

  it("rejects an unknown asset class with 400", async () => {
    const res = await request(makeApp({})).get("/api/signals/forex/EURUSD");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_asset_class");
  });

  it("rejects a crypto interval on a stock route with 400", async () => {
    const res = await request(makeApp({})).get("/api/signals/stock/AAPL?interval=1h");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_interval");
  });

  it("returns 503 stocks_disabled when no finnhub key is configured", async () => {
    const res = await request(makeApp({ stock: null })).get("/api/signals/stock/AAPL");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("stocks_disabled");
  });

  it("serves a stock signal when enabled", async () => {
    const res = await request(makeApp({ stock: async () => candles(60) })).get("/api/signals/stock/AAPL");
    expect(res.status).toBe(200);
    expect(res.body.assetClass).toBe("stock");
    expect(res.body.symbol).toBe("AAPL");
  });
});
