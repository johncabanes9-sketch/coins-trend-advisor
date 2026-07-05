import { describe, it, expect } from "vitest";
import { rsi } from "../../src/indicators/rsi.js";

describe("rsi", () => {
  it("computes Wilder RSI on a small hand-checked series", () => {
    // closes [1,2,3,2], period 2. changes: +1,+1,-1
    // seed (first 2 changes): avgGain=1, avgLoss=0 -> RS=inf -> RSI=100 at index 2
    // index 3: change -1 -> avgGain=(1*1+0)/2=0.5, avgLoss=(0*1+1)/2=0.5 -> RS=1 -> RSI=50
    const out = rsi([1, 2, 3, 2], 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(100, 6);
    expect(out[3]).toBeCloseTo(50, 6);
  });

  it("returns all nulls when not enough data", () => {
    expect(rsi([1, 2], 2)).toEqual([null, null]);
  });
});
