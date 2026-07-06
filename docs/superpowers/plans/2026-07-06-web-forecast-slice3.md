# Price Forecast (Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure-TypeScript price forecast (Holt's linear exponential smoothing) with a confidence band, served at `GET /api/forecast/:assetClass/:symbol`, reusing Slice 2's `KlineCache`.

**Architecture:** A pure `forecast()` in `core` fits Holt's linear method over candle closes and projects `level + h·trend` with a residual-based band. A thin `ForecastService` in `web` runs it over cached klines from the shared `KlineCache` — so a signal and a forecast for the same symbol share one upstream fetch. A new route reuses the asset-class/interval helpers from the signals route.

**Tech Stack:** TypeScript (strict, ESM, `noUncheckedIndexedAccess`), Express 4, Vitest + supertest. Node 20+.

## Global Constraints

- **Prerequisite:** Slice 2 (multi-asset) is merged. This plan assumes `KlineCache`, `SignalService`, `ProviderRegistry`, the class-tagged `AppConfig`, and asset-class routes exist.
- Packages are ESM. `web` imports only from `@coins-trend-advisor/core`'s public surface.
- All routes under `/api`, JSON in/out. Error shape `{ error: { code, message } }`. Upstream detail sanitized to a static message, logged server-side.
- Forecast is a **statistical estimate**, never a promise: reuse the shared `DISCLAIMER`; `insufficient_data` (422) when fewer than 35 candles.
- Forecast and signal **share the `KlineCache`** (single-fetch design). Forecast therefore inherits `signalTtlMs`; a separate `FORECAST_TTL_MS` is intentionally **not** implemented (it would force a second cache and double upstream calls — YAGNI). Only `FORECAST_HORIZON` (default 5) is configurable.
- Asset classes and intervals are validated per-provider exactly as in Slice 2.

---

## File Structure

```
core/src/
  forecast.ts               (create) forecast() — Holt linear + band
  index.ts                  (modify) export forecast + Forecast
core/test/
  forecast.test.ts          (create)

web/src/
  config.ts                 (modify) add forecastHorizon
  forecastService.ts        (create) ForecastService over KlineCache
  routes/shared.ts          (create) parseAssetClass / resolveInterval / constants
  routes/signals.ts         (modify) import shared helpers (DRY)
  routes/forecast.ts        (create) GET /forecast/:assetClass/:symbol
  server.ts                 (modify) AppDeps.forecasts; mount forecast route
  index.ts                  (modify) build ForecastService
web/test/
  config.test.ts            (modify) assert forecastHorizon
  forecastService.test.ts   (create)
  routes.forecast.test.ts   (create)
  routes.signals.test.ts    (modify) add forecasts to test AppDeps
  routes.meta.test.ts       (modify) add forecasts to test AppDeps
  smoke.live.test.ts        (modify) add a forecast path
```

---

## Task 1: `forecast()` — Holt linear model (core)

**Files:**
- Create: `core/src/forecast.ts`
- Modify: `core/src/index.ts`
- Test: `core/test/forecast.test.ts`

**Interfaces:**
- Consumes: `Kline`, `DISCLAIMER` from `core/src/types.ts`.
- Produces:
  - `interface Forecast { symbol: string; horizon: number; predicted: number; lower: number; upper: number; method: "holt-linear"; asOf: string; disclaimer: string }`
  - `function forecast(symbol: string, candles: Kline[], opts?: { horizon?: number }): Forecast | { status: "insufficient_data" }`

- [ ] **Step 1: Write the failing test**

```ts
// core/test/forecast.test.ts
import { describe, it, expect } from "vitest";
import { forecast } from "../src/forecast.js";
import { DISCLAIMER, type Kline } from "../src/types.js";

function series(closes: number[]): Kline[] {
  return closes.map((close, i) => ({
    openTime: i * 1000, open: close, high: close, low: close,
    close, volume: 1, closeTime: i * 1000 + 1,
  }));
}

const ramp = (n: number) => Array.from({ length: n }, (_, i) => 100 + i);

describe("forecast", () => {
  it("returns insufficient_data for a short series", () => {
    const r = forecast("X", series(ramp(10)));
    expect("status" in r && r.status).toBe("insufficient_data");
  });

  it("extrapolates a linear uptrend with a tight band", () => {
    const r = forecast("BTCPHP", series(ramp(60)), { horizon: 5 });
    if ("status" in r) throw new Error("expected a forecast");
    expect(r.method).toBe("holt-linear");
    expect(r.symbol).toBe("BTCPHP");
    expect(r.horizon).toBe(5);
    // last close 159, trend ~1/step => ~164 five steps out
    expect(r.predicted).toBeCloseTo(164, 0);
    expect(r.upper - r.lower).toBeLessThan(1);
    expect(r.disclaimer).toBe(DISCLAIMER);
  });

  it("predicts ~no change for a flat series and a near-zero band", () => {
    const r = forecast("X", series(Array.from({ length: 60 }, () => 100)), { horizon: 3 });
    if ("status" in r) throw new Error("expected a forecast");
    expect(r.predicted).toBeCloseTo(100, 6);
    expect(r.upper - r.lower).toBeCloseTo(0, 6);
  });

  it("produces a wider band for a noisy series", () => {
    const noisy = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5));
    const r = forecast("X", series(noisy), { horizon: 5 });
    if ("status" in r) throw new Error("expected a forecast");
    expect(r.upper - r.lower).toBeGreaterThan(1);
  });

  it("defaults the horizon to 5", () => {
    const r = forecast("X", series(ramp(60)));
    if ("status" in r) throw new Error("expected a forecast");
    expect(r.horizon).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run test/forecast.test.ts`
Expected: FAIL — cannot resolve `../src/forecast.js`.

- [ ] **Step 3: Write `core/src/forecast.ts`**

```ts
import { DISCLAIMER, type Kline } from "./types.js";

const MIN_CANDLES = 35;
const Z_80 = 1.2816; // ~80% two-sided normal quantile
const GRID = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

export interface Forecast {
  symbol: string;
  horizon: number;
  predicted: number;
  lower: number;
  upper: number;
  method: "holt-linear";
  asOf: string;
  disclaimer: string;
}

interface HoltFit {
  level: number;
  trend: number;
  sse: number;
  count: number;
}

/** Holt's linear exponential smoothing; returns final level/trend and in-sample SSE. */
function holt(y: number[], alpha: number, beta: number): HoltFit {
  let level = y[0]!;
  let trend = y[1]! - y[0]!;
  let sse = 0;
  let count = 0;
  for (let t = 1; t < y.length; t++) {
    const oneStep = level + trend; // forecast for y[t] before observing it
    const actual = y[t]!;
    const err = actual - oneStep;
    sse += err * err;
    count += 1;
    const prevLevel = level;
    level = alpha * actual + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  return { level, trend, sse, count };
}

export function forecast(
  symbol: string,
  candles: Kline[],
  opts: { horizon?: number } = {},
): Forecast | { status: "insufficient_data" } {
  if (candles.length < MIN_CANDLES) {
    return { status: "insufficient_data" };
  }
  const horizon = opts.horizon ?? 5;
  const y = candles.map((c) => c.close);

  // Deterministic grid search minimizing one-step SSE (first minimum wins ties).
  let best = holt(y, GRID[0]!, GRID[0]!);
  for (const alpha of GRID) {
    for (const beta of GRID) {
      const fit = holt(y, alpha, beta);
      if (fit.sse < best.sse) best = fit;
    }
  }

  const predicted = best.level + horizon * best.trend;
  const variance = best.count > 0 ? best.sse / best.count : 0;
  const band = Z_80 * Math.sqrt(variance) * Math.sqrt(horizon);
  const asOf = new Date(candles[candles.length - 1]!.closeTime).toISOString();

  return {
    symbol,
    horizon,
    predicted,
    lower: predicted - band,
    upper: predicted + band,
    method: "holt-linear",
    asOf,
    disclaimer: DISCLAIMER,
  };
}
```

- [ ] **Step 4: Export from `core/src/index.ts`**

Add to `core/src/index.ts`:

```ts
export { forecast, type Forecast } from "./forecast.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd core && npx vitest run test/forecast.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
cd core && npm run typecheck
git add core/src/forecast.ts core/src/index.ts core/test/forecast.test.ts
git commit -m "feat(core): add Holt-linear price forecaster with confidence band"
```

---

## Task 2: Forecast horizon config (web)

**Files:**
- Modify: `web/src/config.ts`
- Test: `web/test/config.test.ts`

**Interfaces:**
- Produces: `AppConfig.forecastHorizon: number` (default 5).

- [ ] **Step 1: Extend the config test**

In `web/test/config.test.ts`, add to the "applies defaults on an empty env" test (after the `klineLimit` assertion):

```ts
    expect(c.forecastHorizon).toBe(5);
```

Add a new test after it:

```ts
  it("parses a custom forecast horizon", () => {
    expect(loadConfig({ FORECAST_HORIZON: "10" }).forecastHorizon).toBe(10);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/config.test.ts`
Expected: FAIL — `forecastHorizon` is `undefined`.

- [ ] **Step 3: Add the field to `web/src/config.ts`**

Add to the `AppConfig` interface (after `klineLimit: number;`):

```ts
  forecastHorizon: number;
```

Add to the returned object in `loadConfig` (after `klineLimit: num(env, "KLINE_LIMIT", 200),`):

```ts
    forecastHorizon: num(env, "FORECAST_HORIZON", 5),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/config.ts web/test/config.test.ts
git commit -m "feat(web): add FORECAST_HORIZON config (default 5)"
```

---

## Task 3: `ForecastService` (web)

**Files:**
- Create: `web/src/forecastService.ts`
- Test: `web/test/forecastService.test.ts`

**Interfaces:**
- Consumes: `KlineCache`/`KlinesResult` (Slice 2), `forecast`, `Forecast`, `AssetClass` from core.
- Produces:
  - `type ForecastResult = { assetClass: AssetClass; symbol: string; status: "ok"; forecast: Forecast; stale?: boolean; staleAsOf?: string } | { assetClass: AssetClass; symbol: string; status: "insufficient_data" } | { assetClass: AssetClass; symbol: string; status: "error"; message: string }`
  - `class ForecastService` with `get(assetClass, symbol, interval, horizon): Promise<ForecastResult>`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/forecastService.test.ts
import { describe, it, expect } from "vitest";
import { ForecastService } from "../src/forecastService.js";
import type { KlineCache, KlinesResult } from "../src/klineCache.js";
import type { Kline } from "@coins-trend-advisor/core";
import { DISCLAIMER } from "@coins-trend-advisor/core";

function ramp(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000, open: 100 + i, high: 100 + i, low: 100 + i,
    close: 100 + i, volume: 1, closeTime: i * 1000 + 1,
  }));
}

function fakeCache(result: KlinesResult): KlineCache {
  return { getKlines: async () => result, getMany: async () => [result] } as unknown as KlineCache;
}

describe("ForecastService", () => {
  it("computes a forecast over cached klines", async () => {
    const svc = new ForecastService({ cache: fakeCache({ status: "ok", klines: ramp(60) }) });
    const r = await svc.get("crypto", "BTCPHP", "1h", 5);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.symbol).toBe("BTCPHP");
    expect(r.assetClass).toBe("crypto");
    expect(r.forecast.horizon).toBe(5);
    expect(r.forecast.disclaimer).toBe(DISCLAIMER);
  });

  it("reports insufficient_data for a short series", async () => {
    const svc = new ForecastService({ cache: fakeCache({ status: "ok", klines: ramp(10) }) });
    const r = await svc.get("crypto", "BTCPHP", "1h", 5);
    expect(r.status).toBe("insufficient_data");
  });

  it("propagates a cache error", async () => {
    const svc = new ForecastService({ cache: fakeCache({ status: "error", message: "boom" }) });
    const r = await svc.get("crypto", "BTCPHP", "1h", 5);
    expect(r.status).toBe("error");
    if (r.status !== "error") throw new Error("expected error");
    expect(r.message).toBe("boom");
  });

  it("carries stale markers through", async () => {
    const svc = new ForecastService({
      cache: fakeCache({ status: "ok", klines: ramp(60), stale: true, staleAsOf: "2020-01-01T00:00:00.000Z" }),
    });
    const r = await svc.get("crypto", "BTCPHP", "1h", 5);
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.stale).toBe(true);
    expect(r.staleAsOf).toBe("2020-01-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/forecastService.test.ts`
Expected: FAIL — cannot resolve `../src/forecastService.js`.

- [ ] **Step 3: Write `web/src/forecastService.ts`**

```ts
import { forecast, type AssetClass, type Forecast } from "@coins-trend-advisor/core";
import type { KlineCache } from "./klineCache.js";

export type ForecastResult =
  | { assetClass: AssetClass; symbol: string; status: "ok"; forecast: Forecast; stale?: boolean; staleAsOf?: string }
  | { assetClass: AssetClass; symbol: string; status: "insufficient_data" }
  | { assetClass: AssetClass; symbol: string; status: "error"; message: string };

export interface ForecastServiceDeps {
  cache: KlineCache;
}

export class ForecastService {
  constructor(private readonly deps: ForecastServiceDeps) {}

  async get(
    assetClass: AssetClass,
    symbol: string,
    interval: string,
    horizon: number,
  ): Promise<ForecastResult> {
    const klines = await this.deps.cache.getKlines(assetClass, symbol, interval);
    if (klines.status === "error") {
      return { assetClass, symbol, status: "error", message: klines.message };
    }
    const f = forecast(symbol, klines.klines, { horizon });
    if ("status" in f) {
      return { assetClass, symbol, status: "insufficient_data" };
    }
    const base = { assetClass, symbol, status: "ok" as const, forecast: f };
    return klines.stale ? { ...base, stale: true, staleAsOf: klines.staleAsOf } : base;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run test/forecastService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/forecastService.ts web/test/forecastService.test.ts
git commit -m "feat(web): add ForecastService computing forecasts over cached klines"
```

---

## Task 4: Forecast route + shared helpers + wiring (web)

Extract the asset-class/interval helpers out of `routes/signals.ts` into `routes/shared.ts` (DRY), add the forecast route, and wire `ForecastService` into `AppDeps`. After this task the whole suite and typecheck are green.

**Files:**
- Create: `web/src/routes/shared.ts`
- Modify: `web/src/routes/signals.ts`
- Create: `web/src/routes/forecast.ts`
- Modify: `web/src/server.ts`
- Modify: `web/src/index.ts`
- Test: `web/test/routes.forecast.test.ts` (create), `web/test/routes.signals.test.ts` (modify), `web/test/routes.meta.test.ts` (modify), `web/test/smoke.live.test.ts` (modify)

**Interfaces:**
- Consumes: `ForecastService`/`ForecastResult` (Task 3), `AppConfig.forecastHorizon` (Task 2), Slice 2's `AppDeps`, `KlineCache`, `SignalService`, `ProviderRegistry`.
- Produces:
  - `web/src/routes/shared.ts`: `ASSET_CLASSES`, `UPSTREAM_UNAVAILABLE_MESSAGE`, `parseAssetClass(raw: string | undefined): AssetClass`, `resolveInterval(deps: AppDeps, assetClass: AssetClass, req: Request): string`
  - Updated `interface AppDeps { config; registry; cache; signals; forecasts: ForecastService }`
  - Route `GET /api/forecast/:assetClass/:symbol` (`?horizon=N`).

- [ ] **Step 1: Create `web/src/routes/shared.ts`**

```ts
import type { Request } from "express";
import type { AssetClass } from "@coins-trend-advisor/core";
import type { AppDeps } from "../server.js";
import { ApiError } from "../errors.js";

export const ASSET_CLASSES: AssetClass[] = ["crypto", "stock"];

export const UPSTREAM_UNAVAILABLE_MESSAGE =
  "Upstream market data provider is currently unavailable";

export function parseAssetClass(raw: string | undefined): AssetClass {
  if (raw !== undefined && ASSET_CLASSES.includes(raw as AssetClass)) {
    return raw as AssetClass;
  }
  throw new ApiError(
    "invalid_asset_class",
    400,
    `asset class must be one of ${ASSET_CLASSES.join(", ")}`,
  );
}

export function resolveInterval(deps: AppDeps, assetClass: AssetClass, req: Request): string {
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
```

- [ ] **Step 2: Refactor `web/src/routes/signals.ts` to use the shared helpers**

Replace the top of the file (the imports and the local `ASSET_CLASSES`, `UPSTREAM_UNAVAILABLE_MESSAGE`, `parseAssetClass`, `resolveInterval` definitions) with:

```ts
import { Router } from "express";
import type { AppDeps } from "../server.js";
import type { SignalResult } from "../signalService.js";
import { ApiError, asyncHandler } from "../errors.js";
import {
  UPSTREAM_UNAVAILABLE_MESSAGE,
  parseAssetClass,
  resolveInterval,
} from "./shared.js";
```

Keep the rest of the file (the `sanitizeResult` function and the two route handlers) unchanged — they already call `parseAssetClass`, `resolveInterval`, and reference `UPSTREAM_UNAVAILABLE_MESSAGE`, which now come from `./shared.js`. Delete the now-duplicated `ASSET_CLASSES`/`UPSTREAM_UNAVAILABLE_MESSAGE`/`parseAssetClass`/`resolveInterval` definitions from this file.

- [ ] **Step 3: Write the failing forecast route test**

```ts
// web/test/routes.forecast.test.ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";
import { ForecastService } from "../src/forecastService.js";
import type { AppConfig } from "../src/config.js";
import type { AssetClass, Kline, MarketDataProvider } from "@coins-trend-advisor/core";
import { DISCLAIMER } from "@coins-trend-advisor/core";

function ramp(n: number): Kline[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 1000, open: 100 + i, high: 100 + i, low: 100 + i,
    close: 100 + i, volume: 1, closeTime: i * 1000 + 1,
  }));
}

function provider(assetClass: AssetClass, getKlines: MarketDataProvider["getKlines"]): MarketDataProvider {
  return {
    assetClass,
    allowedIntervals: assetClass === "crypto" ? ["1h", "4h"] : ["D", "W"],
    defaultInterval: assetClass === "crypto" ? "1h" : "D",
    getKlines, getPrice: vi.fn(), listSymbols: vi.fn(),
  };
}

function makeApp(opts: { crypto?: MarketDataProvider["getKlines"]; stockEnabled?: boolean }) {
  const crypto = provider("crypto", opts.crypto ?? (async () => ramp(60)));
  const stock = opts.stockEnabled ? provider("stock", async () => ramp(60)) : null;
  const config: AppConfig = {
    port: 3001, coinsBaseUrl: "http://example.test", finnhubBaseUrl: "http://finnhub.test",
    finnhubApiKey: opts.stockEnabled ? "fk" : undefined,
    watchlist: [{ assetClass: "crypto", symbol: "BTCPHP" }],
    signalTtlMs: 1000, cryptoInterval: "1h", stockInterval: "D", klineLimit: 200,
    apiToken: undefined, forecastHorizon: 5,
  };
  const registry = { resolve: (ac: AssetClass) => (ac === "crypto" ? crypto : ac === "stock" ? stock : null) };
  const cache = new KlineCache({ resolveProvider: (ac) => registry.resolve(ac)!, ttlMs: 1000, klineLimit: 200 });
  const signals = new SignalService({ cache });
  const forecasts = new ForecastService({ cache });
  return createApp({ config, registry, cache, signals, forecasts });
}

describe("forecast route", () => {
  it("returns a forecast for a crypto symbol", async () => {
    const res = await request(makeApp({})).get("/api/forecast/crypto/BTCPHP");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.symbol).toBe("BTCPHP");
    expect(res.body.forecast.method).toBe("holt-linear");
    expect(res.body.forecast.horizon).toBe(5);
    expect(res.body.forecast.disclaimer).toBe(DISCLAIMER);
  });

  it("honors the horizon query parameter", async () => {
    const res = await request(makeApp({})).get("/api/forecast/crypto/BTCPHP?horizon=10");
    expect(res.status).toBe(200);
    expect(res.body.forecast.horizon).toBe(10);
  });

  it("rejects a non-positive horizon with 400", async () => {
    const res = await request(makeApp({})).get("/api/forecast/crypto/BTCPHP?horizon=0");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_horizon");
  });

  it("returns 422 for insufficient data", async () => {
    const res = await request(makeApp({ crypto: async () => ramp(10) })).get("/api/forecast/crypto/BTCPHP");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("insufficient_data");
  });

  it("returns 502 with a sanitized message when upstream fails", async () => {
    const res = await request(
      makeApp({ crypto: async () => { throw new Error("Coins.ph 500 for /openapi: secret upstream body"); } }),
    ).get("/api/forecast/crypto/BTCPHP");
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("upstream_unavailable");
    expect(res.body.error.message).not.toContain("secret upstream body");
  });

  it("returns 503 stocks_disabled when no finnhub key is configured", async () => {
    const res = await request(makeApp({ stockEnabled: false })).get("/api/forecast/stock/AAPL");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("stocks_disabled");
  });
});
```

- [ ] **Step 4: Write `web/src/routes/forecast.ts`**

```ts
import { Router } from "express";
import type { AppDeps } from "../server.js";
import { ApiError, asyncHandler } from "../errors.js";
import {
  UPSTREAM_UNAVAILABLE_MESSAGE,
  parseAssetClass,
  resolveInterval,
} from "./shared.js";

function parseHorizon(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string") {
    throw new ApiError("invalid_horizon", 400, "horizon must be a single positive integer");
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError("invalid_horizon", 400, "horizon must be a positive integer");
  }
  return n;
}

export function forecastRoutes(deps: AppDeps): Router {
  const r = Router();

  r.get(
    "/forecast/:assetClass/:symbol",
    asyncHandler(async (req, res) => {
      const assetClass = parseAssetClass(req.params.assetClass);
      const interval = resolveInterval(deps, assetClass, req);
      const symbol = req.params.symbol!;
      const horizon = parseHorizon(req.query.horizon, deps.config.forecastHorizon);
      const result = await deps.forecasts.get(assetClass, symbol, interval, horizon);
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

- [ ] **Step 5: Wire the route and `ForecastService` into `web/src/server.ts`**

Add the import (with the other route imports):

```ts
import { forecastRoutes } from "./routes/forecast.js";
import type { ForecastService } from "./forecastService.js";
```

Add `forecasts` to `AppDeps`:

```ts
export interface AppDeps {
  config: AppConfig;
  registry: ProviderRegistry;
  cache: KlineCache;
  signals: SignalService;
  forecasts: ForecastService;
}
```

Mount the route after the signals route:

```ts
  app.use("/api", signalRoutes(deps));
  app.use("/api", forecastRoutes(deps));
  app.use("/api", metaRoutes(deps));
```

- [ ] **Step 6: Build `ForecastService` in `web/src/index.ts`**

Add the import:

```ts
import { ForecastService } from "./forecastService.js";
```

After `const signals = new SignalService({ cache });`, add:

```ts
const forecasts = new ForecastService({ cache });
```

Update the `createApp` call:

```ts
const app = createApp({ config, registry, cache, signals, forecasts });
```

- [ ] **Step 7: Add `forecasts` to the Slice 2 route test helpers**

In `web/test/routes.signals.test.ts`, add the import:

```ts
import { ForecastService } from "../src/forecastService.js";
```

In its `makeApp`, after `const signals = new SignalService({ cache });` add:

```ts
  const forecasts = new ForecastService({ cache });
```

and change the return to:

```ts
  return createApp({ config, registry, cache, signals, forecasts });
```

Apply the identical three edits to `web/test/routes.meta.test.ts` (its `makeApp` returns `{ app: createApp({ config, registry, cache, signals, forecasts }), listSymbols }`).

- [ ] **Step 8: Add a forecast path to the live smoke test**

In `web/test/smoke.live.test.ts`, extend `boot()` to build a `ForecastService` and pass it to `createApp` (mirror `index.ts`), then add:

```ts
  it("computes a real crypto forecast for BTCPHP", async () => {
    const res = await request(boot()).get("/api/forecast/crypto/BTCPHP");
    expect([200, 422]).toContain(res.status);
  }, 20000);
```

Specifically, update `boot()` in that file:

```ts
import { ForecastService } from "../src/forecastService.js";
// ...
    const signals = new SignalService({ cache });
    const forecasts = new ForecastService({ cache });
    return createApp({ config, registry, cache, signals, forecasts });
```

- [ ] **Step 9: Run the whole web suite + typecheck**

Run: `cd web && npx vitest run && npm run typecheck`
Expected: PASS — all suites green (config/klineCache/signalService/forecastService/providers/signals/meta/forecast/health/auth/profit), typecheck exits 0, live smoke skipped.

- [ ] **Step 10: Commit**

```bash
git add web/src/routes/shared.ts web/src/routes/signals.ts web/src/routes/forecast.ts web/src/server.ts web/src/index.ts web/test/routes.forecast.test.ts web/test/routes.signals.test.ts web/test/routes.meta.test.ts web/test/smoke.live.test.ts
git commit -m "feat(web): add /api/forecast route with shared asset-class helpers"
```

---

## Self-Review Notes

**Spec coverage:**
- Pure-TS Holt-linear forecaster + confidence band + `insufficient_data`/flat/noisy honesty → Task 1. ✅
- `FORECAST_HORIZON` config (default 5) → Task 2. ✅
- `forecast()` as a pure function over the shared `KlineCache` (single-fetch design) → Task 3. ✅
- `GET /api/forecast/:assetClass/:symbol` with horizon query, 422/502/503 + stale markers → Task 4. ✅
- Per-provider interval validation + asset-class validation reused (DRY via `shared.ts`) → Task 4. ✅
- Upstream-message sanitization on the forecast 502 → Task 4. ✅
- Live smoke covering the forecast path → Task 4. ✅

**Intentional deviation from spec:** `FORECAST_TTL_MS` is **not** implemented. The spec listed it as "defaults to signalTtlMs," but because forecast and signal share one `KlineCache` (the whole point of the Slice 2 refactor), a separate forecast TTL would require a second cache and double upstream fetches. Forecast inherits `signalTtlMs`. Flagged here for confirmation.

**Type consistency:** `Forecast`/`forecast` (core, Task 1) consumed by `ForecastService` (Task 3). `ForecastResult` (Task 3) consumed by the forecast route (Task 4). `AppConfig.forecastHorizon` (Task 2) consumed by Task 4's `parseHorizon`. `AppDeps` gains `forecasts` in Task 4, consumed by the forecast route and every test helper (updated in Steps 7–8). `shared.ts` helpers (Task 4) are consumed by both `signals.ts` and `forecast.ts`.

**Deferred (unchanged):** Postgres, scheduler, web-push, PWA, deployment, heavyweight/trained ML (the `forecast()` seam allows a later swap without touching the API).
```
