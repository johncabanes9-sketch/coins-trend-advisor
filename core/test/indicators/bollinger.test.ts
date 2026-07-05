import { describe, it, expect } from "vitest";
import { bollinger } from "../../src/indicators/bollinger.js";

describe("bollinger", () => {
  it("computes middle/upper/lower with population stddev", () => {
    // period 3, k 2 over [2,4,6]: SMA=4, popVariance=((−2)^2+0+2^2)/3=8/3
    // stddev=sqrt(8/3)=1.632993..., upper=4+2*sd=7.265986, lower=0.734014
    const out = bollinger([2, 4, 6], 3, 2);
    expect(out.middle[2]).toBeCloseTo(4, 6);
    expect(out.upper[2]).toBeCloseTo(7.265986, 5);
    expect(out.lower[2]).toBeCloseTo(0.734014, 5);
    expect(out.middle[0]).toBeNull();
    expect(out.middle[1]).toBeNull();
  });
});
