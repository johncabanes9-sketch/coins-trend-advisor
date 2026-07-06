import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { SignalCache } from "../src/signalCache.js";
import { CoinsClient } from "@coins-trend-advisor/core";

function makeApp() {
  const config = loadConfig({ API_TOKEN: "secret" });
  const client = new CoinsClient({ baseUrl: config.coinsBaseUrl });
  const cache = new SignalCache({
    client,
    ttlMs: config.signalTtlMs,
    klineLimit: config.klineLimit,
  });
  return createApp({ config, client, cache });
}

describe("bearer-token auth", () => {
  it("401s a protected route when the token is missing", async () => {
    const res = await request(makeApp()).get("/api/watchlist");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("401s a protected route when the token is wrong", async () => {
    const res = await request(makeApp())
      .get("/api/watchlist")
      .set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
  });

  it("allows a protected route with the correct token", async () => {
    const res = await request(makeApp())
      .get("/api/watchlist")
      .set("Authorization", "Bearer secret");
    expect(res.status).toBe(200);
    expect(res.body.pairs).toBeInstanceOf(Array);
  });

  it("leaves /api/health open without a token", async () => {
    const res = await request(makeApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
