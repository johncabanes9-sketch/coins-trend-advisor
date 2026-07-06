// web/test/smoke.live.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { makeClient } from "../src/coins.js";
import { SignalCache } from "../src/signalCache.js";

describe.skipIf(process.env.RUN_SMOKE !== "1")("live smoke", () => {
  it("computes a real signal for BTCPHP", async () => {
    const config = loadConfig({});
    const client = makeClient(config);
    const cache = new SignalCache({
      client,
      ttlMs: config.signalTtlMs,
      klineLimit: config.klineLimit,
    });
    const app = createApp({ config, client, cache });
    const res = await request(app).get("/api/signals/BTCPHP");
    // Either a computed signal or an honest insufficient-data response.
    expect([200, 422]).toContain(res.status);
  }, 20000);
});
