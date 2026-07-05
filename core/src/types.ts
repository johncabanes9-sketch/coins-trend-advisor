/** One candlestick, normalized from the Coins.ph klines response. */
export interface Kline {
  openTime: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number; // ms epoch
}

export type Vote = "bullish" | "bearish" | "neutral";

export type Trend = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";

/** Raw indicator readings captured on the latest candle. */
export interface IndicatorSnapshot {
  rsi: number;
  emaCrossover: "bullish" | "bearish" | "none";
  macd: number; // histogram value (macd line - signal line)
  bollinger: "upper" | "lower" | "mid";
}

export interface Signal {
  pair: string;
  trend: Trend;
  confidence: number; // 0-1
  reasoning: string;
  indicators: IndicatorSnapshot;
  asOf: string; // ISO timestamp of the latest candle's closeTime
  disclaimer: string;
}

export const DISCLAIMER =
  "Technical-indicator-based estimate, not a guarantee of outcome.";
