import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { SignalCache } from "../src/signalCache.js";
import { CoinsClient } from "@coins-trend-advisor/core";

function makeApp() {
  const config = loadConfig({});
  const client = new CoinsClient({ baseUrl: config.coinsBaseUrl });
  const cache = new SignalCache({
    client,
    ttlMs: config.signalTtlMs,
    klineLimit: config.klineLimit,
  });
  return createApp({ config, client, cache });
}

describe("health + 404", () => {
  it("GET /api/health returns ok", async () => {
    const res = await request(makeApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("an unknown /api route returns a JSON 404", async () => {
    const res = await request(makeApp()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});
