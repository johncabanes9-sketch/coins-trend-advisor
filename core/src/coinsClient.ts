// core/src/coinsClient.ts
import type { Kline } from "./types.js";

const DEFAULT_BASE = "https://api.pro.coins.ph";

export interface CoinsClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

export class CoinsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(opts: CoinsClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async getKlines(pair: string, interval: string, limit = 200): Promise<Kline[]> {
    const path = `/openapi/quote/v1/klines?symbol=${encodeURIComponent(
      pair,
    )}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const rows = (await this.getJson(path)) as unknown[][];
    return rows.map((r) => ({
      openTime: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closeTime: Number(r[6]),
    }));
  }

  async getPrice(pair: string): Promise<number> {
    const path = `/openapi/quote/v1/ticker/price?symbol=${encodeURIComponent(pair)}`;
    const body = (await this.getJson(path)) as { price: string };
    return Number(body.price);
  }

  async getPairs(): Promise<string[]> {
    const body = (await this.getJson("/openapi/v1/pairs")) as
      | { symbol: string }[]
      | { data: { symbol: string }[] };
    const list = Array.isArray(body) ? body : body.data;
    return list.map((p) => p.symbol);
  }

  private async getJson(path: string): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(this.baseUrl + path);
      if (res.status === 429 && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "2");
        attempt++;
        await sleep(retryAfter * 1000);
        continue;
      }
      if (!res.ok) {
        const snippet = (await res.text()).slice(0, 200);
        throw new Error(`Coins.ph ${res.status} for ${path}: ${snippet}`);
      }
      return res.json();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
