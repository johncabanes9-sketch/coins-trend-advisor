import { describe, it, expect } from "vitest";
import { macd } from "../../src/indicators/macd.js";

describe("macd", () => {
  it("is positive on a steady uptrend", () => {
    const closes = Array.from({ length: 40 }, (_, i) => i + 1); // 1..40
    const out = macd(closes, 12, 26, 9);
    const last = out.macd[out.macd.length - 1];
    const lastHist = out.histogram[out.histogram.length - 1];
    expect(last).not.toBeNull();
    expect(last!).toBeGreaterThan(0); // fast EMA above slow EMA in an uptrend
    expect(lastHist).not.toBeNull();
    expect(lastHist!).toBeGreaterThan(0); // macd still above its signal line
  });

  it("leaves early indices null until slow EMA is defined", () => {
    const closes = Array.from({ length: 40 }, (_, i) => i + 1);
    const out = macd(closes, 12, 26, 9);
    expect(out.macd[24]).toBeNull(); // slow EMA seeds at index 25
    expect(out.macd[25]).not.toBeNull();
  });
});
