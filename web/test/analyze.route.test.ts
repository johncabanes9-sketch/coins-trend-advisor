import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { analyzeRoutes } from "../src/routes/analyze.js";
import { errorMiddleware } from "../src/errors.js";
import { DEFAULT_RISK_CONFIG, type SwingSignal } from "@coins-trend-advisor/core";
import type { AppDeps } from "../src/server.js";

function buySignal(): SwingSignal {
  return {
    action: "BUY", confidence: 80, entry_price: 1000, stop_loss: 980,
    take_profit: 1040, position_size_pct: 0.375, reasoning: "Uptrend confirmed.", risk_flags: [],
  };
}

function makeApp(analyzeImpl: () => Promise<SwingSignal>): Express {
  const deps = {
    config: { cryptoInterval: "1d", stockInterval: "D" },
    analyze: { analyze: analyzeImpl },
  } as unknown as AppDeps;
  const app = express();
  app.use(express.json());
  app.use("/api", analyzeRoutes(deps));
  app.use(errorMiddleware);
  return app;
}

const body = {
  symbol: "BTCPHP", interval: "1d", equity: 100000,
  position: null, lossToDate: { dayPct: 0, weekPct: 0 }, marketStatus: "open",
};

describe("POST /api/analyze/:assetClass", () => {
  it("returns the signal for a valid request", async () => {
    const app = makeApp(async () => buySignal());
    const res = await request(app).post("/api/analyze/crypto").send(body);
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("BUY");
  });
  it("rejects a missing equity", async () => {
    const app = makeApp(async () => buySignal());
    const res = await request(app).post("/api/analyze/crypto").send({ ...body, equity: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_input");
  });
  it("rejects a non-finite position entryPrice", async () => {
    const app = makeApp(async () => buySignal());
    const res = await request(app).post("/api/analyze/crypto")
      .send({ ...body, position: { size: 1, entryPrice: "x" } });
    expect(res.status).toBe(400);
  });
  it("rejects an unknown asset class", async () => {
    const app = makeApp(async () => buySignal());
    const res = await request(app).post("/api/analyze/gold").send(body);
    expect(res.status).toBe(400);
  });
});
