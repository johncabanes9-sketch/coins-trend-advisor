// core/test/profit.test.ts
import { describe, it, expect } from "vitest";
import { calculateProfit } from "../src/profit.js";

describe("calculateProfit", () => {
  it("computes a fee-free 10% gain", () => {
    const r = calculateProfit({
      entryPrice: 100,
      positionSize: 1000,
      targetPrice: 110,
      feePct: 0,
    });
    expect(r.grossProfit).toBeCloseTo(100, 6);
    expect(r.feesPaid).toBeCloseTo(0, 6);
    expect(r.netProfit).toBeCloseTo(100, 6);
    expect(r.netProfitPct).toBeCloseTo(10, 6);
  });

  it("subtracts fees on both buy and sell notional", () => {
    // buy notional 1000, sell notional 1100, feePct 1% -> fees = 21
    const r = calculateProfit({
      entryPrice: 100,
      positionSize: 1000,
      targetPrice: 110,
      feePct: 1,
    });
    expect(r.feesPaid).toBeCloseTo(21, 6);
    expect(r.netProfit).toBeCloseTo(79, 6);
    expect(r.netProfitPct).toBeCloseTo(7.9, 6);
  });

  it("throws on non-positive entry price", () => {
    expect(() =>
      calculateProfit({ entryPrice: 0, positionSize: 100, targetPrice: 1, feePct: 0 }),
    ).toThrow();
  });
});
