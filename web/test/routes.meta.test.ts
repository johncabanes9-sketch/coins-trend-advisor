import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";
import type { AppConfig, WatchlistEntry } from "../src/config.js";
import type { AssetClass, MarketDataProvider } from "@coins-trend-advisor/core";

function provider(assetClass: AssetClass, listSymbols: () => Promise<string[]>): MarketDataProvider {
  return {
    assetClass,
    allowedIntervals: assetClass === "crypto" ? ["1h", "4h"] : ["D", "W"],
    defaultInterval: assetClass === "crypto" ? "1h" : "D",
    getKlines: vi.fn(), getPrice: vi.fn(), listSymbols,
  };
}

function makeApp(opts: { watchlist?: WatchlistEntry[]; symbols?: string[]; stockEnabled?: boolean }) {
  const listSymbols = vi.fn(async () => opts.symbols ?? ["BTCPHP", "ETHPHP", "XRPPHP"]);
  const crypto = provider("crypto", listSymbols);
  const stock = opts.stockEnabled ? provider("stock", vi.fn(async () => ["AAPL"])) : null;
  const config: AppConfig = {
    port: 3001, coinsBaseUrl: "http://example.test", finnhubBaseUrl: "http://finnhub.test",
    finnhubApiKey: opts.stockEnabled ? "fk" : undefined,
    watchlist: opts.watchlist ?? [
      { assetClass: "crypto", symbol: "BTCPHP" },
      { assetClass: "stock", symbol: "AAPL" },
    ],
    signalTtlMs: 1000, cryptoInterval: "1h", stockInterval: "D", klineLimit: 200, apiToken: undefined,
  };
  const registry = { resolve: (ac: AssetClass) => (ac === "crypto" ? crypto : ac === "stock" ? stock : null) };
  const cache = new KlineCache({ resolveProvider: (ac) => registry.resolve(ac)!, ttlMs: 1000, klineLimit: 200 });
  const signals = new SignalService({ cache });
  return { app: createApp({ config, registry, cache, signals }), listSymbols };
}

describe("meta routes", () => {
  it("GET /api/watchlist returns tagged entries including disabled stocks", async () => {
    const { app } = makeApp({});
    const res = await request(app).get("/api/watchlist");
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([
      { assetClass: "crypto", symbol: "BTCPHP" },
      { assetClass: "stock", symbol: "AAPL" },
    ]);
  });

  it("GET /api/pairs/crypto returns symbols and caches upstream", async () => {
    const { app, listSymbols } = makeApp({ symbols: ["A", "B"] });
    const first = await request(app).get("/api/pairs/crypto");
    const second = await request(app).get("/api/pairs/crypto");
    expect(first.body.assetClass).toBe("crypto");
    expect(first.body.symbols).toEqual(["A", "B"]);
    expect(second.body.symbols).toEqual(["A", "B"]);
    expect(listSymbols).toHaveBeenCalledTimes(1);
  });

  it("GET /api/pairs/stock returns 503 when stocks are disabled", async () => {
    const { app } = makeApp({ stockEnabled: false });
    const res = await request(app).get("/api/pairs/stock");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("stocks_disabled");
  });
});
