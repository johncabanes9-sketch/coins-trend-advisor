import { forecast, type AssetClass, type Forecast } from "@coins-trend-advisor/core";
import type { KlineCache, KlinesResult } from "./klineCache.js";

export type ForecastResult =
  | { assetClass: AssetClass; symbol: string; status: "ok"; forecast: Forecast; stale?: boolean; staleAsOf?: string }
  | { assetClass: AssetClass; symbol: string; status: "insufficient_data" }
  | { assetClass: AssetClass; symbol: string; status: "error"; message: string };

export interface ForecastServiceDeps {
  cache: KlineCache;
}

export class ForecastService {
  constructor(private readonly deps: ForecastServiceDeps) {}

  async get(
    assetClass: AssetClass,
    symbol: string,
    interval: string,
    horizon: number,
  ): Promise<ForecastResult> {
    const klines = await this.deps.cache.getKlines(assetClass, symbol, interval);
    return toForecast(assetClass, symbol, klines, horizon);
  }

  async getMany(
    entries: { assetClass: AssetClass; symbol: string }[],
    interval: string,
    horizon: number,
  ): Promise<ForecastResult[]> {
    const results = await this.deps.cache.getMany(entries, interval);
    return results.map((k, i) =>
      toForecast(entries[i]!.assetClass, entries[i]!.symbol, k, horizon),
    );
  }
}

function toForecast(
  assetClass: AssetClass,
  symbol: string,
  klines: KlinesResult,
  horizon: number,
): ForecastResult {
  if (klines.status === "error") {
    return { assetClass, symbol, status: "error", message: klines.message };
  }
  const f = forecast(symbol, klines.klines, { horizon });
  if ("status" in f) {
    return { assetClass, symbol, status: "insufficient_data" };
  }
  const base = { assetClass, symbol, status: "ok" as const, forecast: f };
  return klines.stale ? { ...base, stale: true, staleAsOf: klines.staleAsOf } : base;
}
