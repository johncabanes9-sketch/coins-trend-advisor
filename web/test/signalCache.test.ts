import { describe, it, expect, vi } from "vitest";
import { SignalCache } from "../src/signalCache.js";
import type { Kline } from "@coins-trend-advisor/core";
import { DISCLAIMER } from "@coins-trend-advisor/core";

function candles(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000,
    open: 100 + i,
    high: 100 + i,
    low: 100 + i,
    close: 100 + i,
    volume: 1,
    closeTime: i * 1000 + 1,
  }));
}

function makeClient(rows: Kline[]) {
  return { getKlines: vi.fn(async () => rows) };
}

describe("SignalCache", () => {
  it("computes and returns an ok signal", async () => {
    const client = makeClient(candles(60));
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200 });
    const r = await cache.getSignal("BTCPHP", "1h");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.signal.disclaimer).toBe(DISCLAIMER);
    expect(client.getKlines).toHaveBeenCalledTimes(1);
  });

  it("serves a cached value within TTL without refetching", async () => {
    const client = makeClient(candles(60));
    let t = 0;
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200, now: () => t });
    await cache.getSignal("BTCPHP", "1h");
    t = 500;
    await cache.getSignal("BTCPHP", "1h");
    expect(client.getKlines).toHaveBeenCalledTimes(1);
  });

  it("recomputes after TTL expiry", async () => {
    const client = makeClient(candles(60));
    let t = 0;
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200, now: () => t });
    await cache.getSignal("BTCPHP", "1h");
    t = 1500;
    await cache.getSignal("BTCPHP", "1h");
    expect(client.getKlines).toHaveBeenCalledTimes(2);
  });

  it("reports insufficient_data for a short series", async () => {
    const client = makeClient(candles(10));
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200 });
    const r = await cache.getSignal("BTCPHP", "1h");
    expect(r.status).toBe("insufficient_data");
  });

  it("dedups concurrent requests for the same key", async () => {
    let resolve!: (v: Kline[]) => void;
    const client = {
      getKlines: vi.fn(() => new Promise<Kline[]>((res) => { resolve = res; })),
    };
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200 });
    const p1 = cache.getSignal("BTCPHP", "1h");
    const p2 = cache.getSignal("BTCPHP", "1h");
    resolve(candles(60));
    await Promise.all([p1, p2]);
    expect(client.getKlines).toHaveBeenCalledTimes(1);
  });

  it("serves a stale cached signal when upstream later fails", async () => {
    const rows = candles(60);
    let fail = false;
    const client = {
      getKlines: vi.fn(async () => {
        if (fail) throw new Error("boom");
        return rows;
      }),
    };
    let t = 0;
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200, now: () => t });
    await cache.getSignal("BTCPHP", "1h");
    t = 2000;
    fail = true;
    const r = await cache.getSignal("BTCPHP", "1h");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.stale).toBe(true);
    expect(typeof r.staleAsOf).toBe("string");
  });
});
