import type { AssetClass, Kline, MarketDataProvider } from "@coins-trend-advisor/core";

export type KlinesResult =
  | { status: "ok"; klines: Kline[]; stale?: boolean; staleAsOf?: string }
  | { status: "error"; message: string };

interface Entry {
  klines: Kline[];
  computedAt: number;
}

export interface KlineCacheDeps {
  resolveProvider(ac: AssetClass): MarketDataProvider;
  ttlMs: number;
  klineLimit: number;
  now?: () => number;
}

export class KlineCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<KlinesResult>>();

  constructor(private readonly deps: KlineCacheDeps) {}

  private clock(): number {
    return (this.deps.now ?? Date.now)();
  }

  async getKlines(
    assetClass: AssetClass,
    symbol: string,
    interval: string,
  ): Promise<KlinesResult> {
    const key = `${assetClass}:${symbol}:${interval}`;
    const entry = this.entries.get(key);
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
      this.entries.set(key, { klines, computedAt: this.clock() });
      return { status: "ok", klines };
    } catch (err) {
      const stale = this.entries.get(key);
      if (stale) {
        return {
          status: "ok",
          klines: stale.klines,
          stale: true,
          staleAsOf: new Date(stale.computedAt).toISOString(),
        };
      }
      return { status: "error", message: (err as Error).message };
    }
  }
}
