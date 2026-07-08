import type { AssetClass, Kline, MarketDataProvider } from "@coins-trend-advisor/core";
import { MemoryKlineStore, type KlineStore } from "./klineStore.js";

export type KlinesResult =
  | { status: "ok"; klines: Kline[]; stale?: boolean; staleAsOf?: string }
  | { status: "error"; message: string };

export interface KlineCacheDeps {
  resolveProvider(ac: AssetClass): MarketDataProvider;
  ttlMs: number;
  klineLimit: number;
  now?: () => number;
  /** Cap on distinct cached keys before oldest are evicted. Only used when no
   * `store` is supplied (applies to the default in-memory store). Default 1000. */
  maxEntries?: number;
  /** Backing store. Defaults to an in-memory store; production injects Redis. */
  store?: KlineStore;
}

export class KlineCache {
  private readonly store: KlineStore;
  private readonly inflight = new Map<string, Promise<KlinesResult>>();

  constructor(private readonly deps: KlineCacheDeps) {
    this.store = deps.store ?? new MemoryKlineStore({ maxEntries: deps.maxEntries });
  }

  private clock(): number {
    return (this.deps.now ?? Date.now)();
  }

  async getKlines(
    assetClass: AssetClass,
    symbol: string,
    interval: string,
  ): Promise<KlinesResult> {
    const key = `${assetClass}:${symbol}:${interval}`;
    const entry = await this.store.get(key);
    if (entry && this.clock() - entry.computedAt < this.deps.ttlMs) {
      return { status: "ok", klines: entry.klines };
    }

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const p = this.recompute(assetClass, symbol, interval, key).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  async getMany(
    entries: { assetClass: AssetClass; symbol: string }[],
    interval: string,
  ): Promise<KlinesResult[]> {
    return Promise.all(
      entries.map((e) => this.getKlines(e.assetClass, e.symbol, interval)),
    );
  }

  private async recompute(
    assetClass: AssetClass,
    symbol: string,
    interval: string,
    key: string,
  ): Promise<KlinesResult> {
    try {
      const provider = this.deps.resolveProvider(assetClass);
      const klines = await provider.getKlines(symbol, interval, this.deps.klineLimit);
      await this.store.set(key, { klines, computedAt: this.clock() });
      return { status: "ok", klines };
    } catch (err) {
      const stale = await this.store.get(key);
      if (stale) {
        return {
          status: "ok",
          klines: stale.klines,
          stale: true,
          staleAsOf: new Date(stale.computedAt).toISOString(),
        };
      }
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
