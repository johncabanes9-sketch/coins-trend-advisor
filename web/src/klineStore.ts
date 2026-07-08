import type { Kline } from "@coins-trend-advisor/core";
import { Redis } from "@upstash/redis";

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

export interface RedisLike {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
}

const DEFAULT_TTL_SECONDS = 86_400; // 24h GC backstop; freshness is computed in code.

export class RedisKlineStore implements KlineStore {
  constructor(
    private readonly client: RedisLike,
    private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ) {}

  async get(key: string): Promise<StoredKlines | null> {
    try {
      const value = await this.client.get<StoredKlines>(key);
      return value ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: StoredKlines): Promise<void> {
    try {
      await this.client.set(key, value, { ex: this.ttlSeconds });
    } catch {
      // best-effort write; a Redis outage degrades to "no cache", never an error
    }
  }
}

export function makeKlineStore(
  env: NodeJS.ProcessEnv,
  opts: { maxEntries?: number } = {},
): KlineStore {
  const url = env.UPSTASH_REDIS_REST_URL;
  if (url) {
    const client = new Redis({ url, token: env.UPSTASH_REDIS_REST_TOKEN ?? "" });
    return new RedisKlineStore(client);
  }
  return new MemoryKlineStore({ maxEntries: opts.maxEntries });
}
