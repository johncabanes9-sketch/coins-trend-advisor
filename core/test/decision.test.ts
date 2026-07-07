import { describe, it, expect } from "vitest";
import { decide } from "../src/decision.js";
import { DEFAULT_RISK_CONFIG, type AccountState } from "../src/risk.js";
import type { SwingSnapshot } from "../src/analysis.js";

function snap(over: Partial<SwingSnapshot> = {}): SwingSnapshot {
  return {
    symbol: "BTCPHP", assetClass: "crypto", lastClose: 1000, ema50: 950, ema200: 900,
    priceVsEma: "above_both", structure: "uptrend", rsi: 62, macdHistogram: 5,
    momentum: "bullish", trendMomentumAgree: true, divergence: false, atr14: 10,
    atr20Avg: 10, volatilitySpike: false, candleCount: 240, ...over,
  };
}
const account: AccountState = {
  equity: 100000, position: null, lossToDate: { dayPct: 0, weekPct: 0 }, marketStatus: "open",
};

describe("decide", () => {
  it("BUYs an agreed uptrend with non-null prices and a computed confidence", () => {
    const s = decide(snap(), account, "crypto", DEFAULT_RISK_CONFIG);
    expect(s.action).toBe("BUY");
    expect(s.confidence).toBeGreaterThan(60);
    expect(s.entry_price).not.toBeNull();
    expect(s.stop_loss).not.toBeNull();
    expect(s.take_profit).not.toBeNull();
    expect(s.position_size_pct).toBeGreaterThan(0);
    expect(s.reasoning).toContain("Uptrend");
  });

  it("HOLDs a sideways market with confidence 0 and null prices", () => {
    const s = decide(snap({ structure: "sideways", momentum: "neutral", trendMomentumAgree: false }), account, "crypto", DEFAULT_RISK_CONFIG);
    expect(s.action).toBe("HOLD");
    expect(s.confidence).toBe(0);
    expect(s.entry_price).toBeNull();
    expect(s.position_size_pct).toBe(0);
  });

  it("HOLDs and flags when a gate blocks", () => {
    const a = { ...account, lossToDate: { dayPct: 3, weekPct: 0 } };
    const s = decide(snap(), a, "crypto", DEFAULT_RISK_CONFIG);
    expect(s.action).toBe("HOLD");
    expect(s.confidence).toBe(0);
    expect(s.risk_flags).toContain("daily loss limit hit");
  });

  it("subtracts at least 20 for divergence", () => {
    const base = decide(snap(), account, "crypto", DEFAULT_RISK_CONFIG);
    const div = decide(snap({ divergence: true }), account, "crypto", DEFAULT_RISK_CONFIG);
    expect(base.confidence - div.confidence).toBeGreaterThanOrEqual(20);
    expect(div.risk_flags).toContain("divergence risk");
  });

  it("subtracts 10 and halves size on a volatility spike", () => {
    const base = decide(snap(), account, "crypto", DEFAULT_RISK_CONFIG);
    const spk = decide(snap({ volatilitySpike: true }), account, "crypto", DEFAULT_RISK_CONFIG);
    expect(base.confidence - spk.confidence).toBe(10);
    expect(spk.position_size_pct).toBeCloseTo(base.position_size_pct * 0.5, 6);
    expect(spk.risk_flags).toContain("high volatility regime");
  });
});
