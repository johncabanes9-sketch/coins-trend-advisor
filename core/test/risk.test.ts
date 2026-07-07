import { describe, it, expect } from "vitest";
import {
  evaluateGates,
  computeRisk,
  DEFAULT_RISK_CONFIG,
  type AccountState,
} from "../src/risk.js";
import type { SwingSnapshot } from "../src/analysis.js";

function snap(over: Partial<SwingSnapshot> = {}): SwingSnapshot {
  return {
    symbol: "BTCPHP",
    assetClass: "crypto",
    lastClose: 1000,
    ema50: 950,
    ema200: 900,
    priceVsEma: "above_both",
    structure: "uptrend",
    rsi: 60,
    macdHistogram: 5,
    momentum: "bullish",
    trendMomentumAgree: true,
    divergence: false,
    atr14: 10,
    atr20Avg: 10,
    volatilitySpike: false,
    candleCount: 240,
    ...over,
  };
}

const cleanAccount: AccountState = {
  equity: 100000,
  position: null,
  lossToDate: { dayPct: 0, weekPct: 0 },
  marketStatus: "open",
};

describe("evaluateGates", () => {
  it("passes a clean agreed uptrend", () => {
    expect(evaluateGates(snap(), cleanAccount, "crypto", "BUY")).toEqual({ blocked: false });
  });
  it("blocks insufficient data", () => {
    expect(evaluateGates(snap({ candleCount: 100 }), cleanAccount, "crypto", "BUY"))
      .toEqual({ blocked: true, reason: "insufficient_data" });
  });
  it("blocks daily loss limit at 2%", () => {
    const a = { ...cleanAccount, lossToDate: { dayPct: 2, weekPct: 0 } };
    expect(evaluateGates(snap(), a, "crypto", "BUY")).toEqual({ blocked: true, reason: "daily_loss_limit" });
  });
  it("blocks weekly loss limit at 5%", () => {
    const a = { ...cleanAccount, lossToDate: { dayPct: 0, weekPct: 5 } };
    expect(evaluateGates(snap(), a, "crypto", "BUY")).toEqual({ blocked: true, reason: "weekly_loss_limit" });
  });
  it("blocks a closed stock market", () => {
    const a = { ...cleanAccount, marketStatus: "closed" as const };
    expect(evaluateGates(snap({ assetClass: "stock" }), a, "stock", "BUY"))
      .toEqual({ blocked: true, reason: "market_closed" });
  });
  it("blocks trend/momentum conflict", () => {
    expect(evaluateGates(snap({ trendMomentumAgree: false }), cleanAccount, "crypto", "BUY"))
      .toEqual({ blocked: true, reason: "trend_momentum_conflict" });
  });
  it("blocks adding to a losing long", () => {
    const a: AccountState = { ...cleanAccount, position: { size: 0.5, entryPrice: 1200 } };
    // lastClose 1000 < entry 1200 -> long is underwater
    expect(evaluateGates(snap(), a, "crypto", "BUY")).toEqual({ blocked: true, reason: "adding_to_loser" });
  });
});

describe("computeRisk", () => {
  it("places stop below and TP above entry for BUY, with crypto buffer >= 2", () => {
    const r = computeRisk(snap(), cleanAccount, "crypto", "BUY", DEFAULT_RISK_CONFIG);
    expect(r.entryPrice).toBe(1000);
    expect(r.stopLoss).toBeCloseTo(1000 - 10 * 2, 6); // buffer max(2.0,2)=2
    expect(r.takeProfit).toBeCloseTo(1000 + 10 * 2 * 2, 6);
  });
  it("mirrors stop/TP for SELL", () => {
    const r = computeRisk(snap({ structure: "downtrend", momentum: "bearish" }), cleanAccount, "crypto", "SELL", DEFAULT_RISK_CONFIG);
    expect(r.stopLoss).toBeCloseTo(1000 + 10 * 2, 6);
    expect(r.takeProfit).toBeCloseTo(1000 - 10 * 2 * 2, 6);
  });
  it("makes crypto size half of stock size for the same inputs", () => {
    const crypto = computeRisk(snap(), cleanAccount, "crypto", "BUY", DEFAULT_RISK_CONFIG);
    const stock = computeRisk(snap({ assetClass: "stock" }), cleanAccount, "stock", "BUY", DEFAULT_RISK_CONFIG);
    expect(crypto.positionSizePct).toBeCloseTo(stock.positionSizePct * 0.5, 6);
  });
  it("halves size on a volatility spike", () => {
    const normal = computeRisk(snap(), cleanAccount, "crypto", "BUY", DEFAULT_RISK_CONFIG);
    const spiked = computeRisk(snap({ volatilitySpike: true }), cleanAccount, "crypto", "BUY", DEFAULT_RISK_CONFIG);
    expect(spiked.positionSizePct).toBeCloseTo(normal.positionSizePct * 0.5, 6);
  });
  it("never exceeds riskPct or 1%", () => {
    const r = computeRisk(snap(), cleanAccount, "stock", "BUY", { ...DEFAULT_RISK_CONFIG, riskPct: 5 });
    expect(r.positionSizePct).toBeLessThanOrEqual(1);
  });
});
