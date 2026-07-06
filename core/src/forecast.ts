import { DISCLAIMER, type Kline } from "./types.js";

const MIN_CANDLES = 35;
const Z_80 = 1.2816; // ~80% two-sided normal quantile
const GRID = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

export interface Forecast {
  symbol: string;
  horizon: number;
  predicted: number;
  lower: number;
  upper: number;
  method: "holt-linear";
  asOf: string;
  disclaimer: string;
}

interface HoltFit {
  level: number;
  trend: number;
  sse: number;
  count: number;
}

/** Holt's linear exponential smoothing; returns final level/trend and in-sample SSE. */
function holt(y: number[], alpha: number, beta: number): HoltFit {
  let level = y[0]!;
  let trend = y[1]! - y[0]!;
  let sse = 0;
  let count = 0;
  for (let t = 1; t < y.length; t++) {
    const oneStep = level + trend; // forecast for y[t] before observing it
    const actual = y[t]!;
    const err = actual - oneStep;
    sse += err * err;
    count += 1;
    const prevLevel = level;
    level = alpha * actual + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  return { level, trend, sse, count };
}

export function forecast(
  symbol: string,
  candles: Kline[],
  opts: { horizon?: number } = {},
): Forecast | { status: "insufficient_data" } {
  if (candles.length < MIN_CANDLES) {
    return { status: "insufficient_data" };
  }
  const horizon = opts.horizon ?? 5;
  const y = candles.map((c) => c.close);

  // Deterministic grid search minimizing one-step SSE (first minimum wins ties).
  let best = holt(y, GRID[0]!, GRID[0]!);
  for (const alpha of GRID) {
    for (const beta of GRID) {
      const fit = holt(y, alpha, beta);
      if (fit.sse < best.sse) best = fit;
    }
  }

  const predicted = best.level + horizon * best.trend;
  // Approximate ~80% band: scale the one-step error std as sigma_1 * sqrt(h)
  // (random-walk accumulation). This is a heuristic, not Holt's exact
  // prediction interval, and is mildly optimistic — `variance` is the minimized
  // in-sample SSE with no degrees-of-freedom correction for the fitted params.
  // Acceptable given the DISCLAIMER: a forecast is an estimate, never a promise.
  const variance = best.count > 0 ? best.sse / best.count : 0;
  const band = Z_80 * Math.sqrt(variance) * Math.sqrt(horizon);
  const asOf = new Date(candles[candles.length - 1]!.closeTime).toISOString();

  return {
    symbol,
    horizon,
    predicted,
    lower: predicted - band,
    upper: predicted + band,
    method: "holt-linear",
    asOf,
    disclaimer: DISCLAIMER,
  };
}
