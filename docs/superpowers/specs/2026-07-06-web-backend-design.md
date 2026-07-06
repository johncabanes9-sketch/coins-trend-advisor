# Coins.ph Trend Advisor — `web` Backend (Slice 1) Design

> Part of the `web` component from the master design
> (`docs/superpowers/specs/2026-07-06-coins-trend-advisor-design.md`). The `web`
> component is being built in slices. **This spec covers Slice 1 only: a
> stateless Node/Express backend API that wraps the completed `core` library.**

## Purpose

Expose `core`'s indicator/signal math and profit calculator over a small HTTP
API that a future React PWA (Slice 2) and any other consumer can call. This
slice is deliberately **stateless** — no database — so it ships and tests
quickly and gives the frontend a stable contract to build against.

The backend never re-implements indicator or signal logic; it imports and
delegates to `@coins-trend-advisor/core` (`generateSignal`, `calculateProfit`,
`CoinsClient`).

## Scope

**In this slice:**

- npm workspaces monorepo wiring so `web` imports `core`.
- Express API: health, watchlist, pairs, signals (list + single), profit.
- In-memory signal cache with TTL + in-flight de-duplication (freshness
  approach "A" — lazy recompute on stale/miss, no background scheduler).
- Curated default watchlist from config/env.
- Consistent error handling incl. stale-data fallback.
- Unit tests (Vitest + supertest, injected mock `CoinsClient`) + one skippable
  live smoke test.

**Explicitly deferred to later slices (NOT in this spec):**

- Postgres + persisted, editable watchlist.
- Scheduled recompute job.
- Web-push notifications (VAPID).
- React PWA frontend.
- Deployment/hosting configuration.

## Non-goals

Same as the master design: no automated order placement, no auth accounts
(single-user), no ML prediction. This slice additionally has no persistence and
no background jobs.

## Architecture & workspace

Convert the repo root into an **npm workspaces** monorepo:

```jsonc
// package.json (root, private)
{
  "private": true,
  "workspaces": ["core", "web"]
}
```

`web` declares a dependency on `@coins-trend-advisor/core` (`"*"`, resolved to
the local workspace). Tests and dev resolve `core` from source via a Vitest/
tsconfig alias (`@coins-trend-advisor/core` → `../core/src/index.ts`) for fast
iteration; the production `build` compiles `core` first, then `web`, so the
built package exercises the real published surface.

```
web/
  package.json          express; devDeps: typescript, tsx, vitest, supertest,
                        @types/{express,supertest,node}
  tsconfig.json         strict, ES2022/ESNext/Bundler — mirrors core
  vitest.config.ts      alias core -> ../core/src; test include test/**/*.test.ts
  src/
    config.ts           loadConfig(env) -> AppConfig (all env parsing here)
    coins.ts            makeClient(config) -> CoinsClient (from core)
    signalCache.ts      SignalCache: TTL cache + in-flight dedup over generateSignal
    server.ts           createApp(deps: AppDeps) -> Express  (pure factory, no listen)
    index.ts            entrypoint: loadConfig -> deps -> createApp -> listen
    routes/
      health.ts         GET /api/health
      watchlist.ts      GET /api/watchlist
      pairs.ts          GET /api/pairs
      signals.ts        GET /api/signals, GET /api/signals/:pair
      profit.ts         POST /api/profit
    errors.ts           ApiError class + asyncHandler + error middleware
  test/
    config.test.ts
    signalCache.test.ts
    routes.health.test.ts
    routes.signals.test.ts
    routes.profit.test.ts
    smoke.live.test.ts  (skipped unless RUN_SMOKE=1)
```

### Module boundaries

- **`config.ts`** — the only place that reads `process.env`. Produces a plain
  `AppConfig` object. Depends on: nothing.
- **`signalCache.ts`** — `SignalCache` wraps a `CoinsClient` and caches the
  result of `generateSignal` per `(pair, interval)` key. Depends on: `core`,
  `AppConfig`. Knows nothing about HTTP.
- **`server.ts`** — `createApp({ cache, client, config })` builds the Express
  app and mounts routes. Pure: constructs no I/O, calls no `listen`. This is
  the seam tests drive with supertest.
- **`index.ts`** — the only place that instantiates real dependencies and binds
  a port.

Dependency injection via `createApp(deps)` is the central testability boundary:
tests inject a `CoinsClient` built from a mock `fetch`, so they exercise the
real routing/serialization path without network.

## API surface

All routes are under `/api`, JSON request/response. `Content-Type:
application/json`.

| Method | Path | Purpose | Success |
|---|---|---|---|
| GET | `/api/health` | liveness | `200 {status:"ok", uptime:number}` |
| GET | `/api/watchlist` | curated pairs from config | `200 {pairs:string[]}` |
| GET | `/api/pairs` | available Coins.ph pairs (proxy `core`, lightly cached) | `200 {pairs:string[]}` |
| GET | `/api/signals?interval=1h` | signals for whole watchlist | `200 {interval, results: SignalResult[]}` |
| GET | `/api/signals/:pair?interval=1h` | one pair's signal | `200 SignalOk` (or `422`/`502`) |
| POST | `/api/profit` | profit calc | `200 ProfitResult` |

### Types

```ts
type SignalOk = {
  pair: string;
  status: "ok";
  signal: Signal;        // verbatim from core
  stale?: boolean;       // true when served from cache after an upstream failure
  staleAsOf?: string;    // ISO time the stale value was computed
};

// Per-pair entry in the list response. Discriminated union.
type SignalResult =
  | SignalOk
  | { pair: string; status: "insufficient_data" }
  | { pair: string; status: "error"; message: string };
```

- The single-pair endpoint returns a `SignalOk` on success (so it can carry the
  `stale`/`staleAsOf` flags in the same shape used by the list), `422` for
  insufficient data, and `502` when upstream fails with nothing cached.
- `interval` is validated against `ALLOWED_INTERVALS` (`"1h"`, `"4h"`; default
  `"1h"`). An unsupported interval → `400`.
- `Signal` and `ProfitResult` are re-used verbatim from `core` (including the
  `disclaimer` and `asOf` fields). The API adds no signal fields of its own
  beyond the `stale`/`staleAsOf` envelope markers.
- `POST /api/profit` body: `{ entryPrice, positionSize, targetPrice, feePct }`,
  all numbers. Missing/non-number fields → `400` before calling `core`.

## Data flow & caching (freshness approach A)

`SignalCache.getSignal(pair, interval)`:

1. Look up key `` `${pair}:${interval}` `` in an in-memory `Map`.
2. **Fresh** — entry exists and `now - computedAt < SIGNAL_TTL_MS` → return it.
3. **In-flight** — a recompute for this key is already running → await the
   shared promise (no duplicate upstream calls).
4. **Stale/miss** — start a recompute: `client.getKlines(pair, interval,
   KLINE_LIMIT)` → `generateSignal(pair, candles)`; store `{ result,
   computedAt }`; return. Store the promise in an in-flight map for the duration
   so step 3 can join it.

`getWatchlistSignals(pairs, interval)` maps pairs through `getSignal` with
bounded concurrency (small pool; watchlist is ~10 pairs) and assembles
`SignalResult[]`. A `generateSignal` `insufficient_data` result becomes a
`{status:"insufficient_data"}` entry; an upstream failure becomes either a
stale-served `ok` entry (if a prior value is cached) or `{status:"error"}`.

Cache is process-local and lost on restart — acceptable for a stateless slice
(next request repopulates it). No eviction needed at this watchlist size; the
map is bounded by `watchlist × intervals`.

## Configuration (env, with defaults)

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `COINS_BASE_URL` | core default (`https://api.pro.coins.ph`) | upstream base URL |
| `WATCHLIST` | curated majors: `BTCPHP,ETHPHP,XRPPHP,SOLPHP,USDTPHP` | comma-separated pairs |
| `SIGNAL_TTL_MS` | `300000` (5 min) | cache freshness window |
| `KLINE_INTERVAL` | `1h` | default candle interval |
| `KLINE_LIMIT` | `200` | candles fetched per signal (≥ 35 required by `core`) |
| `API_TOKEN` | unset | if set, all `/api/*` routes require `Authorization: Bearer <token>`; unset = open |

`config.ts` parses and validates these once at startup; invalid values (e.g.
non-numeric `SIGNAL_TTL_MS`) fail fast with a clear message.

## Error handling

- **Upstream unreachable / 429 retries exhausted:** if a cached (now-stale)
  signal exists for the key, serve it with `stale:true` and `staleAsOf` =
  its `computedAt` ISO time (mirrors the master spec's "data stale as of
  <time>"). If nothing is cached, respond `502` with
  `{error:{code:"upstream_unavailable", message}}`.
- **Insufficient candle data:** list endpoint → per-pair
  `{status:"insufficient_data"}`; single-pair endpoint → `422
  {error:{code:"insufficient_data"}}`. Never a fabricated signal.
- **Invalid profit input:** `core` throws → caught and mapped to `400
  {error:{code:"invalid_input", message}}`.
- **Unsupported interval / malformed body:** `400` before any upstream call.
- **Missing/invalid API token (when `API_TOKEN` set):** `401`.
- A central Express error middleware normalizes everything to
  `{ error: { code, message } }` and logs server-side. An `ApiError(code,
  status, message)` class carries the intended HTTP status; unexpected errors
  become `500 {code:"internal"}` without leaking internals.

## Testing

Vitest + supertest. No live network in the default suite.

- **Signals:** mock `CoinsClient` (canned kline rows) → `GET /api/signals/:pair`
  returns a `Signal` with the exact `disclaimer` and an `asOf` derived from the
  candle; `GET /api/signals` returns the watchlist array with mixed
  `ok`/`insufficient_data` entries.
- **Cache:** second request within TTL does not call `fetch` again (spy call
  count); after advancing fake timers past TTL it recomputes; two concurrent
  requests for the same key trigger exactly one upstream fetch (dedup).
- **Stale fallback:** warm the cache, then make the mock client fail → response
  is the cached signal flagged `stale:true`, not a `502`.
- **Profit:** correct math for a known input; `400` on missing/invalid fields.
- **Health/watchlist/interval validation:** basic shape + `400` on bad
  interval.
- **`config.ts`:** defaults applied; invalid numeric env fails fast.
- **Live smoke (`smoke.live.test.ts`):** skipped unless `RUN_SMOKE=1`; drives
  the assembled real app against the live Coins.ph API for one pair.

## Self-review notes

- Every master-design backend responsibility that isn't deferred is covered:
  signal API, profit API, pairs/watchlist, caching + rate-limit friendliness
  (TTL + dedup), stale-data UX, insufficient-data honesty, visible disclaimer
  (via `core`'s `Signal`).
- Deferred items (DB, scheduler, push, PWA) are called out explicitly so the
  implementation plan for this slice stays bounded.
- The stateless choice means the curated watchlist is read-only in this slice;
  editing arrives with Postgres in the next slice, which will replace the
  config-sourced watchlist with a persisted one behind the same
  `/api/watchlist` contract.
