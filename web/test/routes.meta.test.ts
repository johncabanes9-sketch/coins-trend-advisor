import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { SignalCache } from "../src/signalCache.js";
import type { AppConfig } from "../src/config.js";

function makeApp(opts: { pairs?: string[]; watchlist?: string[] }) {
  const config: AppConfig = {
    port: 3001,
    coinsBaseUrl: "http://example.test",
    watchlist: opts.watchlist ?? ["BTCPHP", "ETHPHP"],
    signalTtlMs: 1000,
    klineInterval: "1h",
    klineLimit: 200,
    apiToken: undefined,
    allowedIntervals: ["1h", "4h"],
  };
  const getPairs = vi.fn(async () => opts.pairs ?? ["BTCPHP", "ETHPHP", "XRPPHP"]);
  const client = { getKlines: vi.fn(), getPrice: vi.fn(), getPairs } as never;
  const cache = new SignalCache({ client, ttlMs: config.signalTtlMs, klineLimit: config.klineLimit });
  return { app: createApp({ config, client: client as never, cache }), getPairs };
}

describe("meta routes", () => {
  it("GET /api/watchlist returns the configured pairs", async () => {
    const { app } = makeApp({ watchlist: ["BTCPHP", "ETHPHP"] });
    const res = await request(app).get("/api/watchlist");
    expect(res.status).toBe(200);
    expect(res.body.pairs).toEqual(["BTCPHP", "ETHPHP"]);
  });

  it("GET /api/pairs returns pairs and caches upstream", async () => {
    const { app, getPairs } = makeApp({ pairs: ["A", "B"] });
    const first = await request(app).get("/api/pairs");
    const second = await request(app).get("/api/pairs");
    expect(first.body.pairs).toEqual(["A", "B"]);
    expect(second.body.pairs).toEqual(["A", "B"]);
    expect(getPairs).toHaveBeenCalledTimes(1);
  });
});
