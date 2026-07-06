// web/test/smoke.live.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { buildRegistry } from "../src/providers.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";

describe.skipIf(process.env.RUN_SMOKE !== "1")("live smoke", () => {
  it("computes a real signal for BTCPHP", async () => {
    const config = loadConfig({});
    const registry = buildRegistry(config);
    const cache = new KlineCache({
      resolveProvider: (ac) => registry.resolve(ac)!,
      ttlMs: config.signalTtlMs,
      klineLimit: config.klineLimit,
    });
    const signals = new SignalService({ cache });
    const app = createApp({ config, registry, cache, signals });
    const res = await request(app).get("/api/signals/crypto/BTCPHP");
    // Either a computed signal or an honest insufficient-data response.
    expect([200, 422]).toContain(res.status);
  }, 20000);
});
