import { generateSignal, type AssetClass, type Signal } from "@coins-trend-advisor/core";
import type { KlineCache, KlinesResult } from "./klineCache.js";

export type SignalResult =
  | { assetClass: AssetClass; symbol: string; status: "ok"; signal: Signal; stale?: boolean; staleAsOf?: string }
  | { assetClass: AssetClass; symbol: string; status: "insufficient_data" }
  | { assetClass: AssetClass; symbol: string; status: "error"; message: string };

export interface SignalServiceDeps {
  cache: KlineCache;
}

export class SignalService {
  constructor(private readonly deps: SignalServiceDeps) {}

  async get(assetClass: AssetClass, symbol: string, interval: string): Promise<SignalResult> {
    const klines = await this.deps.cache.getKlines(assetClass, symbol, interval);
    return toSignal(assetClass, symbol, klines);
  }

  async getMany(
    entries: { assetClass: AssetClass; symbol: string }[],
    interval: string,
  ): Promise<SignalResult[]> {
    const results = await this.deps.cache.getMany(entries, interval);
    return results.map((k, i) => toSignal(entries[i]!.assetClass, entries[i]!.symbol, k));
  }
}

function toSignal(
  assetClass: AssetClass,
  symbol: string,
  klines: KlinesResult,
): SignalResult {
  if (klines.status === "error") {
    return { assetClass, symbol, status: "error", message: klines.message };
  }
  const sig = generateSignal(symbol, klines.klines);
  if ("status" in sig) {
    return { assetClass, symbol, status: "insufficient_data" };
  }
  const base = { assetClass, symbol, status: "ok" as const, signal: sig };
  return klines.stale
    ? { ...base, stale: true, staleAsOf: klines.staleAsOf }
    : base;
}
