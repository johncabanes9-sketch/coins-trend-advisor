# Frontend + Free Hosting Design

**Goal:** Add a web frontend (the "full toolkit") over the existing `web` API, served by the same Express process as a single deployable Node service, and document a concrete free-hosting path.

**Status:** Design approved 2026-07-06. Next step: implementation plan (superpowers:writing-plans).

## Decisions (from brainstorming)

- **Feature scope:** Full toolkit — dashboard, arbitrary-symbol lookup, profit calculator, both asset classes (crypto + stock), interval toggles (crypto `1h`/`4h`, stock `D`/`W`), forecast horizon control.
- **Deploy model:** One Node service. Express serves the built frontend as static files and the `/api/*` routes. No CORS; provider API keys stay server-side.
- **Frontend stack:** React + Vite + TypeScript, built to static files.
- **Visual direction:** Clean data dashboard — calm modern fintech, neutral surfaces, one accent, color reserved for buy/sell/hold, legible hierarchy, light + dark.
- **Host:** Render free web service (recommended); Fly.io / Koyeb as always-on alternatives.

## Architecture

npm-workspaces monorepo gains a third workspace:

```
core/       pure library (unchanged)
web/        Express API + serves frontend/dist (static + SPA fallback)
frontend/   Vite + React + TS SPA  ← new workspace
```

- `frontend` depends on `@coins-trend-advisor/core` for shared response **types** only (`Signal`, `Forecast`, `AssetClass`, `WatchlistEntry`-shaped data). No runtime core logic runs in the browser.
- `web` gains no import dependency on `frontend`; it only serves `frontend/dist` from disk at a configurable path.
- Same-origin: the browser loads the SPA and calls `/api/*` on the same host → **no CORS**, Finnhub key never reaches the client.

### Request routing (Express)

Order in `createApp`:
1. `express.json()`
2. `/api` health (public)
3. optional bearer-token auth on `/api` (unchanged; only when `API_TOKEN` set)
4. `/api` feature routes: profit, signals, **forecast (single + new list)**, meta
5. `/api` JSON 404 (unknown `/api/*`)
6. **`express.static(staticDir)`** — serves `frontend/dist` assets
7. **SPA fallback**: `GET *` (non-`/api`) → `staticDir/index.html`
8. `errorMiddleware`

`staticDir` resolves to `frontend/dist` by default, overridable via `STATIC_DIR`. If the directory does not exist (e.g. frontend not built in a pure-API deployment), static + fallback are skipped and the server still serves `/api` — so the backend remains runnable without the frontend build.

## Backend additions (`web`)

Small and focused; everything else in `web`/`core` is unchanged.

1. **Static + SPA serving** in `server.ts` as above. New optional config `staticDir` (env `STATIC_DIR`, default resolved relative to the repo: `../frontend/dist`).
2. **`GET /api/forecast/:assetClass` (list)** — mirrors `GET /api/signals/:assetClass`. Returns `{ assetClass, interval, horizon, results: ForecastResult[] }` over the watchlist entries of that class, sanitizing upstream errors exactly like the signals list route. Requires adding `ForecastService.getMany(entries, interval, horizon)` (same structure as `SignalService.getMany`, reusing the shared `KlineCache` — no extra upstream fetches beyond what signals already warmed). Horizon comes from `?horizon=N` (validated) or `config.forecastHorizon`.
3. No CORS, no new provider code, no persistence.

**Interval/horizon validation** reuse the shared `routes/shared.ts` helpers (`parseAssetClass`, `resolveInterval`) already used by signals and single-forecast routes.

## Frontend structure (`frontend`)

Single page; **no router** — section navigation via React state (Dashboard / Lookup / Profit). TypeScript throughout.

- **`src/api.ts`** — typed fetch client for every endpoint:
  - `getWatchlist()`, `getSignals(class, interval)`, `getForecasts(class, interval, horizon)`, `getSignal(class, symbol, interval)`, `getForecast(class, symbol, interval, horizon)`, `getPairs(class)`, `postProfit(body)`.
  - Base URL: same-origin in prod; in dev the Vite server proxies `/api` → `http://localhost:3001`.
  - Optional bearer token read from `localStorage` (`cta.apiToken`) and attached as `Authorization: Bearer …` when present; a small settings field lets the user set it (covers the `API_TOKEN` case).
  - Normalizes the `{ error: { code, message } }` shape and the `503 stocks_disabled` / `422 insufficient_data` / `502 upstream_unavailable` cases into typed results the UI can branch on.
- **Global controls bar**: asset-class toggle (crypto/stock), interval toggle (options depend on class), forecast-horizon number input, theme (light/dark, seeded from `prefers-color-scheme`), optional API-token field.
- **Dashboard** — responsive grid of symbol cards for the selected class's watchlist. Each card shows: symbol; trend badge (buy/sell/hold, color-coded); confidence; indicators (RSI, EMA crossover, MACD, Bollinger); forecast (predicted + low–high band rendered as a simple horizontal band bar, plus `asOf`); a `stale` marker when served from stale cache. Data: one `getSignals` + one `getForecasts` call, joined by symbol.
- **Lookup** — search box with autocomplete sourced from `getPairs(class)`; on submit, fetch `getSignal` + `getForecast` for that symbol and render a detail card (same card component as the dashboard). Honest empty/`insufficient_data` states.
- **Profit** — form (entry price, target price, position size, fee %); on submit `postProfit`; renders the returned profit result; inline 400 validation messages.
- **Cross-cutting**: per-section loading and error states; `stocks_disabled` → a friendly "Stocks aren't configured on this server" panel instead of an error; a persistent disclaimer footer echoing the API `disclaimer` text.
- **State:** React hooks + a small `useAsync`-style fetch hook (loading/error/data). No external state-management or data-fetching library (YAGNI).

### Visual system

Applied via the frontend-design skill at build time. Baseline: neutral gray surfaces, a single accent (links/active controls), semantic colors used **only** for signal semantics (buy = positive/green, sell = negative/red, hold = neutral/amber-gray). System font stack, clear type scale, generous spacing, accessible contrast in both themes. No heavy component library; hand-rolled, small CSS (CSS modules or a single stylesheet).

## Data flow

```
Dashboard(class, interval, horizon)
  ├─ GET /api/signals/:class?interval=…        → results[] by symbol
  └─ GET /api/forecast/:class?interval=…&horizon=… → results[] by symbol
        (both hit the shared KlineCache; forecast reuses candles signals warmed)
  → merge on symbol → card grid

Lookup(class, symbol, interval, horizon)
  ├─ GET /api/signals/:class/:symbol
  └─ GET /api/forecast/:class/:symbol
  → detail card

Profit(form)  → POST /api/profit → result
```

## Dev & build workflow

- **Dev:** run `web` (Express, `:3001`) and `frontend` (Vite dev, `:5173`) concurrently; Vite proxies `/api` → `:3001`. A root `dev` script runs both (via `npm run dev -w web` + `npm run dev -w frontend`, or a concurrently helper).
- **Build:** root `build` script builds `core` then `frontend` (`vite build` → `frontend/dist`). `web` needs no build (runs via `tsx` in prod; already a dependency).
- **Serve prod:** `npm start -w web` serves `/api` and `frontend/dist` on `PORT` (default 3001).

## Hosting (free) — documented in README/DEPLOY

**Recommended: Render free web service.**
- Connect the GitHub repo. Environment: Node.
- Build command: `npm install && npm run build`
- Start command: `npm start -w web`
- Env vars: `FINNHUB_API_KEY` (optional, enables stocks), any of the existing knobs; `PORT` is provided by Render and already honored by the server.
- Caveat: free instances **spin down after ~15 min idle** (cold start ~30–60s). Acceptable for a personal tool.

**Always-on alternatives** (documented, more setup): **Fly.io** (needs a small `Dockerfile`/`fly.toml`, generous free allowance) and **Koyeb** (Git deploy, one free instance). A `Dockerfile` for the single Node service will be included to make Fly.io/Koyeb/any container host straightforward: build stage runs `npm ci && npm run build`, runtime stage runs `npm start -w web`.

## Testing

- **Frontend (Vitest + React Testing Library):** `api.ts` response/ error normalization (incl. `stocks_disabled`, `insufficient_data`); signal/forecast card rendering (badge color per trend, band bar, stale marker); profit form (valid submit + 400 message); the stocks-disabled panel.
- **Backend (supertest):** new `GET /api/forecast/:assetClass` list (ok list, per-symbol mixed statuses, sanitized upstream error, `503` when stocks disabled); static serving (`GET /` returns HTML when `frontend/dist` exists; server still boots and serves `/api` when it does not).
- Existing `core` (31/1) and `web` (60/3) suites stay green; typecheck clean across all three workspaces.

## Explicit non-goals (v1, YAGNI)

- Price/candlestick **charts** — forecast is shown numerically plus a band bar; charting is a clear future add.
- Client-side **routing** library.
- **Accounts / persistence** (no Postgres, no user state beyond `localStorage` theme + optional token).
- No changes to `core` logic or the provider layer.

## Component boundaries (isolation check)

- `frontend/src/api.ts` — the only module that knows HTTP/URLs; everything else consumes typed results. Swappable base URL; testable without a DOM.
- Card component — pure render of a `{ signal?, forecast? }` view-model; no fetching. Reused by Dashboard and Lookup.
- Section components (Dashboard/Lookup/Profit) — own their fetch lifecycle via the shared `useAsync` hook; independent, no shared mutable state beyond the top-level controls (class/interval/horizon/theme).
- `web` static-serving — a self-contained addition guarded by directory existence; does not affect `/api` behavior.
- `ForecastService.getMany` + forecast-list route — mirror the signals equivalents; same contracts, independently testable.
