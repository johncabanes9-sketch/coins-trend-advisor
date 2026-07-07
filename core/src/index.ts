export * from "./types.js";
export { ema, rsi, macd, bollinger } from "./indicators/index.js";
export type { BollingerBands, MacdResult } from "./indicators/index.js";
export { generateSignal } from "./signal.js";
export { forecast, type Forecast } from "./forecast.js";
export { calculateProfit, type ProfitInput, type ProfitResult } from "./profit.js";
export { CoinsClient, type CoinsClientOptions } from "./coinsClient.js";
export { CoinsProvider } from "./providers/coinsProvider.js";
export { FinnhubProvider, type FinnhubProviderOptions } from "./providers/finnhubProvider.js";
export { buildSnapshot, type SwingSnapshot } from "./analysis.js";
export {
  evaluateGates,
  computeRisk,
  DEFAULT_RISK_CONFIG,
  type AccountState,
  type RiskConfig,
  type Gate,
  type GateReason,
  type RiskOutputs,
  type Direction,
} from "./risk.js";
export { decide, type SwingSignal, type SwingAction } from "./decision.js";
