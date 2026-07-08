# Vercel Serverless Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the app to Vercel free tier — static frontend on the CDN, the existing Express backend as one catch-all serverless function under `/api/*`, with a shared Upstash Redis cache and an embedded bearer token.

**Architecture:** Extract a `KlineStore` seam out of `KlineCache` so the backing store swaps between in-memory (dev/tests) and Upstash Redis (prod) without touching cache logic. Extract a `buildAppFromEnv()` factory so both the local `index.ts` server and the Vercel function `api/[...path].ts` construct the identical Express app. Vercel serves `frontend/dist` statically and routes `/api/*` to the function.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Express 4, Vitest + Supertest, `@upstash/redis` (REST client), Vercel (`@vercel/node`), Vite/React frontend.

## Global Constraints

- ESM modules: every relative import uses a `.js` specifier (e.g. `./klineStore.js`), even from `.ts` source. Match the existing files.
- Backward compatibility: all existing `web/test/klineCache.test.ts` tests must keep passing unchanged — the `store` dependency is optional and defaults to in-memory.
- Store selection is by env only: `UPSTASH_REDIS_REST_URL` present → Redis, absent → memory. No other trigger.
- Freshness/stale-on-error stay computed in code from `computedAt` vs `ttlMs`. Redis TTL is only a 24h GC backstop, never the freshness gate.
- Redis errors degrade gracefully: `get` failure → treat as cache miss (`null`); `set` failure → swallow. A Redis outage must never turn into a request error.
- The embedded token is not a real secret (ships in the client bundle); it is casual-abuse deterrence only.
- Run web tests with `npm test -w web -- <filter>` and frontend tests with `npm test -w frontend -- <filter>` (the `-- <filter>` is a Vitest filename filter).

---

### Task 1: `KlineStore` interface + `MemoryKlineStore`

**Files:**
- Create: `web/src/klineStore.ts`
- Test: `web/test/klineStore.test.ts`

**Interfaces:**
- Consumes: `Kline` from `@coins-trend-advisor/core`.
- Produces:
  - `interface StoredKlines { klines: Kline[]; computedAt: number }`
  - `interface KlineStore { get(key: string): Promise<StoredKlines | null>; set(key: string, value: StoredKlines): Promise<void> }`
  - `class MemoryKlineStore implements KlineStore` — constructor `({ maxEntries }: { maxEntries?: number } = {})`, default cap 1000, evicts oldest (insertion order) once the cap is exceeded on `set`.

- [ ] **Step 1: Write the failing test**

Create `web/test/klineStore.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MemoryKlineStore } from "../src/klineStore.js";
import type { Kline } from "@coins-trend-advisor/core";

function candles(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i, open: 1, high: 1, low: 1, close: 1, volume: 1, closeTime: i + 1,
  }));
}

describe("MemoryKlineStore", () => {
  it("round-trips a stored value", async () => {
    const store = new MemoryKlineStore();
    await store.set("k", { klines: candles(3), computedAt: 42 });
    const got = await store.get("k");
    expect(got?.computedAt).toBe(42);
    expect(got?.klines).toHaveLength(3);
  });

  it("returns null for a missing key", async () => {
    const store = new MemoryKlineStore();
    expect(await store.get("nope")).toBeNull();
  });

  it("evicts the oldest entry once maxEntries is exceeded", async () => {
    const store = new MemoryKlineStore({ maxEntries: 2 });
    await store.set("a", { klines: candles(1), computedAt: 1 });
    await store.set("b", { klines: candles(1), computedAt: 2 });
    await store.set("c", { klines: candles(1), computedAt: 3 }); // evicts "a"
    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).not.toBeNull();
    expect(await store.get("c")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- klineStore`
Expected: FAIL — cannot find module `../src/klineStore.js`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/klineStore.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w web -- klineStore`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/klineStore.ts web/test/klineStore.test.ts
git commit -m "feat(web): add KlineStore interface and MemoryKlineStore"
```

---

### Task 2: `RedisKlineStore` + `makeKlineStore` factory

**Files:**
- Modify: `web/src/klineStore.ts`
- Modify: `web/package.json` (add `@upstash/redis` dependency)
- Test: `web/test/klineStore.test.ts` (append)

**Interfaces:**
- Consumes: `KlineStore`, `StoredKlines`, `MemoryKlineStore` from Task 1.
- Produces:
  - `interface RedisLike { get<T = unknown>(key: string): Promise<T | null>; set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown> }`
  - `class RedisKlineStore implements KlineStore` — constructor `(client: RedisLike, ttlSeconds = 86400)`; `get` swallows errors → `null`; `set` swallows errors.
  - `function makeKlineStore(env: NodeJS.ProcessEnv, opts?: { maxEntries?: number }): KlineStore` — returns `RedisKlineStore` when `env.UPSTASH_REDIS_REST_URL` is set, else `MemoryKlineStore`.

- [ ] **Step 1: Add the dependency**

Run: `npm install @upstash/redis -w web`
Expected: adds `@upstash/redis` to `web/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Append to `web/test/klineStore.test.ts`:

```ts
import { RedisKlineStore, makeKlineStore, type RedisLike } from "../src/klineStore.js";

function fakeRedis(overrides: Partial<RedisLike> = {}): RedisLike {
  const map = new Map<string, unknown>();
  return {
    get: async <T,>(key: string) => (map.has(key) ? (map.get(key) as T) : null),
    set: async (key: string, value: unknown) => { map.set(key, value); return "OK"; },
    ...overrides,
  };
}

describe("RedisKlineStore", () => {
  it("round-trips a stored value through the client", async () => {
    const store = new RedisKlineStore(fakeRedis());
    await store.set("k", { klines: [], computedAt: 7 });
    const got = await store.get("k");
    expect(got?.computedAt).toBe(7);
  });

  it("returns null on a get miss", async () => {
    const store = new RedisKlineStore(fakeRedis());
    expect(await store.get("missing")).toBeNull();
  });

  it("sets with the configured TTL (ex seconds)", async () => {
    let seenOpts: { ex?: number } | undefined;
    const client = fakeRedis({
      set: async (_k, _v, opts) => { seenOpts = opts; return "OK"; },
    });
    const store = new RedisKlineStore(client, 3600);
    await store.set("k", { klines: [], computedAt: 1 });
    expect(seenOpts?.ex).toBe(3600);
  });

  it("treats a throwing get as a cache miss", async () => {
    const client = fakeRedis({ get: async () => { throw new Error("down"); } });
    const store = new RedisKlineStore(client);
    expect(await store.get("k")).toBeNull();
  });

  it("swallows a throwing set", async () => {
    const client = fakeRedis({ set: async () => { throw new Error("down"); } });
    const store = new RedisKlineStore(client);
    await expect(store.set("k", { klines: [], computedAt: 1 })).resolves.toBeUndefined();
  });
});

describe("makeKlineStore", () => {
  it("returns a MemoryKlineStore when no Upstash url is set", () => {
    const store = makeKlineStore({} as NodeJS.ProcessEnv);
    expect(store.constructor.name).toBe("MemoryKlineStore");
  });

  it("returns a RedisKlineStore when UPSTASH_REDIS_REST_URL is set", () => {
    const store = makeKlineStore({
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    } as unknown as NodeJS.ProcessEnv);
    expect(store.constructor.name).toBe("RedisKlineStore");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w web -- klineStore`
Expected: FAIL — `RedisKlineStore` / `makeKlineStore` not exported.

- [ ] **Step 4: Write minimal implementation**

Append to `web/src/klineStore.ts`:

```ts
import { Redis } from "@upstash/redis";

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
```

Note: `@upstash/redis`'s `Redis` is structurally compatible with `RedisLike` (its `get<T>` auto-deserializes JSON and `set` accepts `{ ex }`).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w web -- klineStore`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w web`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/klineStore.ts web/test/klineStore.test.ts web/package.json package-lock.json
git commit -m "feat(web): add RedisKlineStore and env-based store factory"
```

---

### Task 3: Refactor `KlineCache` to use a `KlineStore`

**Files:**
- Modify: `web/src/klineCache.ts`
- Test: `web/test/klineCache.test.ts` (existing tests must stay green; add one)

**Interfaces:**
- Consumes: `KlineStore`, `StoredKlines`, `MemoryKlineStore` from Task 1.
- Produces: `KlineCacheDeps` gains an optional `store?: KlineStore`. When omitted, `KlineCache` builds `new MemoryKlineStore({ maxEntries: deps.maxEntries })` internally. Public methods (`getKlines`, `getMany`) keep identical signatures and behavior.

- [ ] **Step 1: Write the failing test**

Append to `web/test/klineCache.test.ts` (imports `MemoryKlineStore` at top: add `import { MemoryKlineStore } from "../src/klineStore.js";`):

```ts
it("uses an injected store for fresh hits", async () => {
  const getKlines = vi.fn(async () => candles(60));
  const provider = providerFrom(getKlines);
  const store = new MemoryKlineStore();
  const cache = new KlineCache({
    resolveProvider: () => provider,
    ttlMs: 1000,
    klineLimit: 200,
    now: () => 0,
    store,
  });
  await cache.getKlines("crypto", "BTCPHP", "1h");
  // Second call is a fresh hit served from the same injected store — no refetch.
  await cache.getKlines("crypto", "BTCPHP", "1h");
  expect(getKlines).toHaveBeenCalledTimes(1);
  expect(await store.get("crypto:BTCPHP:1h")).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- klineCache`
Expected: FAIL — `store` is not an accepted dep / not persisted where the test can read it.

- [ ] **Step 3: Rewrite `klineCache.ts`**

Replace the entire file `web/src/klineCache.ts` with:

```ts
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
```

Notes for the implementer:
- The in-flight de-dup still works: the two concurrent calls each `await store.get` (a miss), then resume in order — the first sets `inflight` synchronously before its provider call suspends, so the second finds the in-flight promise. The existing "dedups concurrent requests" test verifies this.
- The eviction test still passes because `maxEntries` is forwarded to the default `MemoryKlineStore`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w web -- klineCache`
Expected: PASS — all pre-existing tests plus the new injected-store test.

- [ ] **Step 5: Run the full web suite (guard against regressions)**

Run: `npm test -w web`
Expected: PASS (all files).

- [ ] **Step 6: Commit**

```bash
git add web/src/klineCache.ts web/test/klineCache.test.ts
git commit -m "refactor(web): back KlineCache with a swappable KlineStore"
```

---

### Task 4: `buildAppFromEnv()` factory + slim `index.ts`

**Files:**
- Create: `web/src/app.ts`
- Modify: `web/src/index.ts`
- Test: `web/test/app.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `buildRegistry`, `KlineCache`, `makeKlineStore`, `SignalService`, `ForecastService`, `AnalyzeService`, `createApp`.
- Produces: `function buildAppFromEnv(env?: NodeJS.ProcessEnv): import("express").Express` — constructs config → registry → store (via `makeKlineStore`) → cache → services → app. Used by `index.ts` and by the Vercel function in Task 5.

- [ ] **Step 1: Write the failing test**

Create `web/test/app.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildAppFromEnv } from "../src/app.js";

describe("buildAppFromEnv", () => {
  it("serves /api/health in pure-API mode without env config", async () => {
    const app = buildAppFromEnv({} as NodeJS.ProcessEnv);
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("rejects protected routes with 401 when API_TOKEN is set and no token is sent", async () => {
    const app = buildAppFromEnv({ API_TOKEN: "secret" } as unknown as NodeJS.ProcessEnv);
    const res = await request(app).get("/api/watchlist");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- app.test`
Expected: FAIL — cannot find module `../src/app.js`.

- [ ] **Step 3: Create `web/src/app.ts`**

```ts
import type { Express } from "express";
import type { AssetClass } from "@coins-trend-advisor/core";
import { loadConfig } from "./config.js";
import { buildRegistry } from "./providers.js";
import { makeKlineStore } from "./klineStore.js";
import { KlineCache } from "./klineCache.js";
import { SignalService } from "./signalService.js";
import { ForecastService } from "./forecastService.js";
import { AnalyzeService } from "./analyzeService.js";
import { createApp } from "./server.js";

/** Build the fully-wired Express app from environment configuration. Shared by
 * the local server (index.ts) and the Vercel serverless entry (api/[...path].ts). */
export function buildAppFromEnv(env: NodeJS.ProcessEnv = process.env): Express {
  const config = loadConfig(env);
  const registry = buildRegistry(config);
  const store = makeKlineStore(env);
  const cache = new KlineCache({
    resolveProvider: (ac: AssetClass) => {
      const p = registry.resolve(ac);
      if (!p) throw new Error(`no provider for asset class ${ac}`);
      return p;
    },
    ttlMs: config.signalTtlMs,
    klineLimit: config.klineLimit,
    store,
  });
  const signals = new SignalService({ cache });
  const forecasts = new ForecastService({ cache });
  const analyze = new AnalyzeService({ cache, risk: config.risk });
  return createApp({ config, registry, cache, signals, forecasts, analyze });
}
```

- [ ] **Step 4: Slim down `web/src/index.ts`**

Replace the entire file `web/src/index.ts` with:

```ts
import { loadConfig } from "./config.js";
import { buildAppFromEnv } from "./app.js";

const config = loadConfig();
const app = buildAppFromEnv();

app.listen(config.port, () => {
  console.log(`web backend listening on :${config.port}`);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w web -- app.test`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + full suite**

Run: `npm run typecheck -w web && npm test -w web`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/app.ts web/src/index.ts web/test/app.test.ts
git commit -m "refactor(web): extract buildAppFromEnv shared app factory"
```

---

### Task 5: Vercel serverless entry + `vercel.json`

**Files:**
- Create: `api/[...path].ts`
- Create: `vercel.json`
- Create: `.vercelignore`
- Test: `web/test/serverless.entry.test.ts`

**Interfaces:**
- Consumes: `buildAppFromEnv` from Task 4.
- Produces: `api/[...path].ts` default-exports the Express app (the handler `@vercel/node` invokes).

- [ ] **Step 1: Write the failing test**

Create `web/test/serverless.entry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../api/[...path].js";

describe("serverless entry", () => {
  it("default-exports an Express app that answers /api/health", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- serverless.entry`
Expected: FAIL — cannot find module `../../api/[...path].js`.

- [ ] **Step 3: Create `api/[...path].ts`**

```ts
import { buildAppFromEnv } from "../web/src/app.js";

// Built once per cold start at module scope; reused across warm invocations.
const app = buildAppFromEnv();

export default app;
```

- [ ] **Step 4: Create `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build -w core && npm run build -w frontend",
  "outputDirectory": "frontend/dist",
  "rewrites": [
    { "source": "/((?!api).*)", "destination": "/index.html" }
  ]
}
```

Notes:
- `api/[...path].ts` is auto-detected by Vercel as a catch-all function serving `/api/*`; no explicit route entry is needed for it.
- Vercel checks the filesystem (static assets in `frontend/dist`) before applying `rewrites`, so real asset files still serve directly; only unknown non-`/api` routes fall back to `index.html` (SPA behavior).

- [ ] **Step 5: Create `.vercelignore`**

```
node_modules
**/dist
**/*.test.ts
**/test
docs
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -w web -- serverless.entry`
Expected: PASS (1 test).

- [ ] **Step 7: Verify the function bundles under Vercel's runtime (manual, requires Vercel CLI)**

Run: `npx vercel dev --listen 3002` then in another shell `curl http://localhost:3002/api/health`
Expected: `{"status":"ok",...}`. This is the real check that `@vercel/node` resolves the `@coins-trend-advisor/core` workspace import (mitigated by the build command building `core` first). If it fails to resolve core, add `core` to the build and confirm `core/dist` exists.
(If the Vercel CLI is not yet linked, this step can be deferred to the preview-deploy verification in the deploy docs — note it as pending rather than skipping silently.)

- [ ] **Step 8: Commit**

```bash
git add "api/[...path].ts" vercel.json .vercelignore web/test/serverless.entry.test.ts
git commit -m "feat(deploy): add Vercel serverless entry and routing config"
```

---

### Task 6: Frontend embedded token

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/main.tsx`
- Test: `frontend/src/test/api.test.ts` (append)

**Interfaces:**
- Consumes: existing `setApiToken` in `frontend/src/api.ts`.
- Produces: `function initApiToken(env: { VITE_API_TOKEN?: string }): void` — calls `setApiToken(env.VITE_API_TOKEN ?? null)`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/test/api.test.ts`:

```ts
describe("initApiToken", () => {
  it("sends the Authorization header after init with a token", async () => {
    api.initApiToken({ VITE_API_TOKEN: "sekret" });
    const fetchMock = vi.fn(async () => jsonResponse({ entries: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await api.getWatchlist();
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sekret");
    api.setApiToken(null);
  });

  it("clears the token when VITE_API_TOKEN is absent", async () => {
    api.setApiToken("stale");
    api.initApiToken({});
    const fetchMock = vi.fn(async () => jsonResponse({ entries: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await api.getWatchlist();
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w frontend -- api.test`
Expected: FAIL — `api.initApiToken` is not a function.

- [ ] **Step 3: Add `initApiToken` to `frontend/src/api.ts`**

Insert after the existing `setApiToken` function (around line 15):

```ts
export function initApiToken(env: { VITE_API_TOKEN?: string }): void {
  setApiToken(env.VITE_API_TOKEN ?? null);
}
```

- [ ] **Step 4: Wire it in `frontend/src/main.tsx`**

Replace the entire file `frontend/src/main.tsx` with:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initApiToken } from "./api.js";
import "./styles.css";

initApiToken(import.meta.env);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w frontend -- api.test`
Expected: PASS (existing api tests + 2 new).

- [ ] **Step 6: Typecheck + full frontend suite**

Run: `npm run typecheck -w frontend && npm test -w frontend`
Expected: no type errors; all tests pass. (`import.meta.env.VITE_API_TOKEN` is typed as `string | undefined` by Vite's client types; no extra typing needed.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api.ts frontend/src/main.tsx frontend/src/test/api.test.ts
git commit -m "feat(frontend): send embedded VITE_API_TOKEN as bearer auth"
```

---

### Task 7: Deploy documentation

**Files:**
- Create: `docs/deploy-vercel.md`
- Modify: `README.md` (add a "Deploy" pointer if a README exists; otherwise skip that edit)

- [ ] **Step 1: Write `docs/deploy-vercel.md`**

```markdown
# Deploying to Vercel (free tier)

Frontend is served statically from Vercel's CDN; the Express backend runs as one
catch-all serverless function at `/api/*`. Market-data caching uses Upstash Redis
so the cache survives the serverless lifecycle.

## One-time setup

1. `npm i -g vercel` (already installed) and `vercel login`.
2. Create a free Upstash Redis database at https://console.upstash.com — copy the
   **REST URL** and **REST token** (not the TCP connection string).
3. From the repo root: `vercel link`.
4. Add environment variables for **Production** and **Preview**
   (`vercel env add <NAME>` or the Vercel dashboard):

   | Variable | Value |
   | --- | --- |
   | `API_TOKEN` | any random string (backend token check) |
   | `VITE_API_TOKEN` | the same string (embedded in the frontend build) |
   | `UPSTASH_REDIS_REST_URL` | from Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | from Upstash |
   | `FINNHUB_API_KEY` | optional; only if using the stock asset class |

   Note: `VITE_API_TOKEN` ships inside the public client bundle — it deters casual
   abuse but is not a true secret. The Upstash cache is what bounds upstream cost.

## Deploy

- Preview: `vercel`
- Production: `vercel --prod`
- Or connect the GitHub repo in the Vercel dashboard for auto-deploy on push.

## Verify

- `curl https://<your-app>.vercel.app/api/health` → `{"status":"ok",...}`
- Open the app; the dashboard should load market data (calls go through `/api/*`).
- Without env vars set, the backend still runs but uses in-memory caching and an
  open API (no token). Set the vars above for the intended production behavior.

## Free-tier notes

- Vercel Hobby: personal/non-commercial only; 10s function timeout, 100 GB
  bandwidth/mo, 100K invocations/mo.
- Upstash free: 256 MB, 500K commands/month.
```

- [ ] **Step 2: Add a Deploy pointer to `README.md` (only if `README.md` exists)**

Append this section to `README.md`:

```markdown
## Deploy

See [docs/deploy-vercel.md](docs/deploy-vercel.md) for deploying the app to
Vercel's free tier (static frontend + serverless backend + Upstash Redis cache).
```

If no `README.md` exists, skip this step (do not create one).

- [ ] **Step 3: Commit**

```bash
git add docs/deploy-vercel.md README.md
git commit -m "docs(deploy): add Vercel deployment guide"
```

---

## Self-Review Notes

- **Spec coverage:** §1 vercel.json → Task 5; §2 serverless entry → Tasks 4–5; §3 KlineStore/Memory/Redis/factory + KlineCache refactor → Tasks 1–3; §4 auth (frontend token) → Task 6 (backend needs no code change, only the `API_TOKEN` env — covered in Task 7 docs and verified by Task 4's 401 test); §5 env vars → Task 7 docs; §6 testing → tests in every task; deploy steps → Task 7.
- **Type consistency:** `StoredKlines`/`KlineStore`/`RedisLike`/`MemoryKlineStore`/`RedisKlineStore`/`makeKlineStore` names are used identically across Tasks 1–4. `buildAppFromEnv` signature matches between Tasks 4 and 5. Cache key format `${assetClass}:${symbol}:${interval}` is unchanged from the original.
- **Backward compatibility:** `store` is optional on `KlineCacheDeps`; all existing `klineCache.test.ts` cases construct the cache without it and keep passing via the default `MemoryKlineStore`.
```
