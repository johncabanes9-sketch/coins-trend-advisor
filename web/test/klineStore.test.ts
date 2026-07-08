import { describe, it, expect } from "vitest";
import { MemoryKlineStore } from "../src/klineStore.js";
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
