import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { SignalCache } from "../src/signalCache.js";
import type { AppConfig } from "../src/config.js";
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

function makeApp(opts: {
  getKlines?: (pair: string, interval: string, limit: number) => Promise<Kline[]>;
  rows?: Kline[];
  watchlist?: string[];
  ttlMs?: number;
}) {
  const config: AppConfig = {
    port: 3001,
    coinsBaseUrl: "http://example.test",
    watchlist: opts.watchlist ?? ["BTCPHP", "ETHPHP"],
    signalTtlMs: opts.ttlMs ?? 1000,
    klineInterval: "1h",
    klineLimit: 200,
    apiToken: undefined,
    allowedIntervals: ["1h", "4h"],
  };
  const getKlines =
    opts.getKlines ?? vi.fn(async () => opts.rows ?? candles(60));
  const client = { getKlines, getPrice: vi.fn(), getPairs: vi.fn() } as never;
  const cache = new SignalCache({ client, ttlMs: config.signalTtlMs, klineLimit: config.klineLimit });
  return createApp({ config, client: client as never, cache });
}

describe("signals routes", () => {
  it("GET /api/signals returns results for the whole watchlist", async () => {
    const res = await request(makeApp({ rows: candles(60) })).get("/api/signals");
    expect(res.status).toBe(200);
    expect(res.body.interval).toBe("1h");
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].status).toBe("ok");
    expect(res.body.results[0].signal.disclaimer).toBe(DISCLAIMER);
  });

  it("GET /api/signals/:pair returns a single ok signal", async () => {
    const res = await request(makeApp({ rows: candles(60) })).get("/api/signals/BTCPHP");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.pair).toBe("BTCPHP");
  });

  it("returns 422 for insufficient data", async () => {
    const res = await request(makeApp({ rows: candles(10) })).get("/api/signals/BTCPHP");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("insufficient_data");
  });

  it("returns 502 when upstream fails with nothing cached", async () => {
    const res = await request(
      makeApp({ getKlines: vi.fn(async () => { throw new Error("boom"); }) }),
    ).get("/api/signals/BTCPHP");
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("upstream_unavailable");
  });

  it("rejects an unsupported interval with 400", async () => {
    const res = await request(makeApp({ rows: candles(60) })).get("/api/signals/BTCPHP?interval=2h");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_interval");
  });

  it("serves a stale signal after upstream fails post-warmup", async () => {
    const rows = candles(60);
    let fail = false;
    const getKlines = vi.fn(async () => {
      if (fail) throw new Error("boom");
      return rows;
    });
    const app = makeApp({ getKlines, ttlMs: 0 });
    const warm = await request(app).get("/api/signals/BTCPHP");
    expect(warm.body.stale).toBeUndefined();
    fail = true;
    const res = await request(app).get("/api/signals/BTCPHP");
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(true);
    expect(typeof res.body.staleAsOf).toBe("string");
  });
});
