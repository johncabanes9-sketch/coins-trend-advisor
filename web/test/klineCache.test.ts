import { describe, it, expect, vi } from "vitest";
import { KlineCache } from "../src/klineCache.js";
import type { Kline, MarketDataProvider, AssetClass } from "@coins-trend-advisor/core";

function candles(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000, open: 100 + i, high: 100 + i, low: 100 + i,
    close: 100 + i, volume: 1, closeTime: i * 1000 + 1,
  }));
}

function providerFrom(getKlines: MarketDataProvider["getKlines"]): MarketDataProvider {
  return {
    assetClass: "crypto",
    allowedIntervals: ["1h", "4h"],
    defaultInterval: "1h",
    getKlines,
    getPrice: vi.fn(),
    listSymbols: vi.fn(),
  };
}

function cacheWith(
  getKlines: MarketDataProvider["getKlines"],
  opts: { ttlMs?: number; now?: () => number } = {},
) {
  const provider = providerFrom(getKlines);
  const resolveProvider = (_ac: AssetClass) => provider;
  return new KlineCache({
    resolveProvider,
    ttlMs: opts.ttlMs ?? 1000,
    klineLimit: 200,
    now: opts.now,
  });
}

describe("KlineCache", () => {
  it("fetches and returns ok klines", async () => {
    const getKlines = vi.fn(async () => candles(60));
    const cache = cacheWith(getKlines);
    const r = await cache.getKlines("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.klines).toHaveLength(60);
    expect(getKlines).toHaveBeenCalledWith("BTCPHP", "1h", 200);
  });

  it("serves a cached value within TTL without refetching", async () => {
    const getKlines = vi.fn(async () => candles(60));
    let t = 0;
    const cache = cacheWith(getKlines, { now: () => t });
    await cache.getKlines("crypto", "BTCPHP", "1h");
    t = 500;
    await cache.getKlines("crypto", "BTCPHP", "1h");
    expect(getKlines).toHaveBeenCalledTimes(1);
  });

  it("recomputes after TTL expiry", async () => {
    const getKlines = vi.fn(async () => candles(60));
    let t = 0;
    const cache = cacheWith(getKlines, { now: () => t });
    await cache.getKlines("crypto", "BTCPHP", "1h");
    t = 1500;
    await cache.getKlines("crypto", "BTCPHP", "1h");
    expect(getKlines).toHaveBeenCalledTimes(2);
  });

  it("keys separately by asset class, symbol, and interval", async () => {
    const getKlines = vi.fn(async () => candles(60));
    const cache = cacheWith(getKlines);
    await cache.getKlines("crypto", "BTCPHP", "1h");
    await cache.getKlines("crypto", "BTCPHP", "4h");
    await cache.getKlines("crypto", "ETHPHP", "1h");
    expect(getKlines).toHaveBeenCalledTimes(3);
  });

  it("dedups concurrent requests for the same key", async () => {
    let resolve!: (v: Kline[]) => void;
    const getKlines = vi.fn(() => new Promise<Kline[]>((res) => { resolve = res; }));
    const cache = cacheWith(getKlines);
    const p1 = cache.getKlines("crypto", "BTCPHP", "1h");
    const p2 = cache.getKlines("crypto", "BTCPHP", "1h");
    resolve(candles(60));
    await Promise.all([p1, p2]);
    expect(getKlines).toHaveBeenCalledTimes(1);
  });

  it("returns error when upstream fails with nothing cached", async () => {
    const getKlines = vi.fn(async () => { throw new Error("boom"); });
    const cache = cacheWith(getKlines);
    const r = await cache.getKlines("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("error");
    if (r.status !== "error") throw new Error("expected error");
    expect(r.message).toBe("boom");
  });

  it("serves stale klines when upstream later fails", async () => {
    let fail = false;
    const rows = candles(60);
    const getKlines = vi.fn(async () => { if (fail) throw new Error("boom"); return rows; });
    let t = 0;
    const cache = cacheWith(getKlines, { now: () => t });
    await cache.getKlines("crypto", "BTCPHP", "1h");
    t = 2000; fail = true;
    const r = await cache.getKlines("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.stale).toBe(true);
    expect(typeof r.staleAsOf).toBe("string");
  });

  it("getMany resolves each entry independently", async () => {
    const getKlines = vi.fn(async (symbol: string) => {
      if (symbol === "ERR") throw new Error("boom");
      return candles(60);
    });
    const cache = cacheWith(getKlines);
    const out = await cache.getMany(
      [{ assetClass: "crypto", symbol: "BTCPHP" }, { assetClass: "crypto", symbol: "ERR" }],
      "1h",
    );
    expect(out[0]!.status).toBe("ok");
    expect(out[1]!.status).toBe("error");
  });
});
