import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { buildRegistry } from "../src/providers.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";

function makeApp() {
  const config = loadConfig({ API_TOKEN: "secret" });
  const registry = buildRegistry(config);
  const cache = new KlineCache({
    resolveProvider: (ac) => registry.resolve(ac)!,
    ttlMs: config.signalTtlMs,
    klineLimit: config.klineLimit,
  });
  const signals = new SignalService({ cache });
  return createApp({ config, registry, cache, signals });
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
    expect(res.body.entries).toBeInstanceOf(Array);
  });

  it("leaves /api/health open without a token", async () => {
    const res = await request(makeApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
