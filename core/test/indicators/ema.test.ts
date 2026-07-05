import { describe, it, expect } from "vitest";
import { ema } from "../../src/indicators/ema.js";

describe("ema", () => {
  it("returns nulls until the seed index, then SMA seed", () => {
    // period 3 over [1,2,3,4,5,6], k = 2/4 = 0.5
    // seed at index 2 = mean(1,2,3) = 2
    // i3: 4*0.5 + 2*0.5 = 3 ; i4: 5*0.5 + 3*0.5 = 4 ; i5: 6*0.5 + 4*0.5 = 5
    expect(ema([1, 2, 3, 4, 5, 6], 3)).toEqual([null, null, 2, 3, 4, 5]);
  });

  it("returns all nulls when fewer values than period", () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });

  it("throws on period < 1", () => {
    expect(() => ema([1, 2, 3], 0)).toThrow();
  });
});
