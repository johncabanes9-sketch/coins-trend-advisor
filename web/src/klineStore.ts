import type { Kline } from "@coins-trend-advisor/core";

export interface StoredKlines {
  klines: Kline[];
  computedAt: number;
}

export interface KlineStore {
  get(key: string): Promise<StoredKlines | null>;
  set(key: string, value: StoredKlines): Promise<void>;
}

const DEFAULT_MAX_ENTRIES = 1000;

export class MemoryKlineStore implements KlineStore {
  private readonly entries = new Map<string, StoredKlines>();
  private readonly maxEntries: number;

  constructor(opts: { maxEntries?: number } = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  async get(key: string): Promise<StoredKlines | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: StoredKlines): Promise<void> {
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
