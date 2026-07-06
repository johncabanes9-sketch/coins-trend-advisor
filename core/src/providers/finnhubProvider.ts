import type { AssetClass, Kline, MarketDataProvider } from "../types.js";

const DEFAULT_BASE = "https://finnhub.io/api/v1";

const RESOLUTION_SECONDS: Record<string, number> = { D: 86_400, W: 604_800 };

export interface FinnhubProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface CandleResponse {
  s: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
}

export class FinnhubProvider implements MarketDataProvider {
  readonly assetClass: AssetClass = "stock";
  readonly allowedIntervals = ["D", "W"];
  readonly defaultInterval = "D";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(opts: FinnhubProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  async getKlines(symbol: string, interval: string, limit = 200): Promise<Kline[]> {
    const resSeconds = RESOLUTION_SECONDS[interval];
    if (resSeconds === undefined) {
      throw new Error(`Finnhub: unsupported interval "${interval}"`);
    }
    const to = Math.floor(this.now() / 1000);
    // Widen the window (x3) so weekends/holidays still yield `limit` candles.
    const from = to - resSeconds * limit * 3;
    const path =
      `/stock/candle?symbol=${encodeURIComponent(symbol)}` +
      `&resolution=${encodeURIComponent(interval)}&from=${from}&to=${to}` +
      `&token=${encodeURIComponent(this.apiKey)}`;
    const body = (await this.getJson(path)) as CandleResponse;
    if (body.s === "no_data" || !body.t || body.t.length === 0) {
      return [];
    }
    const t = body.t;
    const o = body.o ?? [];
    const h = body.h ?? [];
    const l = body.l ?? [];
    const c = body.c ?? [];
    const v = body.v ?? [];
    // Finnhub returns parallel arrays; a length mismatch would silently produce
    // NaN candles that flow into the signal engine. Fail honestly instead.
    if (
      o.length < t.length ||
      h.length < t.length ||
      l.length < t.length ||
      c.length < t.length ||
      v.length < t.length
    ) {
      throw new Error("Finnhub: malformed candle response (array length mismatch)");
    }
    const resMs = resSeconds * 1000;
    const rows: Kline[] = t.map((sec, i) => {
      const openTime = sec * 1000;
      return {
        openTime,
        open: Number(o[i]),
        high: Number(h[i]),
        low: Number(l[i]),
        close: Number(c[i]),
        volume: Number(v[i]),
        closeTime: openTime + resMs,
      };
    });
    return rows.slice(-limit);
  }

  async getPrice(symbol: string): Promise<number> {
    const path =
      `/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(this.apiKey)}`;
    const body = (await this.getJson(path)) as { c: number };
    return Number(body.c);
  }

  async listSymbols(): Promise<string[]> {
    const path = `/stock/symbol?exchange=US&token=${encodeURIComponent(this.apiKey)}`;
    const body = (await this.getJson(path)) as { symbol: string }[];
    return body.map((s) => s.symbol);
  }

  private async getJson(path: string): Promise<unknown> {
    const res = await this.fetchImpl(this.baseUrl + path);
    if (!res.ok) {
      // Note: the path embeds the token; never surface it to clients. Callers
      // (web) already sanitize provider errors to a static message.
      throw new Error(`Finnhub ${res.status} for ${path.split("?")[0]}`);
    }
    return res.json();
  }
}
