import type { AssetClass } from "./types.js";
import type { SwingSnapshot } from "./analysis.js";
import {
  evaluateGates,
  computeRisk,
  type AccountState,
  type RiskConfig,
  type Direction,
  type GateReason,
} from "./risk.js";

export type SwingAction = "BUY" | "SELL" | "HOLD";

export interface SwingSignal {
  action: SwingAction;
  confidence: number;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  position_size_pct: number;
  reasoning: string;
  risk_flags: string[];
}

const GATE_FLAG: Record<GateReason, string> = {
  insufficient_data: "insufficient data",
  daily_loss_limit: "daily loss limit hit",
  weekly_loss_limit: "weekly loss limit hit",
  market_closed: "market closed",
  trend_momentum_conflict: "trend/momentum conflict",
  adding_to_loser: "adding to losing position blocked",
};

function hold(reasoning: string, risk_flags: string[]): SwingSignal {
  return {
    action: "HOLD",
    confidence: 0,
    entry_price: null,
    stop_loss: null,
    take_profit: null,
    position_size_pct: 0,
    reasoning,
    risk_flags,
  };
}

export function decide(
  snapshot: SwingSnapshot,
  account: AccountState,
  assetClass: AssetClass,
  config: RiskConfig,
): SwingSignal {
  const direction: Direction | null =
    snapshot.structure === "uptrend" ? "BUY" : snapshot.structure === "downtrend" ? "SELL" : null;

  if (direction === null) {
    return hold("Sideways structure — no trend to follow; holding.", []);
  }

  const gate = evaluateGates(snapshot, account, assetClass, direction);
  if (gate.blocked) {
    const flag = GATE_FLAG[gate.reason];
    return hold(`Trade blocked: ${flag}.`, [flag]);
  }

  let confidence = 60;
  const aligned =
    (direction === "BUY" && snapshot.priceVsEma === "above_both") ||
    (direction === "SELL" && snapshot.priceVsEma === "below_both");
  if (aligned) confidence += 15;
  confidence += Math.min(15, Math.round(Math.abs(snapshot.rsi - 50) / 2));

  const risk_flags: string[] = [];
  if (snapshot.divergence) {
    confidence -= 20;
    risk_flags.push("divergence risk");
  }
  if (snapshot.volatilitySpike) {
    confidence -= 10;
    risk_flags.push("high volatility regime");
  }
  confidence = Math.max(0, Math.min(100, confidence));

  const r = computeRisk(snapshot, account, assetClass, direction, config);

  const reasoning =
    `${snapshot.structure === "uptrend" ? "Uptrend" : "Downtrend"} confirmed: price ` +
    `${snapshot.priceVsEma.replace(/_/g, " ")} EMA50/EMA200 with RSI ${Math.round(snapshot.rsi)} ` +
    `and a ${snapshot.macdHistogram >= 0 ? "positive" : "negative"} MACD histogram. ` +
    `Momentum agrees with trend.` +
    (snapshot.volatilitySpike ? " ATR spike flagged — position size halved." : "") +
    (snapshot.divergence ? " Divergence warning — confidence reduced." : "");

  return {
    action: direction,
    confidence,
    entry_price: r.entryPrice,
    stop_loss: r.stopLoss,
    take_profit: r.takeProfit,
    position_size_pct: r.positionSizePct,
    reasoning,
    risk_flags,
  };
}
