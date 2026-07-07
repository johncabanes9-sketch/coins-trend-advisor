import { describe, it, expect } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { analyzeRoutes } from "../src/routes/analyze.js";
import { errorMiddleware } from "../src/errors.js";
import type { SwingSignal } from "@coins-trend-advisor/core";
import type { AppDeps } from "../src/server.js";

function buySignal(): SwingSignal {
  return {
    action: "BUY", confidence: 80, entry_price: 1000, stop_loss: 980,
    take_profit: 1040, position_size_pct: 0.375, reasoning: "Uptrend confirmed.", risk_flags: [],
  };
}

interface MakeAppOpts {
  // Return undefined to simulate a disabled asset class (e.g. stocks with no key).
  resolveProvider?: (assetClass: string) => { allowedIntervals: string[] } | undefined;
}

function makeApp(analyzeImpl: () => Promise<SwingSignal>, opts: MakeAppOpts = {}): Express {
  const resolve = opts.resolveProvider ?? (() => ({ allowedIntervals: ["1d", "1h", "D"] }));
  const deps = {
    config: { cryptoInterval: "1d", stockInterval: "D" },
    analyze: { analyze: analyzeImpl },
    registry: { resolve },
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
  it("rejects an interval the provider does not allow", async () => {
    const app = makeApp(async () => buySignal());
    const res = await request(app).post("/api/analyze/crypto").send({ ...body, interval: "7x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_interval");
  });
  it("returns 503 when the asset class has no configured provider", async () => {
    const app = makeApp(async () => buySignal(), { resolveProvider: () => undefined });
    const res = await request(app).post("/api/analyze/stock").send({ ...body, interval: "D" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("stocks_disabled");
  });
});
