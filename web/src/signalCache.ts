import { generateSignal, type Kline, type Signal } from "@coins-trend-advisor/core";
import type { CoinsClient } from "@coins-trend-advisor/core";

export type SignalOk = {
  pair: string;
  status: "ok";
  signal: Signal;
  stale?: boolean;
  staleAsOf?: string;
};

export type SignalResult =
  | SignalOk
  | { pair: string; status: "insufficient_data" }
  | { pair: string; status: "error"; message: string };

type Cached =
  | { status: "ok"; signal: Signal }
  | { status: "insufficient_data" };

interface Entry {
  result: Cached;
  computedAt: number;
}

export interface SignalCacheDeps {
  client: Pick<CoinsClient, "getKlines">;
  ttlMs: number;
  klineLimit: number;
  now?: () => number;
}

export class SignalCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<SignalResult>>();

  constructor(private readonly deps: SignalCacheDeps) {}

  private clock(): number {
    return (this.deps.now ?? Date.now)();
  }

  async getSignal(pair: string, interval: string): Promise<SignalResult> {
    const key = `${pair}:${interval}`;
    const entry = this.entries.get(key);
    if (entry && this.clock() - entry.computedAt < this.deps.ttlMs) {
      return fresh(pair, entry);
    }

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const p = this.recompute(pair, interval, key).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  async getWatchlistSignals(
    pairs: string[],
    interval: string,
  ): Promise<SignalResult[]> {
    return Promise.all(pairs.map((p) => this.getSignal(p, interval)));
  }

  private async recompute(
    pair: string,
    interval: string,
    key: string,
  ): Promise<SignalResult> {
    try {
      const candles: Kline[] = await this.deps.client.getKlines(
        pair,
        interval,
        this.deps.klineLimit,
      );
      const sig = generateSignal(pair, candles);
      const result: Cached =
        "status" in sig
          ? { status: "insufficient_data" }
          : { status: "ok", signal: sig };
      const entry: Entry = { result, computedAt: this.clock() };
      this.entries.set(key, entry);
      return fresh(pair, entry);
    } catch (err) {
      const stale = this.entries.get(key);
      if (stale && stale.result.status === "ok") {
        return {
          pair,
          status: "ok",
          signal: stale.result.signal,
          stale: true,
          staleAsOf: new Date(stale.computedAt).toISOString(),
        };
      }
      return { pair, status: "error", message: (err as Error).message };
    }
  }
}

function fresh(pair: string, entry: Entry): SignalResult {
  if (entry.result.status === "insufficient_data") {
    return { pair, status: "insufficient_data" };
  }
  return { pair, status: "ok", signal: entry.result.signal };
}
