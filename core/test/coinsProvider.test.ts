import { describe, it, expect, vi } from "vitest";
import { CoinsProvider } from "../src/providers/coinsProvider.js";
import type { Kline } from "../src/types.js";

function candle(i: number): Kline {
  return { openTime: i, open: i, high: i, low: i, close: i, volume: 1, closeTime: i + 1 };
}

describe("CoinsProvider", () => {
  it("advertises crypto metadata", () => {
    const p = new CoinsProvider({ getKlines: vi.fn(), getPrice: vi.fn(), getPairs: vi.fn() });
    expect(p.assetClass).toBe("crypto");
    expect(p.allowedIntervals).toEqual(["1h", "4h"]);
    expect(p.defaultInterval).toBe("1h");
  });

  it("delegates getKlines to the client with the limit", async () => {
    const rows = [candle(0), candle(1)];
    const getKlines = vi.fn(async () => rows);
    const p = new CoinsProvider({ getKlines, getPrice: vi.fn(), getPairs: vi.fn() });
    const out = await p.getKlines("BTCPHP", "1h", 200);
    expect(out).toBe(rows);
    expect(getKlines).toHaveBeenCalledWith("BTCPHP", "1h", 200);
  });

  it("maps listSymbols to the client's getPairs", async () => {
    const getPairs = vi.fn(async () => ["BTCPHP", "ETHPHP"]);
    const p = new CoinsProvider({ getKlines: vi.fn(), getPrice: vi.fn(), getPairs });
    expect(await p.listSymbols()).toEqual(["BTCPHP", "ETHPHP"]);
  });
});
