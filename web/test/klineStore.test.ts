import { describe, it, expect } from "vitest";
import { MemoryKlineStore, RedisKlineStore, makeKlineStore, type RedisLike } from "../src/klineStore.js";
import type { Kline } from "@coins-trend-advisor/core";

function candles(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i, open: 1, high: 1, low: 1, close: 1, volume: 1, closeTime: i + 1,
  }));
}

describe("MemoryKlineStore", () => {
  it("round-trips a stored value", async () => {
    const store = new MemoryKlineStore();
    await store.set("k", { klines: candles(3), computedAt: 42 });
    const got = await store.get("k");
    expect(got?.computedAt).toBe(42);
    expect(got?.klines).toHaveLength(3);
  });

  it("returns null for a missing key", async () => {
    const store = new MemoryKlineStore();
    expect(await store.get("nope")).toBeNull();
  });

  it("evicts the oldest entry once maxEntries is exceeded", async () => {
    const store = new MemoryKlineStore({ maxEntries: 2 });
    await store.set("a", { klines: candles(1), computedAt: 1 });
    await store.set("b", { klines: candles(1), computedAt: 2 });
    await store.set("c", { klines: candles(1), computedAt: 3 }); // evicts "a"
    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).not.toBeNull();
    expect(await store.get("c")).not.toBeNull();
  });
});

function fakeRedis(overrides: Partial<RedisLike> = {}): RedisLike {
  const map = new Map<string, unknown>();
  return {
    get: async <T,>(key: string) => (map.has(key) ? (map.get(key) as T) : null),
    set: async (key: string, value: unknown) => { map.set(key, value); return "OK"; },
    ...overrides,
  };
}

describe("RedisKlineStore", () => {
  it("round-trips a stored value through the client", async () => {
    const store = new RedisKlineStore(fakeRedis());
    await store.set("k", { klines: [], computedAt: 7 });
    const got = await store.get("k");
    expect(got?.computedAt).toBe(7);
  });

  it("returns null on a get miss", async () => {
    const store = new RedisKlineStore(fakeRedis());
    expect(await store.get("missing")).toBeNull();
  });

  it("sets with the configured TTL (ex seconds)", async () => {
    let seenOpts: { ex?: number } | undefined;
    const client = fakeRedis({
      set: async (_k, _v, opts) => { seenOpts = opts; return "OK"; },
    });
    const store = new RedisKlineStore(client, 3600);
    await store.set("k", { klines: [], computedAt: 1 });
    expect(seenOpts?.ex).toBe(3600);
  });

  it("treats a throwing get as a cache miss", async () => {
    const client = fakeRedis({ get: async () => { throw new Error("down"); } });
    const store = new RedisKlineStore(client);
    expect(await store.get("k")).toBeNull();
  });

  it("swallows a throwing set", async () => {
    const client = fakeRedis({ set: async () => { throw new Error("down"); } });
    const store = new RedisKlineStore(client);
    await expect(store.set("k", { klines: [], computedAt: 1 })).resolves.toBeUndefined();
  });
});

describe("makeKlineStore", () => {
  it("returns a MemoryKlineStore when no Upstash url is set", () => {
    const store = makeKlineStore({} as NodeJS.ProcessEnv);
    expect(store.constructor.name).toBe("MemoryKlineStore");
  });

  it("returns a RedisKlineStore when UPSTASH_REDIS_REST_URL is set", () => {
    const store = makeKlineStore({
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    } as unknown as NodeJS.ProcessEnv);
    expect(store.constructor.name).toBe("RedisKlineStore");
  });
});
