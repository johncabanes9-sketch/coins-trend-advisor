import type { AssetClass, Signal, Forecast } from "@coins-trend-advisor/core";

export type { AssetClass, Signal, Forecast };

export interface ApiError {
  code: string;
  message: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface WatchlistEntry {
  assetClass: AssetClass;
  symbol: string;
}

export interface SignalItem {
  assetClass: AssetClass;
  symbol: string;
  status: "ok" | "insufficient_data" | "error";
  signal?: Signal;
  message?: string;
  stale?: boolean;
  staleAsOf?: string;
}

export interface ForecastItem {
  assetClass: AssetClass;
  symbol: string;
  status: "ok" | "insufficient_data" | "error";
  forecast?: Forecast;
  message?: string;
  stale?: boolean;
  staleAsOf?: string;
}

export type ProfitResult = Record<string, number>;
