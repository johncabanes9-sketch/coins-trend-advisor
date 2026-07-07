import type { AssetClass } from "./types.js";
import type { SwingSnapshot } from "./analysis.js";

export type Direction = "BUY" | "SELL";

export interface AccountState {
  equity: number;
  position: { size: number; entryPrice: number } | null;
  lossToDate: { dayPct: number; weekPct: number };
  marketStatus?: "open" | "closed";
}

export interface RiskConfig {
  riskPct: number;
  rewardRisk: number;
  atrBufferStock: number;
  atrBufferCrypto: number;
  cryptoSizeFactor: number;
  volatilitySizeFactor: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  riskPct: 0.75,
  rewardRisk: 2,
  atrBufferStock: 1.75,
  atrBufferCrypto: 2.0,
  cryptoSizeFactor: 0.5,
  volatilitySizeFactor: 0.5,
};

export type GateReason =
  | "insufficient_data"
  | "daily_loss_limit"
  | "weekly_loss_limit"
  | "market_closed"
  | "trend_momentum_conflict"
  | "adding_to_loser";

export type Gate = { blocked: true; reason: GateReason } | { blocked: false };

export interface RiskOutputs {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSizePct: number;
}

const MIN_CANDLES = 200;
const DAILY_LOSS_LIMIT_PCT = 2;
const WEEKLY_LOSS_LIMIT_PCT = 5;

export function evaluateGates(
  snapshot: SwingSnapshot,
  account: AccountState,
  assetClass: AssetClass,
  direction: Direction,
): Gate {
  if (snapshot.candleCount < MIN_CANDLES) return { blocked: true, reason: "insufficient_data" };
  if (account.lossToDate.dayPct >= DAILY_LOSS_LIMIT_PCT) return { blocked: true, reason: "daily_loss_limit" };
  if (account.lossToDate.weekPct >= WEEKLY_LOSS_LIMIT_PCT) return { blocked: true, reason: "weekly_loss_limit" };
  if (assetClass === "stock" && account.marketStatus !== "open") return { blocked: true, reason: "market_closed" };
  if (!snapshot.trendMomentumAgree) return { blocked: true, reason: "trend_momentum_conflict" };
  const pos = account.position;
  if (
    direction === "BUY" &&
    pos !== null &&
    pos.size > 0 &&
    snapshot.lastClose < pos.entryPrice
  ) {
    return { blocked: true, reason: "adding_to_loser" };
  }
  return { blocked: false };
}

export function computeRisk(
  snapshot: SwingSnapshot,
  _account: AccountState,
  assetClass: AssetClass,
  direction: Direction,
  config: RiskConfig,
): RiskOutputs {
  const entry = snapshot.lastClose;
  const buffer =
    assetClass === "crypto" ? Math.max(config.atrBufferCrypto, 2) : config.atrBufferStock;
  const stopDistance = snapshot.atr14 * buffer;
  const stopLoss = direction === "BUY" ? entry - stopDistance : entry + stopDistance;
  const takeProfit =
    direction === "BUY"
      ? entry + stopDistance * config.rewardRisk
      : entry - stopDistance * config.rewardRisk;

  let sizePct = Math.min(config.riskPct, 1);
  if (assetClass === "crypto") sizePct *= config.cryptoSizeFactor;
  if (snapshot.volatilitySpike) sizePct *= config.volatilitySizeFactor;
  const positionSizePct = Math.min(sizePct, config.riskPct, 1);

  return { entryPrice: entry, stopLoss, takeProfit, positionSizePct };
}
