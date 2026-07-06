import { describe, it, expect } from "vitest";
import { forecast } from "../src/forecast.js";
import { DISCLAIMER, type Kline } from "../src/types.js";

function series(closes: number[]): Kline[] {
  return closes.map((close, i) => ({
    openTime: i * 1000, open: close, high: close, low: close,
    close, volume: 1, closeTime: i * 1000 + 1,
  }));
}

const ramp = (n: number) => Array.from({ length: n }, (_, i) => 100 + i);

describe("forecast", () => {
  it("returns insufficient_data for a short series", () => {
    const r = forecast("X", series(ramp(10)));
    expect("status" in r && r.status).toBe("insufficient_data");
  });

  it("extrapolates a linear uptrend with a tight band", () => {
    const r = forecast("BTCPHP", series(ramp(60)), { horizon: 5 });
    if ("status" in r) throw new Error("expected a forecast");
    expect(r.method).toBe("holt-linear");
    expect(r.symbol).toBe("BTCPHP");
    expect(r.horizon).toBe(5);
    // last close 159, trend ~1/step => ~164 five steps out
    expect(r.predicted).toBeCloseTo(164, 0);
    expect(r.upper - r.lower).toBeLessThan(1);
    expect(r.disclaimer).toBe(DISCLAIMER);
  });

  it("predicts ~no change for a flat series and a near-zero band", () => {
    const r = forecast("X", series(Array.from({ length: 60 }, () => 100)), { horizon: 3 });
    if ("status" in r) throw new Error("expected a forecast");
    expect(r.predicted).toBeCloseTo(100, 6);
    expect(r.upper - r.lower).toBeCloseTo(0, 6);
  });

  it("produces a wider band for a noisy series", () => {
    const noisy = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5));
    const r = forecast("X", series(noisy), { horizon: 5 });
    if ("status" in r) throw new Error("expected a forecast");
    expect(r.upper - r.lower).toBeGreaterThan(1);
  });

  it("defaults the horizon to 5", () => {
    const r = forecast("X", series(ramp(60)));
    if ("status" in r) throw new Error("expected a forecast");
    expect(r.horizon).toBe(5);
  });
});
