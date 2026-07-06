// core/test/coinsClient.smoke.test.ts
import { describe, it, expect, vi } from "vitest";
import { CoinsClient } from "../src/coinsClient.js";

describe("CoinsClient (mocked)", () => {
  it("maps raw kline rows to Kline objects", async () => {
    const raw = [
      [1000, "10.0", "12.0", "9.0", "11.0", "5.0", 1999, "0", 0, "0", "0", "0"],
    ];
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(raw), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new CoinsClient({ fetchImpl });
    const klines = await client.getKlines("BTCPHP", "1h", 1);
    expect(klines).toEqual([
      { openTime: 1000, open: 10, high: 12, low: 9, close: 11, volume: 5, closeTime: 1999 },
    ]);
  });

  it("retries once on 429 then succeeds", async () => {
    const raw: unknown[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1)
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      return new Response(JSON.stringify(raw), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new CoinsClient({ fetchImpl, maxRetries: 3 });
    const klines = await client.getKlines("BTCPHP", "1h", 1);
    expect(klines).toEqual([]);
    expect(calls).toBe(2);
  });
});

// Live smoke test — skipped unless RUN_SMOKE=1 (needs network).
describe.skipIf(process.env.RUN_SMOKE !== "1")("CoinsClient (live)", () => {
  it("fetches real BTCPHP klines", async () => {
    const client = new CoinsClient();
    const klines = await client.getKlines("BTCPHP", "1h", 5);
    expect(klines.length).toBeGreaterThan(0);
    expect(typeof klines[0]!.close).toBe("number");
  }, 15000);
});
