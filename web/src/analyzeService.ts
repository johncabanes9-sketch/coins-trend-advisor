import {
  buildSnapshot,
  decide,
  type AccountState,
  type AssetClass,
  type RiskConfig,
  type SwingSignal,
} from "@coins-trend-advisor/core";
import type { KlineCache } from "./klineCache.js";

export interface AnalyzeServiceDeps {
  cache: KlineCache;
  risk: RiskConfig;
}

function safeHold(reasoning: string): SwingSignal {
  return {
    action: "HOLD",
    confidence: 0,
    entry_price: null,
    stop_loss: null,
    take_profit: null,
    position_size_pct: 0,
    reasoning,
    risk_flags: ["insufficient data"],
  };
}

export class AnalyzeService {
  constructor(private readonly deps: AnalyzeServiceDeps) {}

  async analyze(
    assetClass: AssetClass,
    symbol: string,
    interval: string,
    account: AccountState,
  ): Promise<SwingSignal> {
    const klines = await this.deps.cache.getKlines(assetClass, symbol, interval);
    if (klines.status === "error") {
      return safeHold("No decision: market data unavailable.");
    }
    const snapshot = buildSnapshot(symbol, assetClass, klines.klines);
    if ("status" in snapshot) {
      return safeHold("No decision: not enough candles for analysis.");
    }
    return decide(snapshot, account, assetClass, this.deps.risk);
  }
}
