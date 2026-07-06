import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { SignalCache } from "../src/signalCache.js";
import { CoinsClient } from "@coins-trend-advisor/core";

function makeApp() {
  const config = loadConfig({});
  const client = new CoinsClient({ baseUrl: config.coinsBaseUrl });
  const cache = new SignalCache({ client, ttlMs: config.signalTtlMs, klineLimit: config.klineLimit });
  return createApp({ config, client, cache });
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
});
