import { describe, it, expect } from "vitest";
import { generateSignal, calculateProfit, CoinsClient } from "@coins-trend-advisor/core";

describe("core workspace wiring", () => {
  it("resolves the core package from web", () => {
    expect(typeof generateSignal).toBe("function");
    expect(typeof calculateProfit).toBe("function");
    expect(typeof CoinsClient).toBe("function");
  });
});
