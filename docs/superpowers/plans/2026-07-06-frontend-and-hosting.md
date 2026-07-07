# Frontend + Free Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a React "full toolkit" frontend (dashboard, symbol lookup, profit calculator; both asset classes) served by the existing Express server as one deployable Node service, plus a small backend forecast-list route and concrete free-hosting docs.

**Architecture:** A new `frontend` Vite+React+TS workspace builds to `frontend/dist`, which `web`'s Express serves as static files with an SPA fallback (same-origin → no CORS, Finnhub key stays server-side). The backend gains `ForecastService.getMany` + `GET /api/forecast/:assetClass` (list) so the dashboard fetches all watchlist forecasts in one call, reusing the shared `KlineCache`. A `Dockerfile` + `DEPLOY.md` document Render (recommended) and Fly.io/Koyeb.

**Tech Stack:** TypeScript (strict, ESM), React 18 + Vite 5, Vitest + @testing-library/react (jsdom) for the frontend; Express 4 + Vitest + supertest for the backend. Node 20+.

## Global Constraints

- Packages are ESM (`"type": "module"`). Node 20+.
- `frontend` imports only **types** from `@coins-trend-advisor/core` (`Signal`, `Forecast`, `AssetClass`) — no core runtime logic runs in the browser.
- `web` gains no import dependency on `frontend`; it only reads `frontend/dist` from disk.
- All API routes stay under `/api`, JSON in/out. Error shape is always `{ error: { code, message } }`. Upstream detail is sanitized to a static message, logged server-side.
- Asset classes: `crypto` (intervals `1h`/`4h`, default `1h`) and `stock` (intervals `D`/`W`, default `D`). Absent `FINNHUB_API_KEY` → stock routes return `503 stocks_disabled`; crypto is unaffected.
- Same-origin frontend ↔ API. No CORS. No persistence beyond `localStorage` (theme + optional API token under keys `cta.theme`, `cta.apiToken`).
- Existing suites stay green: `core` 31 pass/1 skip, `web` 60 pass/3 skip. Typecheck clean in every workspace.
- Visual direction: clean data dashboard, light + dark. Semantic color reserved for buy/sell/hold. Apply the `frontend-design` skill during Task 10.

---

## File Structure

```
web/src/
  config.ts                 (modify) add optional staticDir + STATIC_DIR default
  forecastService.ts        (modify) add getMany()
  routes/forecast.ts        (modify) add GET /forecast/:assetClass list route
  server.ts                 (modify) serve frontend/dist static + SPA fallback
web/test/
  forecastService.test.ts   (modify) getMany test
  routes.forecast.test.ts   (modify) list-route tests
  static.test.ts            (create) static + SPA fallback + boots-without-dist
  fixtures/dist/index.html  (create) fixture for static test

frontend/                   (create) new workspace
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    main.tsx                React entry
    App.tsx                 shell: nav, controls, sections, footer, theme
    api.ts                  typed API client
    types.ts                view-model + client result types
    useAsync.ts             fetch lifecycle hook
    components/
      Controls.tsx          class/interval/horizon/theme/token bar
      TrendBadge.tsx        buy/sell/hold badge
      BandBar.tsx           forecast low–high band bar
      SignalForecastCard.tsx  card render (pure)
      Dashboard.tsx         watchlist grid
      Lookup.tsx            search + detail
      Profit.tsx            profit form
      StocksDisabled.tsx    friendly disabled panel
    styles.css              single stylesheet (design pass in Task 10)
    test/
      setup.ts              RTL/jsdom setup
      api.test.ts
      TrendBadge.test.tsx
      BandBar.test.tsx
      SignalForecastCard.test.tsx
      Dashboard.test.tsx
      Lookup.test.tsx
      Profit.test.tsx
  vitest.config.ts

root:
  package.json              (modify) add "frontend" workspace + build/dev scripts
  Dockerfile                (create)
  .dockerignore             (create)
  DEPLOY.md                 (create)
  README.md                 (modify) frontend + deploy sections
```

---

## Task 1: Backend — forecast list route (`ForecastService.getMany` + `GET /api/forecast/:assetClass`)

**Files:**
- Modify: `web/src/forecastService.ts`
- Modify: `web/src/routes/forecast.ts`
- Test: `web/test/forecastService.test.ts`, `web/test/routes.forecast.test.ts`

**Interfaces:**
- Consumes: `KlineCache.getMany` (exists), `forecast` (core), the shared `parseAssetClass`/`resolveInterval` (`web/src/routes/shared.js`), the local `parseHorizon` in `forecast.ts`.
- Produces:
  - `ForecastService.getMany(entries: { assetClass: AssetClass; symbol: string }[], interval: string, horizon: number): Promise<ForecastResult[]>`
  - Route `GET /api/forecast/:assetClass` → `{ assetClass, interval, horizon, results: ForecastResult[] }` (upstream errors sanitized).

- [ ] **Step 1: Write the failing `getMany` test**

Append to `web/test/forecastService.test.ts` (inside the existing `describe("ForecastService", …)` block, before its closing `});`):

```ts
  it("getMany forecasts each entry over the shared cache", async () => {
    const cache = {
      getKlines: async () => ({ status: "ok", klines: ramp(60) }),
      getMany: async (entries: { assetClass: string; symbol: string }[]) =>
        entries.map(() => ({ status: "ok", klines: ramp(60) })),
    } as unknown as KlineCache;
    const svc = new ForecastService({ cache });
    const out = await svc.getMany(
      [
        { assetClass: "crypto", symbol: "BTCPHP" },
        { assetClass: "crypto", symbol: "ETHPHP" },
      ],
      "1h",
      5,
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.status).toBe("ok");
    expect(out[0]!.symbol).toBe("BTCPHP");
    if (out[1]!.status !== "ok") throw new Error("expected ok");
    expect(out[1]!.forecast.horizon).toBe(5);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/forecastService.test.ts`
Expected: FAIL — `svc.getMany is not a function`.

- [ ] **Step 3: Add `getMany` to `web/src/forecastService.ts`**

Refactor the per-entry logic into a shared helper and add `getMany`. Replace the class body so it reads:

```ts
export class ForecastService {
  constructor(private readonly deps: ForecastServiceDeps) {}

  async get(
    assetClass: AssetClass,
    symbol: string,
    interval: string,
    horizon: number,
  ): Promise<ForecastResult> {
    const klines = await this.deps.cache.getKlines(assetClass, symbol, interval);
    return toForecast(assetClass, symbol, klines, horizon);
  }

  async getMany(
    entries: { assetClass: AssetClass; symbol: string }[],
    interval: string,
    horizon: number,
  ): Promise<ForecastResult[]> {
    const results = await this.deps.cache.getMany(entries, interval);
    return results.map((k, i) =>
      toForecast(entries[i]!.assetClass, entries[i]!.symbol, k, horizon),
    );
  }
}

function toForecast(
  assetClass: AssetClass,
  symbol: string,
  klines: KlinesResult,
  horizon: number,
): ForecastResult {
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
```

Update the import line to also bring in `KlinesResult`:

```ts
import type { KlineCache, KlinesResult } from "./klineCache.js";
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && npx vitest run test/forecastService.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing list-route tests**

In `web/test/routes.forecast.test.ts`, add these cases inside the `describe("forecast route", …)` block (before its closing `});`):

```ts
  it("GET /api/forecast/:assetClass returns a list over the watchlist", async () => {
    const res = await request(makeApp({})).get("/api/forecast/crypto");
    expect(res.status).toBe(200);
    expect(res.body.assetClass).toBe("crypto");
    expect(res.body.interval).toBe("1h");
    expect(res.body.horizon).toBe(5);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].symbol).toBe("BTCPHP");
    expect(res.body.results[0].status).toBe("ok");
    expect(res.body.results[0].forecast.method).toBe("holt-linear");
  });

  it("honors ?horizon on the list route", async () => {
    const res = await request(makeApp({})).get("/api/forecast/crypto?horizon=8");
    expect(res.status).toBe(200);
    expect(res.body.horizon).toBe(8);
    expect(res.body.results[0].forecast.horizon).toBe(8);
  });

  it("sanitizes a per-symbol upstream error in the list", async () => {
    const res = await request(
      makeApp({ crypto: async () => { throw new Error("Coins.ph 500: secret upstream body"); } }),
    ).get("/api/forecast/crypto");
    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe("error");
    expect(res.body.results[0].message).not.toContain("secret upstream body");
  });

  it("returns 503 on the stock list when stocks are disabled", async () => {
    const res = await request(makeApp({ stockEnabled: false })).get("/api/forecast/stock");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("stocks_disabled");
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd web && npx vitest run test/routes.forecast.test.ts`
Expected: FAIL — the list route returns 404 (`res.body.results` undefined).

- [ ] **Step 7: Add the list route + a `sanitizeResult` helper to `web/src/routes/forecast.ts`**

Add this helper after `parseHorizon` (mirrors the signals-list sanitizer):

```ts
import type { ForecastResult } from "../forecastService.js";

function sanitizeForecast(result: ForecastResult, interval: string): ForecastResult {
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
```

Then, inside `forecastRoutes`, register the list route **before** the `:symbol` route:

```ts
  r.get(
    "/forecast/:assetClass",
    asyncHandler(async (req, res) => {
      const assetClass = parseAssetClass(req.params.assetClass);
      const interval = resolveInterval(deps, assetClass, req);
      const horizon = parseHorizon(req.query.horizon, deps.config.forecastHorizon);
      const entries = deps.config.watchlist.filter((e) => e.assetClass === assetClass);
      const results = await deps.forecasts.getMany(entries, interval, horizon);
      res.json({
        assetClass,
        interval,
        horizon,
        results: results.map((x) => sanitizeForecast(x, interval)),
      });
    }),
  );
```

(Express matches `/forecast/crypto` to the one-segment route and `/forecast/crypto/BTCPHP` to the two-segment route regardless of registration order, but register the list first for clarity.)

- [ ] **Step 8: Run it to verify it passes + full web suite**

Run: `cd web && npx vitest run test/routes.forecast.test.ts && npx vitest run`
Expected: forecast file PASS (10 tests); whole suite PASS (64 pass / 3 skip).

- [ ] **Step 9: Typecheck + commit**

Run: `cd web && npm run typecheck`
Expected: exits 0.

```bash
git add web/src/forecastService.ts web/src/routes/forecast.ts web/test/forecastService.test.ts web/test/routes.forecast.test.ts
git commit -m "feat(web): add GET /api/forecast/:assetClass list route"
```

---

## Task 2: Backend — serve the frontend build (static + SPA fallback)

**Files:**
- Modify: `web/src/config.ts`
- Modify: `web/src/server.ts`
- Create: `web/test/static.test.ts`, `web/test/fixtures/dist/index.html`

**Interfaces:**
- Consumes: `AppConfig` (gains optional `staticDir`).
- Produces: `createApp` serves `deps.config.staticDir` (when it exists) as static files with an SPA fallback for non-`/api` GETs; when it does not exist, `/api` still works.

- [ ] **Step 1: Create the fixture**

Create `web/test/fixtures/dist/index.html`:

```html
<!doctype html><html><head><title>CTA</title></head><body><div id="root">app-shell</div></body></html>
```

- [ ] **Step 2: Write the failing static test**

Create `web/test/static.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server.js";
import { KlineCache } from "../src/klineCache.js";
import { SignalService } from "../src/signalService.js";
import { ForecastService } from "../src/forecastService.js";
import type { AppConfig } from "../src/config.js";
import type { AssetClass, MarketDataProvider } from "@coins-trend-advisor/core";

function baseConfig(staticDir?: string): AppConfig {
  return {
    port: 3001, coinsBaseUrl: "http://example.test", finnhubBaseUrl: "http://finnhub.test",
    finnhubApiKey: undefined, watchlist: [{ assetClass: "crypto", symbol: "BTCPHP" }],
    signalTtlMs: 1000, cryptoInterval: "1h", stockInterval: "D", klineLimit: 200,
    forecastHorizon: 5, apiToken: undefined, staticDir,
  };
}

function makeApp(staticDir?: string) {
  const provider: MarketDataProvider = {
    assetClass: "crypto", allowedIntervals: ["1h", "4h"], defaultInterval: "1h",
    getKlines: vi.fn(), getPrice: vi.fn(), listSymbols: vi.fn(),
  };
  const registry = { resolve: (ac: AssetClass) => (ac === "crypto" ? provider : null) };
  const cache = new KlineCache({ resolveProvider: (ac) => registry.resolve(ac)!, ttlMs: 1000, klineLimit: 200 });
  const signals = new SignalService({ cache });
  const forecasts = new ForecastService({ cache });
  return createApp({ config: baseConfig(staticDir), registry, cache, signals, forecasts });
}

const FIXTURE_DIST = fileURLToPath(new URL("./fixtures/dist", import.meta.url));

describe("static frontend serving", () => {
  it("serves index.html at / when the dist dir exists", async () => {
    const res = await request(makeApp(FIXTURE_DIST)).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("app-shell");
  });

  it("SPA-falls back to index.html for an unknown non-/api path", async () => {
    const res = await request(makeApp(FIXTURE_DIST)).get("/dashboard");
    expect(res.status).toBe(200);
    expect(res.text).toContain("app-shell");
  });

  it("still returns JSON 404 for unknown /api paths even with static enabled", async () => {
    const res = await request(makeApp(FIXTURE_DIST)).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("boots and serves /api when the dist dir is absent", async () => {
    const res = await request(makeApp(FIXTURE_DIST + "-does-not-exist")).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd web && npx vitest run test/static.test.ts`
Expected: FAIL — `staticDir` is not on `AppConfig` (type error) and `/` returns 404.

- [ ] **Step 4: Add `staticDir` to `web/src/config.ts`**

Add to the `AppConfig` interface (after `apiToken?: string;`):

```ts
  staticDir?: string;
```

Add to the object returned by `loadConfig` (after `apiToken: env.API_TOKEN || undefined,`):

```ts
    staticDir:
      env.STATIC_DIR ||
      fileURLToPath(new URL("../../frontend/dist", import.meta.url)),
```

Add the import at the top of `config.ts`:

```ts
import { fileURLToPath } from "node:url";
```

- [ ] **Step 5: Serve static + SPA fallback in `web/src/server.ts`**

Add imports at the top:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
```

In `createApp`, replace the block:

```ts
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found" } });
  });
  app.use(errorMiddleware);
  return app;
```

with:

```ts
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Not found" } });
  });

  // Serve the built frontend when present. Absent (pure-API deploy) → skip.
  const staticDir = deps.config.staticDir;
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(join(staticDir, "index.html"));
    });
  }

  app.use(errorMiddleware);
  return app;
```

- [ ] **Step 6: Run it to verify it passes + full web suite**

Run: `cd web && npx vitest run test/static.test.ts && npx vitest run && npm run typecheck`
Expected: static PASS (4 tests); whole suite PASS (68 pass / 3 skip); typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add web/src/config.ts web/src/server.ts web/test/static.test.ts web/test/fixtures/dist/index.html
git commit -m "feat(web): serve built frontend as static files with SPA fallback"
```

---

## Task 3: Scaffold the `frontend` workspace

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/vitest.config.ts`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/styles.css`, `frontend/src/test/setup.ts`, `frontend/src/test/smoke.test.tsx`
- Modify: root `package.json`

**Interfaces:**
- Produces: a buildable/testable React workspace; `App` (placeholder shell, filled in later tasks); root `build`/`dev` scripts.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "@coins-trend-advisor/frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@coins-trend-advisor/core": "*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": { "@coins-trend-advisor/core": ["../core/src/index.ts"] },
    "types": ["node", "vitest/globals", "@testing-library/jest-dom"],
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `frontend/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@coins-trend-advisor/core": fileURLToPath(
        new URL("../core/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
  build: { outDir: "dist" },
});
```

- [ ] **Step 4: Create `frontend/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@coins-trend-advisor/core": fileURLToPath(
        new URL("../core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 5: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Coins Trend Advisor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `frontend/src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 7: Create `frontend/src/styles.css`**

```css
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
```

- [ ] **Step 8: Create `frontend/src/App.tsx` (placeholder shell — expanded in Task 10)**

```tsx
export function App() {
  return <main><h1>Coins Trend Advisor</h1></main>;
}
```

- [ ] **Step 9: Create `frontend/src/main.tsx`**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 10: Create `frontend/src/test/smoke.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "../App.js";

it("renders the app title", () => {
  render(<App />);
  expect(screen.getByText("Coins Trend Advisor")).toBeInTheDocument();
});
```

- [ ] **Step 11: Add the workspace + scripts to root `package.json`**

Replace root `package.json` with:

```json
{
  "name": "coins-trend-advisor",
  "version": "0.0.0",
  "private": true,
  "workspaces": ["core", "web", "frontend"],
  "scripts": {
    "build": "npm run build -w core && npm run build -w frontend",
    "dev": "npm run dev -w web & npm run dev -w frontend",
    "test": "npm run test -w core && npm run test -w web && npm run test -w frontend",
    "typecheck": "npm run typecheck -w core && npm run typecheck -w web && npm run typecheck -w frontend"
  }
}
```

- [ ] **Step 12: Install, build, test**

Run from repo root:
```bash
npm install
npm run build -w core
npx vitest run --root frontend
cd frontend && npx tsc --noEmit && npx vite build
```
Expected: install succeeds; smoke test PASS (1 test); typecheck exits 0; `vite build` emits `frontend/dist/index.html`.

- [ ] **Step 13: Commit**

```bash
git add frontend package.json package-lock.json
git commit -m "chore(frontend): scaffold Vite + React + TS workspace"
```

---

## Task 4: API client (`api.ts` + `types.ts`)

**Files:**
- Create: `frontend/src/types.ts`, `frontend/src/api.ts`, `frontend/src/test/api.test.ts`

**Interfaces:**
- Consumes: core types `Signal`, `Forecast`, `AssetClass`.
- Produces (in `types.ts`):
  - `type ApiError = { code: string; message: string }`
  - `type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }`
  - `interface SignalItem { assetClass: AssetClass; symbol: string; status: "ok" | "insufficient_data" | "error"; signal?: Signal; message?: string; stale?: boolean; staleAsOf?: string }`
  - `interface ForecastItem { assetClass: AssetClass; symbol: string; status: "ok" | "insufficient_data" | "error"; forecast?: Forecast; message?: string; stale?: boolean; staleAsOf?: string }`
  - `interface WatchlistEntry { assetClass: AssetClass; symbol: string }`
  - `interface ProfitResult { grossProfit: number; netProfit: number; roiPct: number; fees: number }` (shape mirrors core's `calculateProfit`; treat as opaque record in the UI)
- Produces (in `api.ts`): `setApiToken`, `getWatchlist`, `getSignals`, `getForecasts`, `getSignal`, `getForecast`, `getPairs`, `postProfit` — all returning `Promise<ApiResult<…>>`.

- [ ] **Step 1: Create `frontend/src/types.ts`**

```ts
import type { AssetClass, Signal, Forecast } from "@coins-trend-advisor/core";

export type { AssetClass, Signal, Forecast };

export interface ApiError {
  code: string;
  message: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface WatchlistEntry {
  assetClass: AssetClass;
  symbol: string;
}

export interface SignalItem {
  assetClass: AssetClass;
  symbol: string;
  status: "ok" | "insufficient_data" | "error";
  signal?: Signal;
  message?: string;
  stale?: boolean;
  staleAsOf?: string;
}

export interface ForecastItem {
  assetClass: AssetClass;
  symbol: string;
  status: "ok" | "insufficient_data" | "error";
  forecast?: Forecast;
  message?: string;
  stale?: boolean;
  staleAsOf?: string;
}

export type ProfitResult = Record<string, number>;
```

- [ ] **Step 2: Write the failing API-client test**

Create `frontend/src/test/api.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as api from "../api.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  api.setApiToken(null);
  vi.restoreAllMocks();
});

describe("api client", () => {
  it("getSignals returns ok data on 200", async () => {
    const body = { assetClass: "crypto", interval: "1h", results: [{ assetClass: "crypto", symbol: "BTCPHP", status: "ok" }] };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(body)));
    const r = await api.getSignals("crypto", "1h");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.results[0]!.symbol).toBe("BTCPHP");
  });

  it("normalizes a 503 stocks_disabled into an error result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { code: "stocks_disabled", message: "off" } }, 503)));
    const r = await api.getSignals("stock", "D");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected error");
    expect(r.error.code).toBe("stocks_disabled");
  });

  it("normalizes a network throw into an error result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    const r = await api.getWatchlist();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected error");
    expect(r.error.code).toBe("network_error");
  });

  it("attaches a bearer token when set", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ entries: [] }));
    vi.stubGlobal("fetch", fetchMock);
    api.setApiToken("secret");
    await api.getWatchlist();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret");
  });

  it("builds the forecast list URL with interval and horizon", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ assetClass: "crypto", interval: "4h", horizon: 8, results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await api.getForecasts("crypto", "4h", 8);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/forecast/crypto?interval=4h&horizon=8");
  });

  it("posts profit as JSON", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ netProfit: 10 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await api.postProfit({ entryPrice: 1, targetPrice: 2, positionSize: 3, feePct: 0.1 });
    expect(r.ok).toBe(true);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)).entryPrice).toBe(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/test/api.test.ts`
Expected: FAIL — cannot resolve `../api.js`.

- [ ] **Step 4: Create `frontend/src/api.ts`**

```ts
import type {
  ApiResult,
  AssetClass,
  ForecastItem,
  ProfitResult,
  SignalItem,
  WatchlistEntry,
} from "./types.js";

let apiToken: string | null = null;
export function setApiToken(token: string | null): void {
  apiToken = token;
}

interface SignalsResponse { assetClass: AssetClass; interval: string; results: SignalItem[] }
interface ForecastsResponse { assetClass: AssetClass; interval: string; horizon: number; results: ForecastItem[] }
interface WatchlistResponse { entries: WatchlistEntry[] }
interface PairsResponse { assetClass: AssetClass; symbols: string[] }

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
    if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;
    const res = await fetch(url, { ...init, headers });
    const body = (await res.json()) as unknown;
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } }).error;
      return {
        ok: false,
        error: { code: err?.code ?? "http_error", message: err?.message ?? `HTTP ${res.status}` },
      };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: { code: "network_error", message: "Could not reach the server" } };
  }
}

export function getWatchlist(): Promise<ApiResult<WatchlistResponse>> {
  return request("/api/watchlist");
}

export function getSignals(assetClass: AssetClass, interval: string): Promise<ApiResult<SignalsResponse>> {
  return request(`/api/signals/${assetClass}?interval=${encodeURIComponent(interval)}`);
}

export function getForecasts(
  assetClass: AssetClass,
  interval: string,
  horizon: number,
): Promise<ApiResult<ForecastsResponse>> {
  return request(`/api/forecast/${assetClass}?interval=${encodeURIComponent(interval)}&horizon=${horizon}`);
}

export function getSignal(assetClass: AssetClass, symbol: string, interval: string): Promise<ApiResult<SignalItem>> {
  return request(`/api/signals/${assetClass}/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}`);
}

export function getForecast(
  assetClass: AssetClass,
  symbol: string,
  interval: string,
  horizon: number,
): Promise<ApiResult<ForecastItem>> {
  return request(
    `/api/forecast/${assetClass}/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&horizon=${horizon}`,
  );
}

export function getPairs(assetClass: AssetClass): Promise<ApiResult<PairsResponse>> {
  return request(`/api/pairs/${assetClass}`);
}

export function postProfit(body: {
  entryPrice: number;
  targetPrice: number;
  positionSize: number;
  feePct: number;
}): Promise<ApiResult<ProfitResult>> {
  return request("/api/profit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/test/api.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: exits 0.

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/test/api.test.ts
git commit -m "feat(frontend): typed API client with error normalization and token"
```

---

## Task 5: `useAsync` hook + presentational primitives (`TrendBadge`, `BandBar`)

**Files:**
- Create: `frontend/src/useAsync.ts`, `frontend/src/components/TrendBadge.tsx`, `frontend/src/components/BandBar.tsx`
- Test: `frontend/src/test/TrendBadge.test.tsx`, `frontend/src/test/BandBar.test.tsx`

**Interfaces:**
- Produces:
  - `useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { loading: boolean; data: T | null; error: string | null; reload: () => void }`
  - `TrendBadge({ trend }: { trend: "buy" | "sell" | "hold" | string })` → a `<span>` with `data-trend` and readable label.
  - `BandBar({ lower, predicted, upper }: { lower: number; predicted: number; upper: number })` → a labelled band with `role="img"` and an `aria-label`.

- [ ] **Step 1: Write the failing primitive tests**

Create `frontend/src/test/TrendBadge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { TrendBadge } from "../components/TrendBadge.js";

it("labels a buy trend and tags it for styling", () => {
  render(<TrendBadge trend="buy" />);
  const el = screen.getByText(/buy/i);
  expect(el).toHaveAttribute("data-trend", "buy");
});

it("renders an unknown trend as hold", () => {
  render(<TrendBadge trend="whatever" />);
  expect(screen.getByText(/hold/i)).toHaveAttribute("data-trend", "hold");
});
```

Create `frontend/src/test/BandBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { BandBar } from "../components/BandBar.js";

it("describes the band range for screen readers", () => {
  render(<BandBar lower={90} predicted={100} upper={110} />);
  const el = screen.getByRole("img");
  expect(el.getAttribute("aria-label")).toContain("90");
  expect(el.getAttribute("aria-label")).toContain("110");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/test/TrendBadge.test.tsx src/test/BandBar.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `frontend/src/useAsync.ts`**

```ts
import { useCallback, useEffect, useState } from "react";

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { loading, data, error, reload };
}
```

- [ ] **Step 4: Create `frontend/src/components/TrendBadge.tsx`**

```tsx
const KNOWN = new Set(["buy", "sell", "hold"]);

export function TrendBadge({ trend }: { trend: string }) {
  const t = KNOWN.has(trend) ? trend : "hold";
  const label = t === "buy" ? "Buy" : t === "sell" ? "Sell" : "Hold";
  return (
    <span className="trend-badge" data-trend={t}>
      {label}
    </span>
  );
}
```

- [ ] **Step 5: Create `frontend/src/components/BandBar.tsx`**

```tsx
export function BandBar({ lower, predicted, upper }: { lower: number; predicted: number; upper: number }) {
  const span = upper - lower || 1;
  const mid = ((predicted - lower) / span) * 100;
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div
      className="band-bar"
      role="img"
      aria-label={`Forecast ${fmt(predicted)}, range ${fmt(lower)} to ${fmt(upper)}`}
    >
      <div className="band-bar-track">
        <div className="band-bar-marker" style={{ left: `${Math.max(0, Math.min(100, mid))}%` }} />
      </div>
      <div className="band-bar-ends">
        <span>{fmt(lower)}</span>
        <span>{fmt(upper)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `cd frontend && npx vitest run src/test/TrendBadge.test.tsx src/test/BandBar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/useAsync.ts frontend/src/components/TrendBadge.tsx frontend/src/components/BandBar.tsx frontend/src/test/TrendBadge.test.tsx frontend/src/test/BandBar.test.tsx
git commit -m "feat(frontend): useAsync hook + TrendBadge/BandBar primitives"
```

---

## Task 6: `SignalForecastCard` (pure render)

**Files:**
- Create: `frontend/src/components/SignalForecastCard.tsx`
- Test: `frontend/src/test/SignalForecastCard.test.tsx`

**Interfaces:**
- Consumes: `SignalItem`, `ForecastItem` (`types.ts`); `TrendBadge`, `BandBar`.
- Produces: `SignalForecastCard({ symbol, signal, forecast }: { symbol: string; signal?: SignalItem; forecast?: ForecastItem })` — a pure card. No fetching.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/SignalForecastCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { SignalForecastCard } from "../components/SignalForecastCard.js";
import type { SignalItem, ForecastItem } from "../types.js";

const okSignal: SignalItem = {
  assetClass: "crypto", symbol: "BTCPHP", status: "ok",
  signal: {
    pair: "BTCPHP", trend: "buy", confidence: 0.7,
    reasoning: "EMA up", indicators: { rsi: 55, emaCrossover: "bullish", macd: 1, bollinger: "mid" },
    asOf: "2026-07-06T00:00:00.000Z", disclaimer: "d",
  } as unknown as SignalItem["signal"],
};

const okForecast: ForecastItem = {
  assetClass: "crypto", symbol: "BTCPHP", status: "ok",
  forecast: {
    symbol: "BTCPHP", horizon: 5, predicted: 100, lower: 90, upper: 110,
    method: "holt-linear", asOf: "2026-07-06T00:00:00.000Z", disclaimer: "d",
  },
};

it("renders symbol, trend, and forecast band", () => {
  render(<SignalForecastCard symbol="BTCPHP" signal={okSignal} forecast={okForecast} />);
  expect(screen.getByText("BTCPHP")).toBeInTheDocument();
  expect(screen.getByText(/buy/i)).toHaveAttribute("data-trend", "buy");
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain("110");
});

it("shows an insufficient-data note when the signal is short", () => {
  render(<SignalForecastCard symbol="XRPPHP" signal={{ assetClass: "crypto", symbol: "XRPPHP", status: "insufficient_data" }} />);
  expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
});

it("shows a stale marker", () => {
  render(<SignalForecastCard symbol="BTCPHP" signal={{ ...okSignal, stale: true, staleAsOf: "2026-07-06T00:00:00.000Z" }} forecast={okForecast} />);
  expect(screen.getByText(/stale/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/test/SignalForecastCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/components/SignalForecastCard.tsx`**

```tsx
import type { SignalItem, ForecastItem } from "../types.js";
import { TrendBadge } from "./TrendBadge.js";
import { BandBar } from "./BandBar.js";

export function SignalForecastCard({
  symbol,
  signal,
  forecast,
}: {
  symbol: string;
  signal?: SignalItem;
  forecast?: ForecastItem;
}) {
  const stale = signal?.stale || forecast?.stale;
  const insufficient =
    signal?.status === "insufficient_data" || forecast?.status === "insufficient_data";
  return (
    <article className="card">
      <header className="card-head">
        <h3>{symbol}</h3>
        {signal?.status === "ok" && signal.signal && <TrendBadge trend={signal.signal.trend} />}
        {stale && <span className="stale-tag">stale</span>}
      </header>

      {signal?.status === "ok" && signal.signal && (
        <dl className="indicators">
          <div><dt>Confidence</dt><dd>{Math.round(signal.signal.confidence * 100)}%</dd></div>
          <div><dt>RSI</dt><dd>{signal.signal.indicators.rsi.toFixed(1)}</dd></div>
          <div><dt>EMA</dt><dd>{signal.signal.indicators.emaCrossover}</dd></div>
          <div><dt>Bollinger</dt><dd>{signal.signal.indicators.bollinger}</dd></div>
        </dl>
      )}

      {forecast?.status === "ok" && forecast.forecast && (
        <div className="forecast">
          <div className="forecast-value">
            → {forecast.forecast.predicted.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            <span className="forecast-h"> (h={forecast.forecast.horizon})</span>
          </div>
          <BandBar
            lower={forecast.forecast.lower}
            predicted={forecast.forecast.predicted}
            upper={forecast.forecast.upper}
          />
        </div>
      )}

      {insufficient && <p className="note">Not enough data yet for a reading.</p>}
      {(signal?.status === "error" || forecast?.status === "error") && (
        <p className="note error">Upstream data is currently unavailable.</p>
      )}
    </article>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/test/SignalForecastCard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: exits 0.

```bash
git add frontend/src/components/SignalForecastCard.tsx frontend/src/test/SignalForecastCard.test.tsx
git commit -m "feat(frontend): SignalForecastCard pure render"
```

---

## Task 7: `Dashboard` (watchlist grid, merges signals + forecasts)

**Files:**
- Create: `frontend/src/components/Dashboard.tsx`, `frontend/src/components/StocksDisabled.tsx`
- Test: `frontend/src/test/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `getSignals`, `getForecasts` (`api.ts`); `SignalForecastCard`; `useAsync`; `SignalItem`/`ForecastItem`.
- Produces: `Dashboard({ assetClass, interval, horizon }: { assetClass: AssetClass; interval: string; horizon: number })`; `StocksDisabled()`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/Dashboard.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { Dashboard } from "../components/Dashboard.js";
import * as api from "../api.js";

const sig = (symbol: string) => ({
  assetClass: "crypto" as const, symbol, status: "ok" as const,
  signal: { pair: symbol, trend: "buy", confidence: 0.6, reasoning: "", indicators: { rsi: 50, emaCrossover: "bullish", macd: 1, bollinger: "mid" }, asOf: "", disclaimer: "" } as any,
});
const fc = (symbol: string) => ({
  assetClass: "crypto" as const, symbol, status: "ok" as const,
  forecast: { symbol, horizon: 5, predicted: 100, lower: 90, upper: 110, method: "holt-linear" as const, asOf: "", disclaimer: "" },
});

it("renders a card per watchlist symbol, merged by symbol", async () => {
  vi.spyOn(api, "getSignals").mockResolvedValue({ ok: true, data: { assetClass: "crypto", interval: "1h", results: [sig("BTCPHP"), sig("ETHPHP")] } });
  vi.spyOn(api, "getForecasts").mockResolvedValue({ ok: true, data: { assetClass: "crypto", interval: "1h", horizon: 5, results: [fc("BTCPHP"), fc("ETHPHP")] } });
  render(<Dashboard assetClass="crypto" interval="1h" horizon={5} />);
  await waitFor(() => expect(screen.getByText("BTCPHP")).toBeInTheDocument());
  expect(screen.getByText("ETHPHP")).toBeInTheDocument();
});

it("shows the stocks-disabled panel on a 503", async () => {
  vi.spyOn(api, "getSignals").mockResolvedValue({ ok: false, error: { code: "stocks_disabled", message: "off" } });
  vi.spyOn(api, "getForecasts").mockResolvedValue({ ok: false, error: { code: "stocks_disabled", message: "off" } });
  render(<Dashboard assetClass="stock" interval="D" horizon={5} />);
  await waitFor(() => expect(screen.getByText(/stocks aren't configured/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/test/Dashboard.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `frontend/src/components/StocksDisabled.tsx`**

```tsx
export function StocksDisabled() {
  return (
    <div className="panel">
      <p>Stocks aren't configured on this server.</p>
      <p className="muted">Set a <code>FINNHUB_API_KEY</code> to enable stock signals and forecasts.</p>
    </div>
  );
}
```

- [ ] **Step 4: Create `frontend/src/components/Dashboard.tsx`**

```tsx
import { useCallback } from "react";
import type { AssetClass, SignalItem, ForecastItem } from "../types.js";
import { getSignals, getForecasts } from "../api.js";
import { useAsync } from "../useAsync.js";
import { SignalForecastCard } from "./SignalForecastCard.js";
import { StocksDisabled } from "./StocksDisabled.js";

interface Row { symbol: string; signal?: SignalItem; forecast?: ForecastItem }

export function Dashboard({
  assetClass,
  interval,
  horizon,
}: {
  assetClass: AssetClass;
  interval: string;
  horizon: number;
}) {
  const load = useCallback(async () => {
    const [s, f] = await Promise.all([
      getSignals(assetClass, interval),
      getForecasts(assetClass, interval, horizon),
    ]);
    if (!s.ok) return { disabled: s.error.code === "stocks_disabled", error: s.error.message, rows: [] as Row[] };
    const bySymbol = new Map<string, Row>();
    for (const item of s.data.results) bySymbol.set(item.symbol, { symbol: item.symbol, signal: item });
    if (f.ok) {
      for (const item of f.data.results) {
        const row = bySymbol.get(item.symbol) ?? { symbol: item.symbol };
        row.forecast = item;
        bySymbol.set(item.symbol, row);
      }
    }
    return { disabled: false, error: null as string | null, rows: [...bySymbol.values()] };
  }, [assetClass, interval, horizon]);

  const { loading, data, error } = useAsync(load, [assetClass, interval, horizon]);

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="note error">{error}</p>;
  if (!data) return null;
  if (data.disabled) return <StocksDisabled />;
  if (data.error) return <p className="note error">{data.error}</p>;

  return (
    <section className="grid">
      {data.rows.map((row) => (
        <SignalForecastCard key={row.symbol} symbol={row.symbol} signal={row.signal} forecast={row.forecast} />
      ))}
    </section>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/test/Dashboard.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: exits 0.

```bash
git add frontend/src/components/Dashboard.tsx frontend/src/components/StocksDisabled.tsx frontend/src/test/Dashboard.test.tsx
git commit -m "feat(frontend): Dashboard grid merging signals + forecasts"
```

---

## Task 8: `Lookup` (search + detail card)

**Files:**
- Create: `frontend/src/components/Lookup.tsx`
- Test: `frontend/src/test/Lookup.test.tsx`

**Interfaces:**
- Consumes: `getSignal`, `getForecast`, `getPairs` (`api.ts`); `SignalForecastCard`.
- Produces: `Lookup({ assetClass, interval, horizon }: { assetClass: AssetClass; interval: string; horizon: number })`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/Lookup.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { Lookup } from "../components/Lookup.js";
import * as api from "../api.js";

it("looks up a symbol and shows its card", async () => {
  vi.spyOn(api, "getPairs").mockResolvedValue({ ok: true, data: { assetClass: "crypto", symbols: ["BTCPHP"] } });
  vi.spyOn(api, "getSignal").mockResolvedValue({
    ok: true,
    data: { assetClass: "crypto", symbol: "BTCPHP", status: "ok",
      signal: { pair: "BTCPHP", trend: "hold", confidence: 0.5, reasoning: "", indicators: { rsi: 50, emaCrossover: "bullish", macd: 1, bollinger: "mid" }, asOf: "", disclaimer: "" } as any },
  });
  vi.spyOn(api, "getForecast").mockResolvedValue({
    ok: true,
    data: { assetClass: "crypto", symbol: "BTCPHP", status: "ok",
      forecast: { symbol: "BTCPHP", horizon: 5, predicted: 100, lower: 90, upper: 110, method: "holt-linear", asOf: "", disclaimer: "" } },
  });
  render(<Lookup assetClass="crypto" interval="1h" horizon={5} />);
  await userEvent.type(screen.getByLabelText(/symbol/i), "BTCPHP");
  await userEvent.click(screen.getByRole("button", { name: /look up/i }));
  await waitFor(() => expect(screen.getByText("BTCPHP")).toBeInTheDocument());
  expect(screen.getByText(/hold/i)).toHaveAttribute("data-trend", "hold");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/test/Lookup.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/components/Lookup.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { AssetClass, SignalItem, ForecastItem } from "../types.js";
import { getSignal, getForecast, getPairs } from "../api.js";
import { SignalForecastCard } from "./SignalForecastCard.js";

export function Lookup({
  assetClass,
  interval,
  horizon,
}: {
  assetClass: AssetClass;
  interval: string;
  horizon: number;
}) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ symbol: string; signal?: SignalItem; forecast?: ForecastItem } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPairs(assetClass).then((r) => { if (!cancelled && r.ok) setSymbols(r.data.symbols); });
    return () => { cancelled = true; };
  }, [assetClass]);

  async function onLookup(e: React.FormEvent) {
    e.preventDefault();
    const symbol = query.trim().toUpperCase();
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const [s, f] = await Promise.all([
      getSignal(assetClass, symbol, interval),
      getForecast(assetClass, symbol, interval, horizon),
    ]);
    setLoading(false);
    if (!s.ok) { setError(s.error.code === "stocks_disabled" ? "Stocks aren't configured on this server." : s.error.message); return; }
    setResult({ symbol, signal: s.data, forecast: f.ok ? f.data : undefined });
  }

  return (
    <section className="lookup">
      <form className="lookup-form" onSubmit={onLookup}>
        <label htmlFor="lookup-symbol">Symbol</label>
        <input
          id="lookup-symbol" list="lookup-symbols" value={query}
          onChange={(e) => setQuery(e.target.value)} placeholder="e.g. BTCPHP" autoComplete="off"
        />
        <datalist id="lookup-symbols">
          {symbols.slice(0, 50).map((s) => <option key={s} value={s} />)}
        </datalist>
        <button type="submit">Look up</button>
      </form>
      {loading && <p className="muted">Looking up…</p>}
      {error && <p className="note error">{error}</p>}
      {result && <SignalForecastCard symbol={result.symbol} signal={result.signal} forecast={result.forecast} />}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/test/Lookup.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: exits 0.

```bash
git add frontend/src/components/Lookup.tsx frontend/src/test/Lookup.test.tsx
git commit -m "feat(frontend): Lookup section with symbol autocomplete"
```

---

## Task 9: `Profit` (calculator form)

**Files:**
- Create: `frontend/src/components/Profit.tsx`
- Test: `frontend/src/test/Profit.test.tsx`

**Interfaces:**
- Consumes: `postProfit` (`api.ts`).
- Produces: `Profit()`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/Profit.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { Profit } from "../components/Profit.js";
import * as api from "../api.js";

it("submits the form and shows the returned result", async () => {
  const spy = vi.spyOn(api, "postProfit").mockResolvedValue({ ok: true, data: { netProfit: 42, roiPct: 4.2 } });
  render(<Profit />);
  await userEvent.type(screen.getByLabelText(/entry price/i), "100");
  await userEvent.type(screen.getByLabelText(/target price/i), "110");
  await userEvent.type(screen.getByLabelText(/position size/i), "10");
  await userEvent.type(screen.getByLabelText(/fee/i), "0.1");
  await userEvent.click(screen.getByRole("button", { name: /calculate/i }));
  await waitFor(() => expect(screen.getByText(/netProfit/i)).toBeInTheDocument());
  expect(spy).toHaveBeenCalledWith({ entryPrice: 100, targetPrice: 110, positionSize: 10, feePct: 0.1 });
});

it("shows the server validation message on a 400", async () => {
  vi.spyOn(api, "postProfit").mockResolvedValue({ ok: false, error: { code: "invalid_input", message: "entryPrice must be a finite number" } });
  render(<Profit />);
  await userEvent.type(screen.getByLabelText(/entry price/i), "1");
  await userEvent.type(screen.getByLabelText(/target price/i), "2");
  await userEvent.type(screen.getByLabelText(/position size/i), "3");
  await userEvent.type(screen.getByLabelText(/fee/i), "0");
  await userEvent.click(screen.getByRole("button", { name: /calculate/i }));
  await waitFor(() => expect(screen.getByText(/must be a finite number/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/test/Profit.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/components/Profit.tsx`**

```tsx
import { useState } from "react";
import type { ProfitResult } from "../types.js";
import { postProfit } from "../api.js";

const FIELDS = [
  { key: "entryPrice", label: "Entry price" },
  { key: "targetPrice", label: "Target price" },
  { key: "positionSize", label: "Position size" },
  { key: "feePct", label: "Fee %" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export function Profit() {
  const [values, setValues] = useState<Record<FieldKey, string>>({
    entryPrice: "", targetPrice: "", positionSize: "", feePct: "",
  });
  const [result, setResult] = useState<ProfitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const body = {
      entryPrice: Number(values.entryPrice),
      targetPrice: Number(values.targetPrice),
      positionSize: Number(values.positionSize),
      feePct: Number(values.feePct),
    };
    const r = await postProfit(body);
    if (r.ok) setResult(r.data);
    else setError(r.error.message);
  }

  return (
    <section className="profit">
      <form className="profit-form" onSubmit={onSubmit}>
        {FIELDS.map((f) => (
          <div key={f.key} className="field">
            <label htmlFor={`profit-${f.key}`}>{f.label}</label>
            <input
              id={`profit-${f.key}`} inputMode="decimal" value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <button type="submit">Calculate</button>
      </form>
      {error && <p className="note error">{error}</p>}
      {result && (
        <dl className="profit-result">
          {Object.entries(result).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v)}</dd></div>
          ))}
        </dl>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/test/Profit.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: exits 0.

```bash
git add frontend/src/components/Profit.tsx frontend/src/test/Profit.test.tsx
git commit -m "feat(frontend): Profit calculator form"
```

---

## Task 10: App shell — controls, section nav, theme, styling pass

This wires everything into `App.tsx` + `Controls.tsx`, applies the visual design, and produces a full green build.

**REQUIRED SUB-SKILL for this task's styling:** apply `frontend-design` for the clean-data-dashboard look (typography scale, neutral surfaces in light + dark, semantic buy/sell/hold colors, spacing) when writing `styles.css`.

**Files:**
- Create: `frontend/src/components/Controls.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/styles.css`
- Test: extend `frontend/src/test/smoke.test.tsx`

**Interfaces:**
- Consumes: `Dashboard`, `Lookup`, `Profit` sections; `setApiToken`.
- Produces: `Controls({ … })` (class/interval/horizon/theme/token) and the assembled `App`.

- [ ] **Step 1: Create `frontend/src/components/Controls.tsx`**

```tsx
import type { AssetClass } from "../types.js";

const INTERVALS: Record<AssetClass, string[]> = { crypto: ["1h", "4h"], stock: ["D", "W"] };

export interface ControlsState {
  assetClass: AssetClass;
  interval: string;
  horizon: number;
  theme: "light" | "dark";
  token: string;
}

export function Controls({
  state,
  onChange,
}: {
  state: ControlsState;
  onChange: (patch: Partial<ControlsState>) => void;
}) {
  return (
    <div className="controls">
      <div className="control">
        <span className="control-label">Asset</span>
        {(["crypto", "stock"] as AssetClass[]).map((ac) => (
          <button key={ac} className="seg" aria-pressed={state.assetClass === ac}
            onClick={() => onChange({ assetClass: ac, interval: INTERVALS[ac][0]! })}>{ac}</button>
        ))}
      </div>
      <div className="control">
        <span className="control-label">Interval</span>
        {INTERVALS[state.assetClass].map((iv) => (
          <button key={iv} className="seg" aria-pressed={state.interval === iv}
            onClick={() => onChange({ interval: iv })}>{iv}</button>
        ))}
      </div>
      <div className="control">
        <label className="control-label" htmlFor="horizon">Horizon</label>
        <input id="horizon" type="number" min={1} value={state.horizon}
          onChange={(e) => onChange({ horizon: Math.max(1, Number(e.target.value) || 1) })} />
      </div>
      <div className="control">
        <button className="seg" onClick={() => onChange({ theme: state.theme === "dark" ? "light" : "dark" })}>
          {state.theme === "dark" ? "☾" : "☀"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `frontend/src/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { AssetClass } from "./types.js";
import { setApiToken } from "./api.js";
import { Controls, type ControlsState } from "./components/Controls.js";
import { Dashboard } from "./components/Dashboard.js";
import { Lookup } from "./components/Lookup.js";
import { Profit } from "./components/Profit.js";

type Section = "dashboard" | "lookup" | "profit";

const DEFAULT_INTERVAL: Record<AssetClass, string> = { crypto: "1h", stock: "D" };

export function App() {
  const [section, setSection] = useState<Section>("dashboard");
  const [state, setState] = useState<ControlsState>(() => ({
    assetClass: "crypto",
    interval: DEFAULT_INTERVAL.crypto,
    horizon: 5,
    theme: (localStorage.getItem("cta.theme") as "light" | "dark") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    token: localStorage.getItem("cta.apiToken") ?? "",
  }));

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    localStorage.setItem("cta.theme", state.theme);
  }, [state.theme]);

  useEffect(() => {
    localStorage.setItem("cta.apiToken", state.token);
    setApiToken(state.token || null);
  }, [state.token]);

  const patch = (p: Partial<ControlsState>) => setState((s) => ({ ...s, ...p }));

  return (
    <div className="app">
      <header className="app-header">
        <h1>Coins Trend Advisor</h1>
        <nav className="tabs">
          {(["dashboard", "lookup", "profit"] as Section[]).map((s) => (
            <button key={s} className="tab" aria-pressed={section === s} onClick={() => setSection(s)}>{s}</button>
          ))}
        </nav>
      </header>

      <Controls state={state} onChange={patch} />

      <main className="content">
        {section === "dashboard" && <Dashboard assetClass={state.assetClass} interval={state.interval} horizon={state.horizon} />}
        {section === "lookup" && <Lookup assetClass={state.assetClass} interval={state.interval} horizon={state.horizon} />}
        {section === "profit" && <Profit />}
      </main>

      <footer className="app-footer">
        <p className="muted">Technical-indicator-based estimates, not financial advice.</p>
      </footer>
    </div>
  );
}
```

- [ ] **Step 3: Extend the smoke test**

Replace `frontend/src/test/smoke.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { App } from "../App.js";
import * as api from "../api.js";

it("renders the shell with nav tabs", () => {
  vi.spyOn(api, "getSignals").mockResolvedValue({ ok: true, data: { assetClass: "crypto", interval: "1h", results: [] } });
  vi.spyOn(api, "getForecasts").mockResolvedValue({ ok: true, data: { assetClass: "crypto", interval: "1h", horizon: 5, results: [] } });
  render(<App />);
  expect(screen.getByText("Coins Trend Advisor")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "dashboard" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "lookup" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "profit" })).toBeInTheDocument();
});
```

- [ ] **Step 4: Write `frontend/src/styles.css` (apply frontend-design skill)**

Apply the `frontend-design` skill to produce the clean-data-dashboard stylesheet: a neutral surface palette with light + dark via `:root[data-theme="dark"]`, a single accent, semantic colors bound to `.trend-badge[data-trend="buy|sell|hold"]`, a type scale, card/grid/controls/tabs/forms layout, and the `.band-bar` styling. It must style every className used by the components (`app`, `app-header`, `tabs`, `tab`, `controls`, `control`, `seg`, `content`, `grid`, `card`, `card-head`, `trend-badge`, `stale-tag`, `indicators`, `forecast`, `band-bar*`, `lookup*`, `profit*`, `panel`, `note`, `muted`, `field`, `app-footer`). Keep it a single hand-written stylesheet — no CSS framework.

- [ ] **Step 5: Run the full frontend suite + typecheck + build**

Run:
```bash
cd frontend && npx vitest run && npx tsc --noEmit && npx vite build
```
Expected: all tests PASS (smoke + api + primitives + card + dashboard + lookup + profit); typecheck exits 0; `vite build` emits `frontend/dist/`.

- [ ] **Step 6: Manual visual check (both themes)**

Run the dev servers and verify by eye, per the `run` skill:
```bash
# terminal 1
npm start -w web
# terminal 2
npm run dev -w frontend    # http://localhost:5173
```
Confirm: dashboard cards render for the default crypto watchlist; asset/interval/horizon controls update the grid; Lookup finds a symbol; Profit computes; light/dark toggle works; the stocks tab shows the disabled panel (no Finnhub key).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Controls.tsx frontend/src/App.tsx frontend/src/styles.css frontend/src/test/smoke.test.tsx
git commit -m "feat(frontend): app shell, controls, theming, and visual design"
```

---

## Task 11: Hosting — Dockerfile, DEPLOY.md, README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `DEPLOY.md`
- Modify: `README.md`

**Interfaces:** none (docs + container packaging).

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
**/node_modules
**/dist
.git
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# Single Node service: builds core + frontend, serves API + static via web.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY web/package.json web/
COPY frontend/package.json frontend/
RUN npm ci
COPY . .
RUN npm run build          # builds core + frontend/dist

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3001
CMD ["npm", "start", "-w", "web"]
```

- [ ] **Step 3: Verify the image builds and serves (if Docker is available)**

Run:
```bash
docker build -t cta .
docker run --rm -p 3001:3001 cta &
sleep 5
curl -s localhost:3001/api/health
curl -s localhost:3001/ | grep -o "<title>[^<]*</title>"
```
Expected: `{"status":"ok",…}` and the page `<title>`. Then stop the container.
(If Docker is unavailable in the environment, skip this step and note it in the commit message.)

- [ ] **Step 4: Create `DEPLOY.md`**

Write `DEPLOY.md` covering all three hosts, verbatim commands:

```markdown
# Deploying coins-trend-advisor

One Node service serves the API and the built frontend. Node 20+.

## Option A — Render (recommended, zero-config)

1. Push to GitHub (already the origin remote).
2. Render → New → Web Service → connect the repo.
3. Settings:
   - Environment: **Node**
   - Build command: `npm install && npm run build`
   - Start command: `npm start -w web`
4. Environment variables (optional): `FINNHUB_API_KEY` (enables stocks),
   `WATCHLIST` (e.g. `crypto:BTCPHP,stock:AAPL`), `API_TOKEN`, etc.
   `PORT` is provided by Render and honored automatically.
5. Deploy. Note: the **free tier spins down after ~15 min idle** (first
   request after idle takes ~30–60s).

## Option B — Fly.io (always-on free allowance)

Uses the repo `Dockerfile`.

1. Install flyctl and `fly auth login`.
2. `fly launch --no-deploy` (accept the detected Dockerfile; pick a region).
3. `fly secrets set FINNHUB_API_KEY=...` (optional).
4. `fly deploy`.
5. The service listens on `PORT` (Fly sets it); the server already honors it.

## Option C — Koyeb (Git deploy or Docker)

1. Koyeb → Create Service → GitHub repo (or Docker).
2. Build: `npm install && npm run build`; Run: `npm start -w web`.
3. Set env vars as above. One free instance; may sleep on the free plan.

## Verifying a deployment

- `GET /api/health` → `{ "status": "ok", ... }`
- `GET /` → the app shell HTML
- `GET /api/forecast/crypto/BTCPHP` → a live forecast (crypto needs no key)
```

- [ ] **Step 5: Update `README.md`**

Add a "Frontend" section (dev: `npm run dev -w frontend` with the Vite proxy; build: `npm run build` at root; served by `web` in prod) and a "Deployment" section pointing to `DEPLOY.md`. Update the "Not yet implemented" list to remove "frontend" and "deployment".

- [ ] **Step 6: Final full-monorepo verification**

Run from repo root:
```bash
npm run build
npm run test
npm run typecheck
```
Expected: build emits `core/dist` + `frontend/dist`; all suites pass (core 31/1, web 68/3, frontend all green); typecheck clean in all three workspaces.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore DEPLOY.md README.md
git commit -m "docs+chore: Dockerfile and free-hosting deploy guide"
```

---

## Self-Review Notes

**Spec coverage:**
- Full toolkit (dashboard/lookup/profit, both classes, interval + horizon controls) → Tasks 7, 8, 9, 10. ✅
- One Node service serving static + API → Task 2 + Task 11 Dockerfile. ✅
- Backend forecast-list "necessary function" → Task 1. ✅
- React + Vite + TS workspace → Task 3. ✅
- Typed API client + error/`stocks_disabled` normalization + optional token → Task 4. ✅
- Clean-data-dashboard visual (light+dark, semantic color) → Task 10 (frontend-design skill). ✅
- Free hosting (Render + Fly.io + Koyeb) documented → Task 11. ✅
- Same-origin/no-CORS, key server-side, error-shape/sanitization preserved → Tasks 1, 2 (mirror existing patterns). ✅
- Tests: frontend (api + components) + backend (list route + static) + existing suites green → every task + Task 11 Step 6. ✅

**Intentional non-goals (unchanged):** charts, client-side routing lib, persistence — deferred per spec.

**Type consistency:** `SignalItem`/`ForecastItem`/`ApiResult`/`ProfitResult` defined in Task 4 (`types.ts`) are consumed by Tasks 5–10. `ControlsState` defined in Task 10 (`Controls.tsx`) is consumed by `App`. `ForecastService.getMany(entries, interval, horizon)` (Task 1) is consumed by the forecast-list route (Task 1) and matches `SignalService.getMany`'s shape. `AppConfig.staticDir?` (Task 2) is consumed by `server.ts` (Task 2) and set by `loadConfig`. Component prop names (`assetClass`/`interval`/`horizon`) are consistent across `Dashboard`/`Lookup` and `App`.

**Deferred verification:** the exact `ProfitResult` field names are treated as an opaque `Record<string, number>` in the UI (rendered generically), so the plan does not depend on core's precise profit output keys.
```
