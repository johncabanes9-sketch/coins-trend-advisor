# Web Backend (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stateless Node/Express backend that wraps `@coins-trend-advisor/core` and serves signals, profit calculations, and watchlist/pairs over a small JSON API.

**Architecture:** npm-workspaces monorepo; `web` imports `core` and never re-implements indicator math. A pure `createApp(deps)` Express factory is driven by dependency injection so tests exercise the real HTTP surface with a mock `CoinsClient`. Signal freshness uses an in-memory TTL cache with in-flight de-duplication (no scheduler, no database).

**Tech Stack:** TypeScript (strict, ESM), Express 4, Vitest + supertest, `tsx` to run from source. Node 20+.

## Global Constraints

- Packages are ESM (`"type": "module"`). Node 20+.
- `web` imports only from `@coins-trend-advisor/core`'s public surface — never from `core/src/**` internals directly in source (tests/build resolve the package name to `core/src` via alias/paths for speed).
- This slice is **stateless**: no Postgres, no scheduler, no web-push, no frontend. Those are later slices.
- All API routes are under `/api`, JSON in/out. Error responses are always `{ error: { code, message } }`.
- Signal responses reuse `core`'s `Signal` verbatim, including the exact `disclaimer` string and `asOf`. The API adds only `stale`/`staleAsOf` envelope markers.
- Allowed candle intervals: `"1h"`, `"4h"` (default `"1h"`). `core` requires ≥ 35 candles, so `KLINE_LIMIT` default is 200.
- Default watchlist: `BTCPHP,ETHPHP,XRPPHP,SOLPHP,USDTPHP`.

---

## File Structure

```
package.json              (root) private, workspaces: ["core","web"]
web/
  package.json            express dep; tsx/vitest/supertest/typescript devDeps
  tsconfig.json           strict, Bundler resolution, paths -> ../core/src
  vitest.config.ts        alias @coins-trend-advisor/core -> ../core/src/index.ts
  src/
    config.ts             loadConfig(env) -> AppConfig            (Task 1)
    signalCache.ts        SignalCache: TTL cache + dedup          (Task 2)
    errors.ts             ApiError, asyncHandler, errorMiddleware (Task 3)
    server.ts             createApp(deps) -> Express              (Task 3, extended 4-6)
    routes/
      health.ts           GET /api/health                        (Task 3)
      profit.ts           POST /api/profit                       (Task 4)
      signals.ts          GET /api/signals(/:pair)               (Task 5)
      watchlist.ts        GET /api/watchlist, GET /api/pairs      (Task 6)
    coins.ts              makeClient(config) -> CoinsClient       (Task 7)
    index.ts              entrypoint                              (Task 7)
  test/
    wiring.test.ts        core resolves from web                 (Task 1)
    config.test.ts                                               (Task 1)
    signalCache.test.ts                                          (Task 2)
    routes.health.test.ts                                        (Task 3)
    routes.profit.test.ts                                        (Task 4)
    routes.signals.test.ts                                       (Task 5)
    routes.meta.test.ts                                          (Task 6)
    smoke.live.test.ts    skipped unless RUN_SMOKE=1             (Task 7)
```

---

## Task 1: Monorepo workspace + web scaffold + config

**Files:**
- Create: `package.json` (repo root)
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vitest.config.ts`
- Create: `web/src/config.ts`
- Test: `web/test/config.test.ts`, `web/test/wiring.test.ts`

**Interfaces:**
- Consumes: `@coins-trend-advisor/core` public exports (`generateSignal`, `calculateProfit`, `CoinsClient`).
- Produces:
  - `interface AppConfig { port: number; coinsBaseUrl: string; watchlist: string[]; signalTtlMs: number; klineInterval: string; klineLimit: number; apiToken?: string; allowedIntervals: string[]; }`
  - `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`

- [ ] **Step 1: Create root `package.json`**

If a root `package.json` already exists, add the `"workspaces"` field to it instead of overwriting.

```json
{
  "name": "coins-trend-advisor",
  "version": "0.0.0",
  "private": true,
  "workspaces": ["core", "web"]
}
```

- [ ] **Step 2: Create `web/package.json`**

```json
{
  "name": "@coins-trend-advisor/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@coins-trend-advisor/core": "*",
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^6.3.4",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 3: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": { "@coins-trend-advisor/core": ["../core/src/index.ts"] },
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Create `web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@coins-trend-advisor/core": fileURLToPath(
        new URL("../core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Install workspaces**

Run (from repo root): `npm install`
Expected: installs succeed; `node_modules/@coins-trend-advisor/core` is symlinked to the `core` workspace. Ensure `node_modules` is git-ignored (add a `.gitignore` line at repo root if not already present).

- [ ] **Step 6: Write the failing tests**

```ts
// web/test/wiring.test.ts
import { describe, it, expect } from "vitest";
import { generateSignal, calculateProfit, CoinsClient } from "@coins-trend-advisor/core";

describe("core workspace wiring", () => {
  it("resolves the core package from web", () => {
    expect(typeof generateSignal).toBe("function");
    expect(typeof calculateProfit).toBe("function");
    expect(typeof CoinsClient).toBe("function");
  });
});
```

```ts
// web/test/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults on an empty env", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3001);
    expect(c.coinsBaseUrl).toBe("https://api.pro.coins.ph");
    expect(c.signalTtlMs).toBe(300000);
    expect(c.klineInterval).toBe("1h");
    expect(c.klineLimit).toBe(200);
    expect(c.watchlist).toEqual(["BTCPHP", "ETHPHP", "XRPPHP", "SOLPHP", "USDTPHP"]);
    expect(c.allowedIntervals).toEqual(["1h", "4h"]);
    expect(c.apiToken).toBeUndefined();
  });

  it("parses provided values and a custom watchlist", () => {
    const c = loadConfig({
      PORT: "4000",
      SIGNAL_TTL_MS: "1000",
      WATCHLIST: "BTCPHP, ETHPHP ,",
      API_TOKEN: "secret",
    });
    expect(c.port).toBe(4000);
    expect(c.signalTtlMs).toBe(1000);
    expect(c.watchlist).toEqual(["BTCPHP", "ETHPHP"]);
    expect(c.apiToken).toBe("secret");
  });

  it("throws on a non-numeric numeric env var", () => {
    expect(() => loadConfig({ SIGNAL_TTL_MS: "abc" })).toThrow();
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd web && npx vitest run test/config.test.ts test/wiring.test.ts`
Expected: FAIL — `config.test.ts` cannot resolve `../src/config.js`. (`wiring.test.ts` should already pass once install/alias are correct.)

- [ ] **Step 8: Write `web/src/config.ts`**

```ts
export interface AppConfig {
  port: number;
  coinsBaseUrl: string;
  watchlist: string[];
  signalTtlMs: number;
  klineInterval: string;
  klineLimit: number;
  apiToken?: string;
  allowedIntervals: string[];
}

const DEFAULT_WATCHLIST = ["BTCPHP", "ETHPHP", "XRPPHP", "SOLPHP", "USDTPHP"];
const ALLOWED_INTERVALS = ["1h", "4h"];

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`config: ${key} must be a number, got "${raw}"`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsedWatchlist = env.WATCHLIST?.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    port: num(env, "PORT", 3001),
    coinsBaseUrl: env.COINS_BASE_URL ?? "https://api.pro.coins.ph",
    watchlist:
      parsedWatchlist && parsedWatchlist.length > 0
        ? parsedWatchlist
        : DEFAULT_WATCHLIST,
    signalTtlMs: num(env, "SIGNAL_TTL_MS", 300000),
    klineInterval: env.KLINE_INTERVAL ?? "1h",
    klineLimit: num(env, "KLINE_LIMIT", 200),
    apiToken: env.API_TOKEN || undefined,
    allowedIntervals: ALLOWED_INTERVALS,
  };
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd web && npx vitest run test/config.test.ts test/wiring.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 10: Commit**

```bash
git add package.json web/package.json web/tsconfig.json web/vitest.config.ts web/src/config.ts web/test/config.test.ts web/test/wiring.test.ts .gitignore
git commit -m "feat(web): scaffold workspace, backend package, and config loader"
```

---

## Task 2: Signal cache (TTL + in-flight dedup)

**Files:**
- Create: `web/src/signalCache.ts`
- Test: `web/test/signalCache.test.ts`

**Interfaces:**
- Consumes: `generateSignal`, `Kline`, `Signal`, `CoinsClient` from `core`.
- Produces:
  - `type SignalOk = { pair: string; status: "ok"; signal: Signal; stale?: boolean; staleAsOf?: string }`
  - `type SignalResult = SignalOk | { pair: string; status: "insufficient_data" } | { pair: string; status: "error"; message: string }`
  - `interface SignalCacheDeps { client: Pick<CoinsClient, "getKlines">; ttlMs: number; klineLimit: number; now?: () => number }`
  - `class SignalCache` with `getSignal(pair: string, interval: string): Promise<SignalResult>` and `getWatchlistSignals(pairs: string[], interval: string): Promise<SignalResult[]>`

- [ ] **Step 1: Write the failing tests**

```ts
// web/test/signalCache.test.ts
import { describe, it, expect, vi } from "vitest";
import { SignalCache } from "../src/signalCache.js";
import type { Kline } from "@coins-trend-advisor/core";
import { DISCLAIMER } from "@coins-trend-advisor/core";

function candles(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000,
    open: 100 + i,
    high: 100 + i,
    low: 100 + i,
    close: 100 + i,
    volume: 1,
    closeTime: i * 1000 + 1,
  }));
}

function makeClient(rows: Kline[]) {
  return { getKlines: vi.fn(async () => rows) };
}

describe("SignalCache", () => {
  it("computes and returns an ok signal", async () => {
    const client = makeClient(candles(60));
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200 });
    const r = await cache.getSignal("BTCPHP", "1h");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.signal.disclaimer).toBe(DISCLAIMER);
    expect(client.getKlines).toHaveBeenCalledTimes(1);
  });

  it("serves a cached value within TTL without refetching", async () => {
    const client = makeClient(candles(60));
    let t = 0;
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200, now: () => t });
    await cache.getSignal("BTCPHP", "1h");
    t = 500;
    await cache.getSignal("BTCPHP", "1h");
    expect(client.getKlines).toHaveBeenCalledTimes(1);
  });

  it("recomputes after TTL expiry", async () => {
    const client = makeClient(candles(60));
    let t = 0;
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200, now: () => t });
    await cache.getSignal("BTCPHP", "1h");
    t = 1500;
    await cache.getSignal("BTCPHP", "1h");
    expect(client.getKlines).toHaveBeenCalledTimes(2);
  });

  it("reports insufficient_data for a short series", async () => {
    const client = makeClient(candles(10));
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200 });
    const r = await cache.getSignal("BTCPHP", "1h");
    expect(r.status).toBe("insufficient_data");
  });

  it("dedups concurrent requests for the same key", async () => {
    let resolve!: (v: Kline[]) => void;
    const client = {
      getKlines: vi.fn(() => new Promise<Kline[]>((res) => { resolve = res; })),
    };
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200 });
    const p1 = cache.getSignal("BTCPHP", "1h");
    const p2 = cache.getSignal("BTCPHP", "1h");
    resolve(candles(60));
    await Promise.all([p1, p2]);
    expect(client.getKlines).toHaveBeenCalledTimes(1);
  });

  it("serves a stale cached signal when upstream later fails", async () => {
    const rows = candles(60);
    let fail = false;
    const client = {
      getKlines: vi.fn(async () => {
        if (fail) throw new Error("boom");
        return rows;
      }),
    };
    let t = 0;
    const cache = new SignalCache({ client, ttlMs: 1000, klineLimit: 200, now: () => t });
    await cache.getSignal("BTCPHP", "1h");
    t = 2000;
    fail = true;
    const r = await cache.getSignal("BTCPHP", "1h");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.stale).toBe(true);
    expect(typeof r.staleAsOf).toBe("string");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run test/signalCache.test.ts`
Expected: FAIL — cannot resolve `../src/signalCache.js`.

- [ ] **Step 3: Write `web/src/signalCache.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run test/signalCache.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/signalCache.ts web/test/signalCache.test.ts
git commit -m "feat(web): add in-memory signal cache with TTL and in-flight dedup"
```

---

## Task 3: Error plumbing + app factory + health route

**Files:**
- Create: `web/src/errors.ts`
- Create: `web/src/server.ts`
- Create: `web/src/routes/health.ts`
- Test: `web/test/routes.health.test.ts`

**Interfaces:**
- Consumes: `AppConfig` (Task 1), `SignalCache` (Task 2), `CoinsClient` from `core`.
- Produces:
  - `class ApiError extends Error { code: string; status: number; }`
  - `asyncHandler(fn): RequestHandler`
  - `errorMiddleware: ErrorRequestHandler`
  - `interface AppDeps { config: AppConfig; client: CoinsClient; cache: SignalCache }`
  - `createApp(deps: AppDeps): Express`
  - `healthRoutes(): Router`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/routes.health.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { SignalCache } from "../src/signalCache.js";
import { CoinsClient } from "@coins-trend-advisor/core";

function makeApp() {
  const config = loadConfig({});
  const client = new CoinsClient({ baseUrl: config.coinsBaseUrl });
  const cache = new SignalCache({
    client,
    ttlMs: config.signalTtlMs,
    klineLimit: config.klineLimit,
  });
  return createApp({ config, client, cache });
}

describe("health + 404", () => {
  it("GET /api/health returns ok", async () => {
    const res = await request(makeApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("an unknown /api route returns a JSON 404", async () => {
    const res = await request(makeApp()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/routes.health.test.ts`
Expected: FAIL — cannot resolve `../src/server.js`.

- [ ] **Step 3: Write `web/src/errors.ts`**

```ts
import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from "express";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal", message: "Internal server error" } });
};
```

- [ ] **Step 4: Write `web/src/routes/health.ts`**

```ts
import { Router } from "express";

export function healthRoutes(): Router {
  const r = Router();
  const startedAt = Date.now();
  r.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: (Date.now() - startedAt) / 1000 });
  });
  return r;
}
```

- [ ] **Step 5: Write `web/src/server.ts`**

```ts
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import type { AppConfig } from "./config.js";
import type { SignalCache } from "./signalCache.js";
import type { CoinsClient } from "@coins-trend-advisor/core";
import { errorMiddleware } from "./errors.js";
import { healthRoutes } from "./routes/health.js";

export interface AppDeps {
  config: AppConfig;
  client: CoinsClient;
  cache: SignalCache;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  // Health is intentionally mounted before auth so liveness checks stay open.
  app.use("/api", healthRoutes());

  if (deps.config.apiToken) {
    app.use("/api", requireToken(deps.config.apiToken));
  }

  // --- feature routers are mounted here by later tasks ---

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

- [ ] **Step 6: Run test to verify it passes**

Run: `cd web && npx vitest run test/routes.health.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add web/src/errors.ts web/src/server.ts web/src/routes/health.ts web/test/routes.health.test.ts
git commit -m "feat(web): add error middleware, app factory, and health route"
```

---

## Task 4: Profit route

**Files:**
- Create: `web/src/routes/profit.ts`
- Modify: `web/src/server.ts` (mount the router)
- Test: `web/test/routes.profit.test.ts`

**Interfaces:**
- Consumes: `calculateProfit` from `core`; `ApiError` (Task 3).
- Produces: `profitRoutes(): Router` handling `POST /api/profit`.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/routes.profit.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { SignalCache } from "../src/signalCache.js";
import { CoinsClient } from "@coins-trend-advisor/core";

function makeApp() {
  const config = loadConfig({});
  const client = new CoinsClient({ baseUrl: config.coinsBaseUrl });
  const cache = new SignalCache({ client, ttlMs: config.signalTtlMs, klineLimit: config.klineLimit });
  return createApp({ config, client, cache });
}

describe("POST /api/profit", () => {
  it("computes a fee-bearing profit", async () => {
    const res = await request(makeApp())
      .post("/api/profit")
      .send({ entryPrice: 100, positionSize: 1000, targetPrice: 110, feePct: 1 });
    expect(res.status).toBe(200);
    expect(res.body.netProfit).toBeCloseTo(79, 6);
    expect(res.body.netProfitPct).toBeCloseTo(7.9, 6);
  });

  it("rejects a missing field with 400", async () => {
    const res = await request(makeApp())
      .post("/api/profit")
      .send({ entryPrice: 100, positionSize: 1000, targetPrice: 110 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_input");
  });

  it("rejects a non-positive entry price with 400", async () => {
    const res = await request(makeApp())
      .post("/api/profit")
      .send({ entryPrice: 0, positionSize: 1000, targetPrice: 110, feePct: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_input");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/routes.profit.test.ts`
Expected: FAIL — cannot resolve `../src/routes/profit.js` (imported by the modified server) OR route returns 404.

- [ ] **Step 3: Write `web/src/routes/profit.ts`**

```ts
import { Router } from "express";
import { calculateProfit } from "@coins-trend-advisor/core";
import { ApiError } from "../errors.js";

export function profitRoutes(): Router {
  const r = Router();
  r.post("/profit", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { entryPrice, positionSize, targetPrice, feePct } = body;
    for (const [key, value] of Object.entries({
      entryPrice,
      positionSize,
      targetPrice,
      feePct,
    })) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ApiError("invalid_input", 400, `${key} must be a finite number`);
      }
    }
    try {
      const result = calculateProfit({
        entryPrice: entryPrice as number,
        positionSize: positionSize as number,
        targetPrice: targetPrice as number,
        feePct: feePct as number,
      });
      res.json(result);
    } catch (err) {
      throw new ApiError("invalid_input", 400, (err as Error).message);
    }
  });
  return r;
}
```

- [ ] **Step 4: Mount the router in `web/src/server.ts`**

Add the import near the other route imports:

```ts
import { profitRoutes } from "./routes/profit.js";
```

Replace the mount marker line:

```ts
  // --- feature routers are mounted here by later tasks ---
```

with:

```ts
  app.use("/api", profitRoutes());
  // --- feature routers are mounted here by later tasks ---
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run test/routes.profit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/profit.ts web/src/server.ts web/test/routes.profit.test.ts
git commit -m "feat(web): add profit calculation route"
```

---

## Task 5: Signals routes (list + single)

**Files:**
- Create: `web/src/routes/signals.ts`
- Modify: `web/src/server.ts` (mount the router)
- Test: `web/test/routes.signals.test.ts`

**Interfaces:**
- Consumes: `AppDeps` (Task 3), `SignalCache.getSignal`/`getWatchlistSignals` (Task 2), `ApiError`/`asyncHandler` (Task 3).
- Produces: `signalRoutes(deps: AppDeps): Router` handling `GET /api/signals` and `GET /api/signals/:pair`.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/routes.signals.test.ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { SignalCache } from "../src/signalCache.js";
import type { AppConfig } from "../src/config.js";
import type { Kline } from "@coins-trend-advisor/core";
import { DISCLAIMER } from "@coins-trend-advisor/core";

function candles(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000,
    open: 100 + i,
    high: 100 + i,
    low: 100 + i,
    close: 100 + i,
    volume: 1,
    closeTime: i * 1000 + 1,
  }));
}

function makeApp(opts: {
  getKlines?: (pair: string, interval: string, limit: number) => Promise<Kline[]>;
  rows?: Kline[];
  watchlist?: string[];
  ttlMs?: number;
}) {
  const config: AppConfig = {
    port: 3001,
    coinsBaseUrl: "http://example.test",
    watchlist: opts.watchlist ?? ["BTCPHP", "ETHPHP"],
    signalTtlMs: opts.ttlMs ?? 1000,
    klineInterval: "1h",
    klineLimit: 200,
    apiToken: undefined,
    allowedIntervals: ["1h", "4h"],
  };
  const getKlines =
    opts.getKlines ?? vi.fn(async () => opts.rows ?? candles(60));
  const client = { getKlines, getPrice: vi.fn(), getPairs: vi.fn() } as never;
  const cache = new SignalCache({ client, ttlMs: config.signalTtlMs, klineLimit: config.klineLimit });
  return createApp({ config, client: client as never, cache });
}

describe("signals routes", () => {
  it("GET /api/signals returns results for the whole watchlist", async () => {
    const res = await request(makeApp({ rows: candles(60) })).get("/api/signals");
    expect(res.status).toBe(200);
    expect(res.body.interval).toBe("1h");
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].status).toBe("ok");
    expect(res.body.results[0].signal.disclaimer).toBe(DISCLAIMER);
  });

  it("GET /api/signals/:pair returns a single ok signal", async () => {
    const res = await request(makeApp({ rows: candles(60) })).get("/api/signals/BTCPHP");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.pair).toBe("BTCPHP");
  });

  it("returns 422 for insufficient data", async () => {
    const res = await request(makeApp({ rows: candles(10) })).get("/api/signals/BTCPHP");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("insufficient_data");
  });

  it("returns 502 when upstream fails with nothing cached", async () => {
    const res = await request(
      makeApp({ getKlines: vi.fn(async () => { throw new Error("boom"); }) }),
    ).get("/api/signals/BTCPHP");
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("upstream_unavailable");
  });

  it("rejects an unsupported interval with 400", async () => {
    const res = await request(makeApp({ rows: candles(60) })).get("/api/signals/BTCPHP?interval=2h");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_interval");
  });

  it("serves a stale signal after upstream fails post-warmup", async () => {
    const rows = candles(60);
    let fail = false;
    const getKlines = vi.fn(async () => {
      if (fail) throw new Error("boom");
      return rows;
    });
    const app = makeApp({ getKlines, ttlMs: 0 });
    const warm = await request(app).get("/api/signals/BTCPHP");
    expect(warm.body.stale).toBeUndefined();
    fail = true;
    const res = await request(app).get("/api/signals/BTCPHP");
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(true);
    expect(typeof res.body.staleAsOf).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/routes.signals.test.ts`
Expected: FAIL — cannot resolve `../src/routes/signals.js` (imported by the modified server) OR routes return 404.

- [ ] **Step 3: Write `web/src/routes/signals.ts`**

```ts
import { Router, type Request } from "express";
import type { AppDeps } from "../server.js";
import { ApiError, asyncHandler } from "../errors.js";

function resolveInterval(deps: AppDeps, req: Request): string {
  const raw = req.query.interval;
  const interval = typeof raw === "string" ? raw : deps.config.klineInterval;
  if (!deps.config.allowedIntervals.includes(interval)) {
    throw new ApiError(
      "invalid_interval",
      400,
      `interval must be one of ${deps.config.allowedIntervals.join(", ")}`,
    );
  }
  return interval;
}

export function signalRoutes(deps: AppDeps): Router {
  const r = Router();

  r.get(
    "/signals",
    asyncHandler(async (req, res) => {
      const interval = resolveInterval(deps, req);
      const results = await deps.cache.getWatchlistSignals(deps.config.watchlist, interval);
      res.json({ interval, results });
    }),
  );

  r.get(
    "/signals/:pair",
    asyncHandler(async (req, res) => {
      const interval = resolveInterval(deps, req);
      const pair = req.params.pair;
      const result = await deps.cache.getSignal(pair, interval);
      if (result.status === "insufficient_data") {
        throw new ApiError("insufficient_data", 422, `insufficient candle data for ${pair}`);
      }
      if (result.status === "error") {
        throw new ApiError("upstream_unavailable", 502, result.message);
      }
      res.json(result);
    }),
  );

  return r;
}
```

- [ ] **Step 4: Mount the router in `web/src/server.ts`**

Add the import:

```ts
import { signalRoutes } from "./routes/signals.js";
```

Replace:

```ts
  app.use("/api", profitRoutes());
  // --- feature routers are mounted here by later tasks ---
```

with:

```ts
  app.use("/api", profitRoutes());
  app.use("/api", signalRoutes(deps));
  // --- feature routers are mounted here by later tasks ---
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run test/routes.signals.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/signals.ts web/src/server.ts web/test/routes.signals.test.ts
git commit -m "feat(web): add signals list and single-pair routes with stale fallback"
```

---

## Task 6: Watchlist + pairs routes

**Files:**
- Create: `web/src/routes/watchlist.ts`
- Modify: `web/src/server.ts` (mount the router)
- Test: `web/test/routes.meta.test.ts`

**Interfaces:**
- Consumes: `AppDeps` (Task 3), `deps.config.watchlist`, `deps.client.getPairs` (from `core`'s `CoinsClient`), `asyncHandler` (Task 3).
- Produces: `metaRoutes(deps: AppDeps): Router` handling `GET /api/watchlist` and `GET /api/pairs`.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/routes.meta.test.ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { SignalCache } from "../src/signalCache.js";
import type { AppConfig } from "../src/config.js";

function makeApp(opts: { pairs?: string[]; watchlist?: string[] }) {
  const config: AppConfig = {
    port: 3001,
    coinsBaseUrl: "http://example.test",
    watchlist: opts.watchlist ?? ["BTCPHP", "ETHPHP"],
    signalTtlMs: 1000,
    klineInterval: "1h",
    klineLimit: 200,
    apiToken: undefined,
    allowedIntervals: ["1h", "4h"],
  };
  const getPairs = vi.fn(async () => opts.pairs ?? ["BTCPHP", "ETHPHP", "XRPPHP"]);
  const client = { getKlines: vi.fn(), getPrice: vi.fn(), getPairs } as never;
  const cache = new SignalCache({ client, ttlMs: config.signalTtlMs, klineLimit: config.klineLimit });
  return { app: createApp({ config, client: client as never, cache }), getPairs };
}

describe("meta routes", () => {
  it("GET /api/watchlist returns the configured pairs", async () => {
    const { app } = makeApp({ watchlist: ["BTCPHP", "ETHPHP"] });
    const res = await request(app).get("/api/watchlist");
    expect(res.status).toBe(200);
    expect(res.body.pairs).toEqual(["BTCPHP", "ETHPHP"]);
  });

  it("GET /api/pairs returns pairs and caches upstream", async () => {
    const { app, getPairs } = makeApp({ pairs: ["A", "B"] });
    const first = await request(app).get("/api/pairs");
    const second = await request(app).get("/api/pairs");
    expect(first.body.pairs).toEqual(["A", "B"]);
    expect(second.body.pairs).toEqual(["A", "B"]);
    expect(getPairs).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/routes.meta.test.ts`
Expected: FAIL — cannot resolve `../src/routes/watchlist.js` (imported by the modified server) OR routes return 404.

- [ ] **Step 3: Write `web/src/routes/watchlist.ts`**

```ts
import { Router } from "express";
import type { AppDeps } from "../server.js";
import { asyncHandler } from "../errors.js";

const PAIRS_TTL_MS = 3_600_000; // 1 hour

export function metaRoutes(deps: AppDeps): Router {
  const r = Router();

  r.get("/watchlist", (_req, res) => {
    res.json({ pairs: deps.config.watchlist });
  });

  // Per-app cache: pairs rarely change, so avoid hitting upstream on every call.
  let pairsCache: { pairs: string[]; at: number } | null = null;
  r.get(
    "/pairs",
    asyncHandler(async (_req, res) => {
      if (!pairsCache || Date.now() - pairsCache.at > PAIRS_TTL_MS) {
        pairsCache = { pairs: await deps.client.getPairs(), at: Date.now() };
      }
      res.json({ pairs: pairsCache.pairs });
    }),
  );

  return r;
}
```

- [ ] **Step 4: Mount the router in `web/src/server.ts`**

Add the import:

```ts
import { metaRoutes } from "./routes/watchlist.js";
```

Replace:

```ts
  app.use("/api", profitRoutes());
  app.use("/api", signalRoutes(deps));
  // --- feature routers are mounted here by later tasks ---
```

with:

```ts
  app.use("/api", profitRoutes());
  app.use("/api", signalRoutes(deps));
  app.use("/api", metaRoutes(deps));
  // --- feature routers are mounted here by later tasks ---
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run test/routes.meta.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/watchlist.ts web/src/server.ts web/test/routes.meta.test.ts
git commit -m "feat(web): add watchlist and pairs routes"
```

---

## Task 7: Entrypoint, client factory, and live smoke test

**Files:**
- Create: `web/src/coins.ts`
- Create: `web/src/index.ts`
- Test: `web/test/smoke.live.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `SignalCache` (Task 2), `createApp` (Task 3), `CoinsClient` from `core`.
- Produces: `makeClient(config: AppConfig): CoinsClient`; a runnable `index.ts` that binds a port.

- [ ] **Step 1: Write `web/src/coins.ts`**

```ts
import { CoinsClient } from "@coins-trend-advisor/core";
import type { AppConfig } from "./config.js";

export function makeClient(config: AppConfig): CoinsClient {
  return new CoinsClient({ baseUrl: config.coinsBaseUrl });
}
```

- [ ] **Step 2: Write `web/src/index.ts`**

```ts
import { loadConfig } from "./config.js";
import { makeClient } from "./coins.js";
import { SignalCache } from "./signalCache.js";
import { createApp } from "./server.js";

const config = loadConfig();
const client = makeClient(config);
const cache = new SignalCache({
  client,
  ttlMs: config.signalTtlMs,
  klineLimit: config.klineLimit,
});
const app = createApp({ config, client, cache });

app.listen(config.port, () => {
  console.log(`web backend listening on :${config.port}`);
});
```

- [ ] **Step 3: Write the skippable live smoke test**

```ts
// web/test/smoke.live.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { makeClient } from "../src/coins.js";
import { SignalCache } from "../src/signalCache.js";

describe.skipIf(process.env.RUN_SMOKE !== "1")("live smoke", () => {
  it("computes a real signal for BTCPHP", async () => {
    const config = loadConfig({});
    const client = makeClient(config);
    const cache = new SignalCache({
      client,
      ttlMs: config.signalTtlMs,
      klineLimit: config.klineLimit,
    });
    const app = createApp({ config, client, cache });
    const res = await request(app).get("/api/signals/BTCPHP");
    // Either a computed signal or an honest insufficient-data response.
    expect([200, 422]).toContain(res.status);
  }, 20000);
});
```

- [ ] **Step 4: Run the whole suite (smoke skipped)**

Run: `cd web && npx vitest run`
Expected: PASS — all test files green; the live smoke suite is skipped.

- [ ] **Step 5: Typecheck**

Run: `cd web && npm run typecheck`
Expected: `tsc --noEmit` exits 0 with no output.

- [ ] **Step 6: Manually verify the server boots and serves a request**

Run (from repo root, in one line):

```bash
cd web && (RUN_SMOKE=1 timeout 10 npx tsx src/index.ts &) && sleep 3 && curl -s localhost:3001/api/health && curl -s localhost:3001/api/watchlist
```

Expected: `{"status":"ok",...}` then `{"pairs":["BTCPHP",...]}`. (On Windows PowerShell, start `npx tsx src/index.ts` in one terminal and `curl` in another; the point is to confirm the process boots and both endpoints respond.)

- [ ] **Step 7: Commit**

```bash
git add web/src/coins.ts web/src/index.ts web/test/smoke.live.test.ts
git commit -m "feat(web): add client factory, entrypoint, and live smoke test"
```

---

## Self-Review Notes

**Spec coverage (spec section → task):**
- Monorepo wiring so `web` imports `core` → Task 1. ✅
- `config.ts` env parsing incl. optional `API_TOKEN` → Task 1. ✅
- In-memory TTL cache + in-flight dedup (freshness approach A) → Task 2. ✅
- Insufficient-data honesty (no fabricated signal) → Task 2 (`insufficient_data`) + Task 5 (422). ✅
- Stale-data fallback ("data stale as of <time>") → Task 2 + Task 5 integration test. ✅
- `createApp(deps)` pure factory + DI seam → Task 3. ✅
- Central error middleware, `{error:{code,message}}` shape, JSON 404 → Task 3. ✅
- Optional bearer-token auth (health stays open) → Task 3. ✅
- `POST /api/profit` with 400 validation → Task 4. ✅
- `GET /api/signals` (list) + `GET /api/signals/:pair` (single, 422/502), interval validation → Task 5. ✅
- `GET /api/watchlist` + `GET /api/pairs` (lightly cached) → Task 6. ✅
- Entrypoint + client factory + skippable live smoke → Task 7. ✅
- Vitest + supertest, injected mock `CoinsClient`, no live network in default suite → Tasks 2–6. ✅

**Deferred (called out in spec, no task by design):** Postgres + editable watchlist, scheduler, web-push, React PWA, deployment. These are later slices.

**Type consistency check:** `SignalResult`/`SignalOk` defined in Task 2 are consumed unchanged in Task 5; `AppDeps` defined in Task 3 is consumed in Tasks 5–6; `AppConfig` defined in Task 1 is consumed in Tasks 2/3/5/6/7; `ApiError`/`asyncHandler` defined in Task 3 are consumed in Tasks 4/5/6. `makeClient` (Task 7) matches its use in `index.ts` and the smoke test. The `server.ts` mount marker is introduced in Task 3 and edited by Tasks 4→5→6 in order, each preserving the marker line.
