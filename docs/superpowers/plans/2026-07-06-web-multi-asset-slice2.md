# Multi-Asset Support (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the crypto-only backend to serve both crypto (Coins.ph) and stocks (Finnhub) behind a `MarketDataProvider` abstraction, addressed by explicit asset class in the route.

**Architecture:** `core` gains a `MarketDataProvider` interface with `CoinsProvider` and `FinnhubProvider` implementations, both normalizing to the existing `Kline` shape. `web`'s `SignalCache` is refactored into a `KlineCache` that caches raw candles keyed by `assetClass:symbol:interval`; a thin `SignalService` computes signals as a pure function over cached klines. A `ProviderRegistry` resolves the provider per request and yields a `stocks_disabled` state when no Finnhub key is configured.

**Tech Stack:** TypeScript (strict, ESM, `noUncheckedIndexedAccess`), Express 4, Vitest + supertest, injected `fetch`/`now` for deterministic tests. Node 20+.

## Global Constraints

- Packages are ESM (`"type": "module"`). Node 20+.
- `web` imports only from `@coins-trend-advisor/core`'s public surface — never from `core/src/**` internals in source.
- Stateless slice: no Postgres, scheduler, web-push, or frontend.
- All routes under `/api`, JSON in/out. Error shape is always `{ error: { code, message } }`.
- Upstream error detail is never returned to clients — it is logged server-side and replaced with a static message (established in Slice 1).
- Asset classes: `"crypto"` and `"stock"`. Crypto intervals `["1h","4h"]` (default `"1h"`); stock intervals `["D","W"]` (default `"D"`). `core` requires ≥ 35 candles; `KLINE_LIMIT` default 200.
- Default crypto watchlist: `BTCPHP,ETHPHP,XRPPHP,SOLPHP,USDTPHP`. Stock watchlist defaults empty.
- Finnhub key via `FINNHUB_API_KEY`; absent → stocks disabled (routes return `503 stocks_disabled`), and stock watchlist entries are dropped from effective reads but still listed by `/api/watchlist`.

---

## File Structure

```
core/src/
  types.ts                  (modify) add AssetClass + MarketDataProvider
  providers/
    coinsProvider.ts        (create) CoinsProvider implements MarketDataProvider
    finnhubProvider.ts      (create) FinnhubProvider implements MarketDataProvider
  index.ts                  (modify) export new types + providers
core/test/
  coinsProvider.test.ts     (create)
  finnhubProvider.test.ts   (create)

web/src/
  config.ts                 (modify) WatchlistEntry[], finnhub + per-class intervals
  klineCache.ts             (create) KlineCache (replaces signalCache.ts)
  signalCache.ts            (delete) superseded by klineCache.ts + signalService.ts
  signalService.ts          (create) SignalService over KlineCache
  providers.ts              (create) ProviderRegistry + buildRegistry(config)
  server.ts                 (modify) new AppDeps; mount asset-class routes
  routes/signals.ts         (modify) /signals/:assetClass(/:symbol)
  routes/watchlist.ts       (modify) tagged watchlist + /pairs/:assetClass
  coins.ts                  (modify) makeCoinsProvider(config)
  index.ts                  (modify) wire registry, cache, service
web/test/
  klineCache.test.ts        (create, ports signalCache.test.ts)
  signalCache.test.ts       (delete)
  signalService.test.ts     (create)
  providers.test.ts         (create)
  config.test.ts            (modify)
  routes.signals.test.ts    (modify)
  routes.meta.test.ts       (modify)
  smoke.live.test.ts        (modify) add a stock symbol path
```

---

## Task 1: `MarketDataProvider` interface + `CoinsProvider` (core)

**Files:**
- Modify: `core/src/types.ts`
- Create: `core/src/providers/coinsProvider.ts`
- Modify: `core/src/index.ts`
- Test: `core/test/coinsProvider.test.ts`

**Interfaces:**
- Consumes: existing `Kline` (`core/src/types.ts`), `CoinsClient` (`core/src/coinsClient.ts`).
- Produces:
  - `type AssetClass = "crypto" | "stock"`
  - `interface MarketDataProvider { readonly assetClass: AssetClass; readonly allowedIntervals: string[]; readonly defaultInterval: string; getKlines(symbol: string, interval: string, limit?: number): Promise<Kline[]>; getPrice(symbol: string): Promise<number>; listSymbols(): Promise<string[]> }`
  - `class CoinsProvider implements MarketDataProvider`

- [ ] **Step 1: Add the interface to `core/src/types.ts`**

Append to `core/src/types.ts`:

```ts
export type AssetClass = "crypto" | "stock";

/** Uniform read surface over a market-data source (crypto exchange, stock API). */
export interface MarketDataProvider {
  readonly assetClass: AssetClass;
  readonly allowedIntervals: string[];
  readonly defaultInterval: string;
  getKlines(symbol: string, interval: string, limit?: number): Promise<Kline[]>;
  getPrice(symbol: string): Promise<number>;
  listSymbols(): Promise<string[]>;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// core/test/coinsProvider.test.ts
import { describe, it, expect, vi } from "vitest";
import { CoinsProvider } from "../src/providers/coinsProvider.js";
import type { Kline } from "../src/types.js";

function candle(i: number): Kline {
  return { openTime: i, open: i, high: i, low: i, close: i, volume: 1, closeTime: i + 1 };
}

describe("CoinsProvider", () => {
  it("advertises crypto metadata", () => {
    const p = new CoinsProvider({ getKlines: vi.fn(), getPrice: vi.fn(), getPairs: vi.fn() });
    expect(p.assetClass).toBe("crypto");
    expect(p.allowedIntervals).toEqual(["1h", "4h"]);
    expect(p.defaultInterval).toBe("1h");
  });

  it("delegates getKlines to the client with the limit", async () => {
    const rows = [candle(0), candle(1)];
    const getKlines = vi.fn(async () => rows);
    const p = new CoinsProvider({ getKlines, getPrice: vi.fn(), getPairs: vi.fn() });
    const out = await p.getKlines("BTCPHP", "1h", 200);
    expect(out).toBe(rows);
    expect(getKlines).toHaveBeenCalledWith("BTCPHP", "1h", 200);
  });

  it("maps listSymbols to the client's getPairs", async () => {
    const getPairs = vi.fn(async () => ["BTCPHP", "ETHPHP"]);
    const p = new CoinsProvider({ getKlines: vi.fn(), getPrice: vi.fn(), getPairs });
    expect(await p.listSymbols()).toEqual(["BTCPHP", "ETHPHP"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd core && npx vitest run test/coinsProvider.test.ts`
Expected: FAIL — cannot resolve `../src/providers/coinsProvider.js`.

- [ ] **Step 4: Write `core/src/providers/coinsProvider.ts`**

```ts
import type { CoinsClient } from "../coinsClient.js";
import type { AssetClass, Kline, MarketDataProvider } from "../types.js";

type CoinsClientLike = Pick<CoinsClient, "getKlines" | "getPrice" | "getPairs">;

export class CoinsProvider implements MarketDataProvider {
  readonly assetClass: AssetClass = "crypto";
  readonly allowedIntervals = ["1h", "4h"];
  readonly defaultInterval = "1h";

  constructor(private readonly client: CoinsClientLike) {}

  getKlines(symbol: string, interval: string, limit?: number): Promise<Kline[]> {
    return this.client.getKlines(symbol, interval, limit);
  }

  getPrice(symbol: string): Promise<number> {
    return this.client.getPrice(symbol);
  }

  listSymbols(): Promise<string[]> {
    return this.client.getPairs();
  }
}
```

- [ ] **Step 5: Export from `core/src/index.ts`**

Add these lines to `core/src/index.ts` (after the existing `CoinsClient` export):

```ts
export { CoinsProvider } from "./providers/coinsProvider.js";
```

(`AssetClass` and `MarketDataProvider` are already re-exported via `export * from "./types.js"`.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd core && npx vitest run test/coinsProvider.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck + commit**

```bash
cd core && npm run typecheck
git add core/src/types.ts core/src/providers/coinsProvider.ts core/src/index.ts core/test/coinsProvider.test.ts
git commit -m "feat(core): add MarketDataProvider abstraction and CoinsProvider"
```

---

## Task 2: `FinnhubProvider` (core)

**Files:**
- Create: `core/src/providers/finnhubProvider.ts`
- Modify: `core/src/index.ts`
- Test: `core/test/finnhubProvider.test.ts`

**Interfaces:**
- Consumes: `Kline`, `AssetClass`, `MarketDataProvider` (Task 1).
- Produces:
  - `interface FinnhubProviderOptions { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch; now?: () => number }`
  - `class FinnhubProvider implements MarketDataProvider`

**Notes:** Finnhub's stock-candle endpoint returns parallel arrays `{ c, h, l, o, t, v, s }` where `s` is `"ok"` or `"no_data"`. `t` is candle open time in **seconds**. Resolutions used: `D` (86400s) and `W` (604800s). Because markets are closed on weekends/holidays, we request a wider `from..to` window (×3 the naive span) and keep the newest `limit` candles.

- [ ] **Step 1: Write the failing test**

```ts
// core/test/finnhubProvider.test.ts
import { describe, it, expect, vi } from "vitest";
import { FinnhubProvider } from "../src/providers/finnhubProvider.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

describe("FinnhubProvider", () => {
  it("advertises stock metadata", () => {
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl: vi.fn() });
    expect(p.assetClass).toBe("stock");
    expect(p.allowedIntervals).toEqual(["D", "W"]);
    expect(p.defaultInterval).toBe("D");
  });

  it("normalizes candle arrays into Kline rows and keeps the newest `limit`", async () => {
    const body = {
      s: "ok",
      t: [1000, 2000, 3000],
      o: [10, 11, 12],
      h: [11, 12, 13],
      l: [9, 10, 11],
      c: [10.5, 11.5, 12.5],
      v: [100, 200, 300],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl, now: () => 4_000_000 });
    const out = await p.getKlines("AAPL", "D", 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      openTime: 2_000_000,
      open: 11,
      high: 12,
      low: 10,
      close: 11.5,
      volume: 200,
      closeTime: 2_000_000 + 86_400_000,
    });
    expect(out[1]!.close).toBe(12.5);
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain("/stock/candle");
    expect(url).toContain("symbol=AAPL");
    expect(url).toContain("resolution=D");
    expect(url).toContain("token=k");
  });

  it("returns an empty series on s:no_data", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ s: "no_data" }));
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl });
    expect(await p.getKlines("AAPL", "D")).toEqual([]);
  });

  it("throws with a sanitized message on a non-ok HTTP response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "bad" }, false, 401));
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl });
    await expect(p.getKlines("AAPL", "D")).rejects.toThrow(/Finnhub 401/);
  });

  it("rejects an unsupported interval", async () => {
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl: vi.fn() });
    await expect(p.getKlines("AAPL", "1h")).rejects.toThrow(/interval/);
  });

  it("reads the current price from the quote endpoint", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ c: 123.45 }));
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl });
    expect(await p.getPrice("AAPL")).toBe(123.45);
  });

  it("lists US symbols", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ symbol: "AAPL" }, { symbol: "MSFT" }]),
    );
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl });
    expect(await p.listSymbols()).toEqual(["AAPL", "MSFT"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run test/finnhubProvider.test.ts`
Expected: FAIL — cannot resolve `../src/providers/finnhubProvider.js`.

- [ ] **Step 3: Write `core/src/providers/finnhubProvider.ts`**

```ts
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
```

- [ ] **Step 4: Export from `core/src/index.ts`**

Add to `core/src/index.ts`:

```ts
export { FinnhubProvider, type FinnhubProviderOptions } from "./providers/finnhubProvider.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd core && npx vitest run test/finnhubProvider.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
cd core && npm run typecheck
git add core/src/providers/finnhubProvider.ts core/src/index.ts core/test/finnhubProvider.test.ts
git commit -m "feat(core): add FinnhubProvider for stock market data"
```

---

## Task 3: Multi-asset config (web)

**Files:**
- Modify: `web/src/config.ts`
- Test: `web/test/config.test.ts`

**Interfaces:**
- Consumes: `AssetClass` from core.
- Produces:
  - `interface WatchlistEntry { assetClass: AssetClass; symbol: string }`
  - Updated `interface AppConfig { port: number; coinsBaseUrl: string; finnhubApiKey?: string; finnhubBaseUrl: string; watchlist: WatchlistEntry[]; signalTtlMs: number; cryptoInterval: string; stockInterval: string; klineLimit: number; apiToken?: string }`
  - `loadConfig(env?): AppConfig`

**Note:** `allowedIntervals` and `klineInterval` are removed from `AppConfig` — intervals now come from each provider. `WATCHLIST` entries are `class:symbol` (e.g. `crypto:BTCPHP`).

- [ ] **Step 1: Rewrite the config test**

Replace the contents of `web/test/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults on an empty env", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3001);
    expect(c.coinsBaseUrl).toBe("https://api.pro.coins.ph");
    expect(c.finnhubBaseUrl).toBe("https://finnhub.io/api/v1");
    expect(c.finnhubApiKey).toBeUndefined();
    expect(c.signalTtlMs).toBe(300000);
    expect(c.cryptoInterval).toBe("1h");
    expect(c.stockInterval).toBe("D");
    expect(c.klineLimit).toBe(200);
    expect(c.watchlist).toEqual([
      { assetClass: "crypto", symbol: "BTCPHP" },
      { assetClass: "crypto", symbol: "ETHPHP" },
      { assetClass: "crypto", symbol: "XRPPHP" },
      { assetClass: "crypto", symbol: "SOLPHP" },
      { assetClass: "crypto", symbol: "USDTPHP" },
    ]);
    expect(c.apiToken).toBeUndefined();
  });

  it("parses a class-tagged watchlist and finnhub key", () => {
    const c = loadConfig({
      WATCHLIST: "crypto:BTCPHP, stock:AAPL ,stock:MSFT",
      FINNHUB_API_KEY: "fk",
    });
    expect(c.watchlist).toEqual([
      { assetClass: "crypto", symbol: "BTCPHP" },
      { assetClass: "stock", symbol: "AAPL" },
      { assetClass: "stock", symbol: "MSFT" },
    ]);
    expect(c.finnhubApiKey).toBe("fk");
  });

  it("throws on a watchlist entry with no class prefix", () => {
    expect(() => loadConfig({ WATCHLIST: "BTCPHP" })).toThrow(/class:symbol/);
  });

  it("throws on an unknown asset class", () => {
    expect(() => loadConfig({ WATCHLIST: "forex:EURUSD" })).toThrow(/asset class/);
  });

  it("throws on a non-numeric numeric env var", () => {
    expect(() => loadConfig({ SIGNAL_TTL_MS: "abc" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/config.test.ts`
Expected: FAIL — shape mismatch (`cryptoInterval`/`finnhubBaseUrl`/tagged `watchlist` don't exist yet).

- [ ] **Step 3: Rewrite `web/src/config.ts`**

```ts
import type { AssetClass } from "@coins-trend-advisor/core";

export interface WatchlistEntry {
  assetClass: AssetClass;
  symbol: string;
}

export interface AppConfig {
  port: number;
  coinsBaseUrl: string;
  finnhubApiKey?: string;
  finnhubBaseUrl: string;
  watchlist: WatchlistEntry[];
  signalTtlMs: number;
  cryptoInterval: string;
  stockInterval: string;
  klineLimit: number;
  apiToken?: string;
}

const DEFAULT_WATCHLIST: WatchlistEntry[] = [
  { assetClass: "crypto", symbol: "BTCPHP" },
  { assetClass: "crypto", symbol: "ETHPHP" },
  { assetClass: "crypto", symbol: "XRPPHP" },
  { assetClass: "crypto", symbol: "SOLPHP" },
  { assetClass: "crypto", symbol: "USDTPHP" },
];

const ASSET_CLASSES: AssetClass[] = ["crypto", "stock"];

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`config: ${key} must be a number, got "${raw}"`);
  }
  return n;
}

function parseWatchlist(raw: string | undefined): WatchlistEntry[] {
  if (raw === undefined) return DEFAULT_WATCHLIST;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return DEFAULT_WATCHLIST;
  return parts.map((entry) => {
    const idx = entry.indexOf(":");
    if (idx <= 0) {
      throw new Error(`config: WATCHLIST entry "${entry}" must be class:symbol`);
    }
    const assetClass = entry.slice(0, idx).trim();
    const symbol = entry.slice(idx + 1).trim();
    if (!ASSET_CLASSES.includes(assetClass as AssetClass)) {
      throw new Error(`config: WATCHLIST entry "${entry}" has unknown asset class`);
    }
    if (symbol.length === 0) {
      throw new Error(`config: WATCHLIST entry "${entry}" must be class:symbol`);
    }
    return { assetClass: assetClass as AssetClass, symbol };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: num(env, "PORT", 3001),
    coinsBaseUrl: env.COINS_BASE_URL ?? "https://api.pro.coins.ph",
    finnhubApiKey: env.FINNHUB_API_KEY || undefined,
    finnhubBaseUrl: env.FINNHUB_BASE_URL ?? "https://finnhub.io/api/v1",
    watchlist: parseWatchlist(env.WATCHLIST),
    signalTtlMs: num(env, "SIGNAL_TTL_MS", 300000),
    cryptoInterval: env.CRYPTO_INTERVAL ?? "1h",
    stockInterval: env.STOCK_INTERVAL ?? "D",
    klineLimit: num(env, "KLINE_LIMIT", 200),
    apiToken: env.API_TOKEN || undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run test/config.test.ts`
Expected: PASS (5 tests). (Other web files won't typecheck yet — that's fixed in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add web/src/config.ts web/test/config.test.ts
git commit -m "feat(web): class-tagged watchlist and finnhub config"
```

---

## Task 4: `KlineCache` (web)

**Files:**
- Create: `web/src/klineCache.ts`
- Test: `web/test/klineCache.test.ts`

**Interfaces:**
- Consumes: `AssetClass`, `Kline`, `MarketDataProvider` from core.
- Produces:
  - `type KlinesResult = { status: "ok"; klines: Kline[]; stale?: boolean; staleAsOf?: string } | { status: "error"; message: string }`
  - `interface KlineCacheDeps { resolveProvider(ac: AssetClass): MarketDataProvider; ttlMs: number; klineLimit: number; now?: () => number }`
  - `class KlineCache` with `getKlines(assetClass, symbol, interval): Promise<KlinesResult>` and `getMany(entries: { assetClass: AssetClass; symbol: string }[], interval: string): Promise<KlinesResult[]>`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/klineCache.test.ts
import { describe, it, expect, vi } from "vitest";
import { KlineCache } from "../src/klineCache.js";
import type { Kline, MarketDataProvider, AssetClass } from "@coins-trend-advisor/core";

function candles(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000, open: 100 + i, high: 100 + i, low: 100 + i,
    close: 100 + i, volume: 1, closeTime: i * 1000 + 1,
  }));
}

function providerFrom(getKlines: MarketDataProvider["getKlines"]): MarketDataProvider {
  return {
    assetClass: "crypto",
    allowedIntervals: ["1h", "4h"],
    defaultInterval: "1h",
    getKlines,
    getPrice: vi.fn(),
    listSymbols: vi.fn(),
  };
}

function cacheWith(
  getKlines: MarketDataProvider["getKlines"],
  opts: { ttlMs?: number; now?: () => number } = {},
) {
  const provider = providerFrom(getKlines);
  const resolveProvider = (_ac: AssetClass) => provider;
  return new KlineCache({
    resolveProvider,
    ttlMs: opts.ttlMs ?? 1000,
    klineLimit: 200,
    now: opts.now,
  });
}

describe("KlineCache", () => {
  it("fetches and returns ok klines", async () => {
    const getKlines = vi.fn(async () => candles(60));
    const cache = cacheWith(getKlines);
    const r = await cache.getKlines("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.klines).toHaveLength(60);
    expect(getKlines).toHaveBeenCalledWith("BTCPHP", "1h", 200);
  });

  it("serves a cached value within TTL without refetching", async () => {
    const getKlines = vi.fn(async () => candles(60));
    let t = 0;
    const cache = cacheWith(getKlines, { now: () => t });
    await cache.getKlines("crypto", "BTCPHP", "1h");
    t = 500;
    await cache.getKlines("crypto", "BTCPHP", "1h");
    expect(getKlines).toHaveBeenCalledTimes(1);
  });

  it("recomputes after TTL expiry", async () => {
    const getKlines = vi.fn(async () => candles(60));
    let t = 0;
    const cache = cacheWith(getKlines, { now: () => t });
    await cache.getKlines("crypto", "BTCPHP", "1h");
    t = 1500;
    await cache.getKlines("crypto", "BTCPHP", "1h");
    expect(getKlines).toHaveBeenCalledTimes(2);
  });

  it("keys separately by asset class, symbol, and interval", async () => {
    const getKlines = vi.fn(async () => candles(60));
    const cache = cacheWith(getKlines);
    await cache.getKlines("crypto", "BTCPHP", "1h");
    await cache.getKlines("crypto", "BTCPHP", "4h");
    await cache.getKlines("crypto", "ETHPHP", "1h");
    expect(getKlines).toHaveBeenCalledTimes(3);
  });

  it("dedups concurrent requests for the same key", async () => {
    let resolve!: (v: Kline[]) => void;
    const getKlines = vi.fn(() => new Promise<Kline[]>((res) => { resolve = res; }));
    const cache = cacheWith(getKlines);
    const p1 = cache.getKlines("crypto", "BTCPHP", "1h");
    const p2 = cache.getKlines("crypto", "BTCPHP", "1h");
    resolve(candles(60));
    await Promise.all([p1, p2]);
    expect(getKlines).toHaveBeenCalledTimes(1);
  });

  it("returns error when upstream fails with nothing cached", async () => {
    const getKlines = vi.fn(async () => { throw new Error("boom"); });
    const cache = cacheWith(getKlines);
    const r = await cache.getKlines("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("error");
    if (r.status !== "error") throw new Error("expected error");
    expect(r.message).toBe("boom");
  });

  it("serves stale klines when upstream later fails", async () => {
    let fail = false;
    const rows = candles(60);
    const getKlines = vi.fn(async () => { if (fail) throw new Error("boom"); return rows; });
    let t = 0;
    const cache = cacheWith(getKlines, { now: () => t });
    await cache.getKlines("crypto", "BTCPHP", "1h");
    t = 2000; fail = true;
    const r = await cache.getKlines("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.stale).toBe(true);
    expect(typeof r.staleAsOf).toBe("string");
  });

  it("getMany resolves each entry independently", async () => {
    const getKlines = vi.fn(async (symbol: string) => {
      if (symbol === "ERR") throw new Error("boom");
      return candles(60);
    });
    const cache = cacheWith(getKlines);
    const out = await cache.getMany(
      [{ assetClass: "crypto", symbol: "BTCPHP" }, { assetClass: "crypto", symbol: "ERR" }],
      "1h",
    );
    expect(out[0]!.status).toBe("ok");
    expect(out[1]!.status).toBe("error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/klineCache.test.ts`
Expected: FAIL — cannot resolve `../src/klineCache.js`.

- [ ] **Step 3: Write `web/src/klineCache.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run test/klineCache.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/klineCache.ts web/test/klineCache.test.ts
git commit -m "feat(web): add KlineCache caching raw candles with TTL, dedup, stale fallback"
```

---

## Task 5: `SignalService` (web)

**Files:**
- Create: `web/src/signalService.ts`
- Test: `web/test/signalService.test.ts`

**Interfaces:**
- Consumes: `KlineCache`/`KlinesResult` (Task 4), `generateSignal`, `Signal`, `AssetClass` from core.
- Produces:
  - `type SignalResult = { assetClass: AssetClass; symbol: string; status: "ok"; signal: Signal; stale?: boolean; staleAsOf?: string } | { assetClass: AssetClass; symbol: string; status: "insufficient_data" } | { assetClass: AssetClass; symbol: string; status: "error"; message: string }`
  - `class SignalService` with `get(assetClass, symbol, interval): Promise<SignalResult>` and `getMany(entries: { assetClass: AssetClass; symbol: string }[], interval): Promise<SignalResult[]>`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/signalService.test.ts
import { describe, it, expect } from "vitest";
import { SignalService } from "../src/signalService.js";
import type { KlineCache, KlinesResult } from "../src/klineCache.js";
import type { Kline } from "@coins-trend-advisor/core";
import { DISCLAIMER } from "@coins-trend-advisor/core";

function candles(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000, open: 100 + i, high: 100 + i, low: 100 + i,
    close: 100 + i, volume: 1, closeTime: i * 1000 + 1,
  }));
}

function fakeCache(result: KlinesResult): KlineCache {
  return {
    getKlines: async () => result,
    getMany: async () => [result],
  } as unknown as KlineCache;
}

describe("SignalService", () => {
  it("computes an ok signal from cached klines", async () => {
    const svc = new SignalService({ cache: fakeCache({ status: "ok", klines: candles(60) }) });
    const r = await svc.get("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.symbol).toBe("BTCPHP");
    expect(r.assetClass).toBe("crypto");
    expect(r.signal.disclaimer).toBe(DISCLAIMER);
  });

  it("reports insufficient_data for a short series", async () => {
    const svc = new SignalService({ cache: fakeCache({ status: "ok", klines: candles(10) }) });
    const r = await svc.get("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("insufficient_data");
  });

  it("propagates a cache error", async () => {
    const svc = new SignalService({ cache: fakeCache({ status: "error", message: "boom" }) });
    const r = await svc.get("crypto", "BTCPHP", "1h");
    expect(r.status).toBe("error");
    if (r.status !== "error") throw new Error("expected error");
    expect(r.message).toBe("boom");
  });

  it("carries stale markers through", async () => {
    const svc = new SignalService({
      cache: fakeCache({ status: "ok", klines: candles(60), stale: true, staleAsOf: "2020-01-01T00:00:00.000Z" }),
    });
    const r = await svc.get("crypto", "BTCPHP", "1h");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.stale).toBe(true);
    expect(r.staleAsOf).toBe("2020-01-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/signalService.test.ts`
Expected: FAIL — cannot resolve `../src/signalService.js`.

- [ ] **Step 3: Write `web/src/signalService.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run test/signalService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/signalService.ts web/test/signalService.test.ts
git commit -m "feat(web): add SignalService computing signals over cached klines"
```

---

## Task 6: `ProviderRegistry` (web)

**Files:**
- Create: `web/src/providers.ts`
- Modify: `web/src/coins.ts`
- Test: `web/test/providers.test.ts`

**Interfaces:**
- Consumes: `AppConfig` (Task 3), `CoinsProvider`, `FinnhubProvider`, `MarketDataProvider`, `AssetClass`, `CoinsClient` from core.
- Produces:
  - `interface ProviderRegistry { resolve(ac: AssetClass): MarketDataProvider | null }`
  - `buildRegistry(config: AppConfig, deps?: { coins?: MarketDataProvider; finnhub?: MarketDataProvider }): ProviderRegistry`
  - `makeCoinsProvider(config: AppConfig): CoinsProvider` (in `coins.ts`)

**Note:** `resolve` returns `null` for a configured-but-disabled class (stock without a key) or an unknown class. Routes translate `null` into `503 stocks_disabled` / `400 invalid_asset_class`.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/providers.test.ts
import { describe, it, expect } from "vitest";
import { buildRegistry } from "../src/providers.js";
import { loadConfig } from "../src/config.js";

describe("buildRegistry", () => {
  it("always resolves crypto", () => {
    const reg = buildRegistry(loadConfig({}));
    const p = reg.resolve("crypto");
    expect(p).not.toBeNull();
    expect(p!.assetClass).toBe("crypto");
  });

  it("returns null for stock when no finnhub key is set", () => {
    const reg = buildRegistry(loadConfig({}));
    expect(reg.resolve("stock")).toBeNull();
  });

  it("resolves stock when a finnhub key is set", () => {
    const reg = buildRegistry(loadConfig({ FINNHUB_API_KEY: "fk" }));
    const p = reg.resolve("stock");
    expect(p).not.toBeNull();
    expect(p!.assetClass).toBe("stock");
    expect(p!.allowedIntervals).toEqual(["D", "W"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/providers.test.ts`
Expected: FAIL — cannot resolve `../src/providers.js`.

- [ ] **Step 3: Write `web/src/providers.ts`**

```ts
import {
  CoinsClient,
  CoinsProvider,
  FinnhubProvider,
  type AssetClass,
  type MarketDataProvider,
} from "@coins-trend-advisor/core";
import type { AppConfig } from "./config.js";
import { makeCoinsProvider } from "./coins.js";

export interface ProviderRegistry {
  resolve(ac: AssetClass): MarketDataProvider | null;
}

export function buildRegistry(
  config: AppConfig,
  deps: { coins?: MarketDataProvider; finnhub?: MarketDataProvider } = {},
): ProviderRegistry {
  const crypto = deps.coins ?? makeCoinsProvider(config);
  const stock =
    deps.finnhub ??
    (config.finnhubApiKey
      ? new FinnhubProvider({
          apiKey: config.finnhubApiKey,
          baseUrl: config.finnhubBaseUrl,
        })
      : null);

  return {
    resolve(ac: AssetClass): MarketDataProvider | null {
      if (ac === "crypto") return crypto;
      if (ac === "stock") return stock;
      return null;
    },
  };
}

// Re-export so callers have a single import site for construction.
export { CoinsClient, CoinsProvider };
```

- [ ] **Step 4: Rewrite `web/src/coins.ts`**

```ts
import { CoinsClient, CoinsProvider } from "@coins-trend-advisor/core";
import type { AppConfig } from "./config.js";

export function makeCoinsProvider(config: AppConfig): CoinsProvider {
  return new CoinsProvider(new CoinsClient({ baseUrl: config.coinsBaseUrl }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run test/providers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/providers.ts web/src/coins.ts web/test/providers.test.ts
git commit -m "feat(web): add ProviderRegistry with graceful stock-disabled resolution"
```

---

## Task 7: Asset-class routing integration (web)

This is the atomic swap: rewire `AppDeps`, the signals and meta routes, `server.ts`, and `index.ts` onto the registry + `KlineCache` + `SignalService`, delete the old `SignalCache`, and update the route/auth tests. After this task the whole suite and typecheck are green.

**Files:**
- Modify: `web/src/server.ts`
- Modify: `web/src/routes/signals.ts`
- Modify: `web/src/routes/watchlist.ts`
- Modify: `web/src/index.ts`
- Delete: `web/src/signalCache.ts`, `web/test/signalCache.test.ts`
- Test: `web/test/routes.signals.test.ts` (rewrite), `web/test/routes.meta.test.ts` (rewrite)

**Interfaces:**
- Consumes: `KlineCache` (Task 4), `SignalService`/`SignalResult` (Task 5), `ProviderRegistry` (Task 6), `AppConfig`/`WatchlistEntry` (Task 3).
- Produces:
  - `interface AppDeps { config: AppConfig; registry: ProviderRegistry; cache: KlineCache; signals: SignalService }`
  - Routes: `GET /api/signals/:assetClass`, `GET /api/signals/:assetClass/:symbol`, `GET /api/watchlist`, `GET /api/pairs/:assetClass`.

- [ ] **Step 1: Delete the superseded cache + its test**

```bash
git rm web/src/signalCache.ts web/test/signalCache.test.ts
```

- [ ] **Step 2: Rewrite `web/src/server.ts`**

```ts
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import type { AppConfig } from "./config.js";
import type { KlineCache } from "./klineCache.js";
import type { SignalService } from "./signalService.js";
import type { ProviderRegistry } from "./providers.js";
import { errorMiddleware } from "./errors.js";
import { healthRoutes } from "./routes/health.js";
import { profitRoutes } from "./routes/profit.js";
import { signalRoutes } from "./routes/signals.js";
import { metaRoutes } from "./routes/watchlist.js";

export interface AppDeps {
  config: AppConfig;
  registry: ProviderRegistry;
  cache: KlineCache;
  signals: SignalService;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.use("/api", healthRoutes());

  if (deps.config.apiToken) {
    app.use("/api", requireToken(deps.config.apiToken));
  }

  app.use("/api", profitRoutes());
  app.use("/api", signalRoutes(deps));
  app.use("/api", metaRoutes(deps));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found" } });
  });
  app.use(errorMiddleware);
  return app;
}

function requireToken(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (provided !== token) {
      res
        .status(401)
        .json({ error: { code: "unauthorized", message: "Invalid or missing API token" } });
      return;
    }
    next();
  };
}
```

- [ ] **Step 3: Rewrite `web/src/routes/signals.ts`**

```ts
import { Router, type Request } from "express";
import type { AssetClass } from "@coins-trend-advisor/core";
import type { AppDeps } from "../server.js";
import type { SignalResult } from "../signalService.js";
import { ApiError, asyncHandler } from "../errors.js";

const ASSET_CLASSES: AssetClass[] = ["crypto", "stock"];

const UPSTREAM_UNAVAILABLE_MESSAGE =
  "Upstream market data provider is currently unavailable";

function parseAssetClass(raw: string | undefined): AssetClass {
  if (raw !== undefined && ASSET_CLASSES.includes(raw as AssetClass)) {
    return raw as AssetClass;
  }
  throw new ApiError("invalid_asset_class", 400, `asset class must be one of ${ASSET_CLASSES.join(", ")}`);
}

function resolveInterval(deps: AppDeps, assetClass: AssetClass, req: Request): string {
  const provider = deps.registry.resolve(assetClass);
  if (!provider) {
    throw new ApiError("stocks_disabled", 503, "Stock data is not configured");
  }
  const raw = req.query.interval;
  const interval =
    raw === undefined ? provider.defaultInterval : typeof raw === "string" ? raw : "";
  if (!provider.allowedIntervals.includes(interval)) {
    throw new ApiError(
      "invalid_interval",
      400,
      `interval must be one of ${provider.allowedIntervals.join(", ")}`,
    );
  }
  return interval;
}

function sanitizeResult(result: SignalResult, interval: string): SignalResult {
  if (result.status === "error") {
    console.error(
      `upstream error for ${result.assetClass}:${result.symbol} @ ${interval}: ${result.message}`,
    );
    return {
      assetClass: result.assetClass,
      symbol: result.symbol,
      status: "error",
      message: UPSTREAM_UNAVAILABLE_MESSAGE,
    };
  }
  return result;
}

export function signalRoutes(deps: AppDeps): Router {
  const r = Router();

  r.get(
    "/signals/:assetClass",
    asyncHandler(async (req, res) => {
      const assetClass = parseAssetClass(req.params.assetClass);
      const interval = resolveInterval(deps, assetClass, req);
      const entries = deps.config.watchlist.filter((e) => e.assetClass === assetClass);
      const results = await deps.signals.getMany(entries, interval);
      res.json({ assetClass, interval, results: results.map((x) => sanitizeResult(x, interval)) });
    }),
  );

  r.get(
    "/signals/:assetClass/:symbol",
    asyncHandler(async (req, res) => {
      const assetClass = parseAssetClass(req.params.assetClass);
      const interval = resolveInterval(deps, assetClass, req);
      const symbol = req.params.symbol!;
      const result = await deps.signals.get(assetClass, symbol, interval);
      if (result.status === "insufficient_data") {
        throw new ApiError("insufficient_data", 422, `insufficient candle data for ${symbol}`);
      }
      if (result.status === "error") {
        console.error(`upstream error for ${assetClass}:${symbol} @ ${interval}: ${result.message}`);
        throw new ApiError("upstream_unavailable", 502, UPSTREAM_UNAVAILABLE_MESSAGE);
      }
      res.json(result);
    }),
  );

  return r;
}
```

- [ ] **Step 4: Rewrite `web/src/routes/watchlist.ts`**

```ts
import { Router } from "express";
import type { AssetClass } from "@coins-trend-advisor/core";
import type { AppDeps } from "../server.js";
import { ApiError, asyncHandler } from "../errors.js";

const ASSET_CLASSES: AssetClass[] = ["crypto", "stock"];
const PAIRS_TTL_MS = 3_600_000; // 1 hour

export function metaRoutes(deps: AppDeps): Router {
  const r = Router();

  r.get("/watchlist", (_req, res) => {
    res.json({ entries: deps.config.watchlist });
  });

  // Per-class symbol cache: symbol lists rarely change.
  const pairsCache = new Map<AssetClass, { symbols: string[]; at: number }>();
  r.get(
    "/pairs/:assetClass",
    asyncHandler(async (req, res) => {
      const raw = req.params.assetClass;
      if (raw === undefined || !ASSET_CLASSES.includes(raw as AssetClass)) {
        throw new ApiError("invalid_asset_class", 400, `asset class must be one of ${ASSET_CLASSES.join(", ")}`);
      }
      const assetClass = raw as AssetClass;
      const provider = deps.registry.resolve(assetClass);
      if (!provider) {
        throw new ApiError("stocks_disabled", 503, "Stock data is not configured");
      }
      const hit = pairsCache.get(assetClass);
      if (!hit || Date.now() - hit.at > PAIRS_TTL_MS) {
        pairsCache.set(assetClass, { symbols: await provider.listSymbols(), at: Date.now() });
      }
      res.json({ assetClass, symbols: pairsCache.get(assetClass)!.symbols });
    }),
  );

  return r;
}
```

- [ ] **Step 5: Rewrite `web/src/index.ts`**

```ts
import { loadConfig } from "./config.js";
import { buildRegistry } from "./providers.js";
import { KlineCache } from "./klineCache.js";
import { SignalService } from "./signalService.js";
import { createApp } from "./server.js";

const config = loadConfig();
const registry = buildRegistry(config);
const cache = new KlineCache({
  resolveProvider: (ac) => {
    const p = registry.resolve(ac);
    if (!p) throw new Error(`no provider for asset class ${ac}`);
    return p;
  },
  ttlMs: config.signalTtlMs,
  klineLimit: config.klineLimit,
});
const signals = new SignalService({ cache });
const app = createApp({ config, registry, cache, signals });

app.listen(config.port, () => {
  console.log(`web backend listening on :${config.port}`);
});
```

- [ ] **Step 6: Rewrite `web/test/routes.signals.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";
import type { AppConfig, WatchlistEntry } from "../src/config.js";
import type { AssetClass, Kline, MarketDataProvider } from "@coins-trend-advisor/core";
import { DISCLAIMER } from "@coins-trend-advisor/core";

function candles(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000, open: 100 + i, high: 100 + i, low: 100 + i,
    close: 100 + i, volume: 1, closeTime: i * 1000 + 1,
  }));
}

function stockProvider(getKlines: MarketDataProvider["getKlines"]): MarketDataProvider {
  return {
    assetClass: "stock", allowedIntervals: ["D", "W"], defaultInterval: "D",
    getKlines, getPrice: vi.fn(), listSymbols: vi.fn(),
  };
}

function cryptoProvider(getKlines: MarketDataProvider["getKlines"]): MarketDataProvider {
  return {
    assetClass: "crypto", allowedIntervals: ["1h", "4h"], defaultInterval: "1h",
    getKlines, getPrice: vi.fn(), listSymbols: vi.fn(),
  };
}

function makeApp(opts: {
  crypto?: MarketDataProvider["getKlines"];
  stock?: MarketDataProvider["getKlines"] | null; // null => stocks disabled
  watchlist?: WatchlistEntry[];
  ttlMs?: number;
}) {
  const crypto = cryptoProvider(opts.crypto ?? (async () => candles(60)));
  const stock =
    opts.stock === null
      ? null
      : stockProvider(opts.stock ?? (async () => candles(60)));
  const config: AppConfig = {
    port: 3001,
    coinsBaseUrl: "http://example.test",
    finnhubBaseUrl: "http://finnhub.test",
    finnhubApiKey: opts.stock === null ? undefined : "fk",
    watchlist: opts.watchlist ?? [
      { assetClass: "crypto", symbol: "BTCPHP" },
      { assetClass: "crypto", symbol: "ETHPHP" },
    ],
    signalTtlMs: opts.ttlMs ?? 1000,
    cryptoInterval: "1h",
    stockInterval: "D",
    klineLimit: 200,
    apiToken: undefined,
  };
  const registry = {
    resolve: (ac: AssetClass) => (ac === "crypto" ? crypto : ac === "stock" ? stock : null),
  };
  const cache = new KlineCache({
    resolveProvider: (ac) => registry.resolve(ac)!,
    ttlMs: config.signalTtlMs,
    klineLimit: config.klineLimit,
  });
  const signals = new SignalService({ cache });
  return createApp({ config, registry, cache, signals });
}

describe("signals routes", () => {
  it("GET /api/signals/crypto returns the crypto watchlist", async () => {
    const res = await request(makeApp({})).get("/api/signals/crypto");
    expect(res.status).toBe(200);
    expect(res.body.assetClass).toBe("crypto");
    expect(res.body.interval).toBe("1h");
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].status).toBe("ok");
    expect(res.body.results[0].signal.disclaimer).toBe(DISCLAIMER);
  });

  it("GET /api/signals/crypto/:symbol returns a single ok signal", async () => {
    const res = await request(makeApp({})).get("/api/signals/crypto/BTCPHP");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.symbol).toBe("BTCPHP");
  });

  it("surfaces mixed per-pair statuses without failing the request", async () => {
    const crypto = vi.fn(async (symbol: string) => {
      if (symbol === "OK") return candles(60);
      if (symbol === "SHORT") return candles(10);
      throw new Error("Coins.ph 500 for /openapi/quote/v1/klines: secret upstream body");
    });
    const app = makeApp({
      crypto,
      watchlist: [
        { assetClass: "crypto", symbol: "OK" },
        { assetClass: "crypto", symbol: "SHORT" },
        { assetClass: "crypto", symbol: "ERR" },
      ],
    });
    const res = await request(app).get("/api/signals/crypto");
    expect(res.status).toBe(200);
    const byPair = Object.fromEntries(res.body.results.map((r: { symbol: string }) => [r.symbol, r]));
    expect(byPair.OK.status).toBe("ok");
    expect(byPair.SHORT.status).toBe("insufficient_data");
    expect(byPair.ERR.status).toBe("error");
    expect(byPair.ERR.message).not.toContain("secret upstream body");
  });

  it("returns 422 for insufficient data", async () => {
    const res = await request(makeApp({ crypto: async () => candles(10) })).get("/api/signals/crypto/BTCPHP");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("insufficient_data");
  });

  it("returns 502 with a sanitized message when upstream fails", async () => {
    const res = await request(
      makeApp({ crypto: async () => { throw new Error("Coins.ph 500 for /openapi: secret upstream body"); } }),
    ).get("/api/signals/crypto/BTCPHP");
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("upstream_unavailable");
    expect(res.body.error.message).not.toContain("secret upstream body");
  });

  it("rejects an unknown asset class with 400", async () => {
    const res = await request(makeApp({})).get("/api/signals/forex/EURUSD");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_asset_class");
  });

  it("rejects a crypto interval on a stock route with 400", async () => {
    const res = await request(makeApp({})).get("/api/signals/stock/AAPL?interval=1h");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_interval");
  });

  it("returns 503 stocks_disabled when no finnhub key is configured", async () => {
    const res = await request(makeApp({ stock: null })).get("/api/signals/stock/AAPL");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("stocks_disabled");
  });

  it("serves a stock signal when enabled", async () => {
    const res = await request(makeApp({ stock: async () => candles(60) })).get("/api/signals/stock/AAPL");
    expect(res.status).toBe(200);
    expect(res.body.assetClass).toBe("stock");
    expect(res.body.symbol).toBe("AAPL");
  });
});
```

- [ ] **Step 7: Rewrite `web/test/routes.meta.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";
import type { AppConfig, WatchlistEntry } from "../src/config.js";
import type { AssetClass, MarketDataProvider } from "@coins-trend-advisor/core";

function provider(assetClass: AssetClass, listSymbols: () => Promise<string[]>): MarketDataProvider {
  return {
    assetClass,
    allowedIntervals: assetClass === "crypto" ? ["1h", "4h"] : ["D", "W"],
    defaultInterval: assetClass === "crypto" ? "1h" : "D",
    getKlines: vi.fn(), getPrice: vi.fn(), listSymbols,
  };
}

function makeApp(opts: { watchlist?: WatchlistEntry[]; symbols?: string[]; stockEnabled?: boolean }) {
  const listSymbols = vi.fn(async () => opts.symbols ?? ["BTCPHP", "ETHPHP", "XRPPHP"]);
  const crypto = provider("crypto", listSymbols);
  const stock = opts.stockEnabled ? provider("stock", vi.fn(async () => ["AAPL"])) : null;
  const config: AppConfig = {
    port: 3001, coinsBaseUrl: "http://example.test", finnhubBaseUrl: "http://finnhub.test",
    finnhubApiKey: opts.stockEnabled ? "fk" : undefined,
    watchlist: opts.watchlist ?? [
      { assetClass: "crypto", symbol: "BTCPHP" },
      { assetClass: "stock", symbol: "AAPL" },
    ],
    signalTtlMs: 1000, cryptoInterval: "1h", stockInterval: "D", klineLimit: 200, apiToken: undefined,
  };
  const registry = { resolve: (ac: AssetClass) => (ac === "crypto" ? crypto : ac === "stock" ? stock : null) };
  const cache = new KlineCache({ resolveProvider: (ac) => registry.resolve(ac)!, ttlMs: 1000, klineLimit: 200 });
  const signals = new SignalService({ cache });
  return { app: createApp({ config, registry, cache, signals }), listSymbols };
}

describe("meta routes", () => {
  it("GET /api/watchlist returns tagged entries including disabled stocks", async () => {
    const { app } = makeApp({});
    const res = await request(app).get("/api/watchlist");
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([
      { assetClass: "crypto", symbol: "BTCPHP" },
      { assetClass: "stock", symbol: "AAPL" },
    ]);
  });

  it("GET /api/pairs/crypto returns symbols and caches upstream", async () => {
    const { app, listSymbols } = makeApp({ symbols: ["A", "B"] });
    const first = await request(app).get("/api/pairs/crypto");
    const second = await request(app).get("/api/pairs/crypto");
    expect(first.body.assetClass).toBe("crypto");
    expect(first.body.symbols).toEqual(["A", "B"]);
    expect(second.body.symbols).toEqual(["A", "B"]);
    expect(listSymbols).toHaveBeenCalledTimes(1);
  });

  it("GET /api/pairs/stock returns 503 when stocks are disabled", async () => {
    const { app } = makeApp({ stockEnabled: false });
    const res = await request(app).get("/api/pairs/stock");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("stocks_disabled");
  });
});
```

- [ ] **Step 8: Run the whole web suite + typecheck**

Run: `cd web && npx vitest run && npm run typecheck`
Expected: PASS — all files green (auth/health/profit/config/klineCache/signalService/providers/signals/meta), typecheck exits 0. The live smoke test stays skipped.

- [ ] **Step 9: Commit**

```bash
git add web/src/server.ts web/src/routes/signals.ts web/src/routes/watchlist.ts web/src/index.ts web/test/routes.signals.test.ts web/test/routes.meta.test.ts
git commit -m "feat(web): asset-class routing over KlineCache and SignalService"
```

---

## Task 8: Extend the live smoke test (web)

**Files:**
- Modify: `web/test/smoke.live.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `buildRegistry`, `KlineCache`, `SignalService`, `createApp`.

- [ ] **Step 1: Rewrite `web/test/smoke.live.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { buildRegistry } from "../src/providers.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";

describe.skipIf(process.env.RUN_SMOKE !== "1")("live smoke", () => {
  function boot() {
    const config = loadConfig();
    const registry = buildRegistry(config);
    const cache = new KlineCache({
      resolveProvider: (ac) => {
        const p = registry.resolve(ac);
        if (!p) throw new Error(`no provider for ${ac}`);
        return p;
      },
      ttlMs: config.signalTtlMs,
      klineLimit: config.klineLimit,
    });
    const signals = new SignalService({ cache });
    return createApp({ config, registry, cache, signals });
  }

  it("computes a real crypto signal for BTCPHP", async () => {
    const res = await request(boot()).get("/api/signals/crypto/BTCPHP");
    expect([200, 422]).toContain(res.status);
  }, 20000);

  it("serves a stock signal or a clean disabled response for AAPL", async () => {
    const res = await request(boot()).get("/api/signals/stock/AAPL");
    // 200/422 with a key; 503 stocks_disabled without one; 502 if the free tier lacks candles.
    expect([200, 422, 502, 503]).toContain(res.status);
  }, 20000);
});
```

- [ ] **Step 2: Run the suite (smoke skipped) + typecheck**

Run: `cd web && npx vitest run && npm run typecheck`
Expected: PASS — smoke suite skipped, typecheck exits 0.

- [ ] **Step 3: Commit**

```bash
git add web/test/smoke.live.test.ts
git commit -m "test(web): extend live smoke to crypto and stock signal paths"
```

---

## Self-Review Notes

**Spec coverage:**
- `MarketDataProvider` abstraction + `CoinsProvider` + `FinnhubProvider` → Tasks 1, 2. ✅
- Finnhub `Kline` normalization + `no_data`/error handling → Task 2. ✅
- Klines-cache refactor (TTL, dedup, stale) → Task 4. ✅
- Signal as pure function over cached klines → Task 5. ✅
- `providerFor` resolver + graceful stock-disabled → Task 6 (`resolve`) + Task 7 (route 503). ✅
- Asset-class routes + per-provider interval validation → Task 7. ✅
- Tagged watchlist + per-class `/pairs` → Task 7. ✅
- Env config (`FINNHUB_API_KEY`, class-tagged `WATCHLIST`, `STOCK_INTERVAL`) → Task 3. ✅
- Upstream-message sanitization preserved → Task 7 (`sanitizeResult` + static 502). ✅
- Live smoke covering both classes → Task 8. ✅

**Deferred (unchanged):** Postgres, scheduler, web-push, PWA, deployment. Forecaster is Slice 3.

**Type consistency:** `AssetClass`/`MarketDataProvider`/`Kline` (core) flow into `KlineCache` (Task 4) → `SignalService` (Task 5) → routes (Task 7). `AppConfig`/`WatchlistEntry` (Task 3) consumed by Tasks 6, 7. `KlinesResult` (Task 4) consumed by Task 5. `SignalResult` (Task 5) consumed by Task 7's `sanitizeResult`. `AppDeps` redefined once in Task 7 and consumed by both route modules. `buildRegistry`/`makeCoinsProvider` (Task 6) consumed by Task 7's `index.ts` and Task 8's smoke.

**Known risk (carried from spec):** Finnhub free-tier may not serve historical candles; Task 8's stock assertion tolerates a `502`. If confirmed, swap `FinnhubProvider.getKlines` internals for Alpha Vantage `TIME_SERIES_DAILY` — one file, interface unchanged.
