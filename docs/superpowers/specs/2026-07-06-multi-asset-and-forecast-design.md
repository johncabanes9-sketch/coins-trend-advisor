# Multi-Asset Support + ML Price Forecast — Design

**Date:** 2026-07-06
**Status:** Approved (brainstorming)
**Builds on:** `feat/web-backend` (Slice 1 — stateless crypto signals backend)

## Goal

Extend the advisor from crypto-only to **crypto + stocks**, and add a **pure-TypeScript price-forecast model**. Both features layer onto the existing `core` library and `web` backend without changing their architectural style (pure `core`, DI-driven `createApp`, TTL cache, honest failure modes).

## Scope

**In scope**
- A `MarketDataProvider` abstraction in `core` with two implementations: `CoinsProvider` (crypto, existing logic) and `FinnhubProvider` (stocks, new).
- Refactor of `SignalCache` into a `KlineCache` that caches raw candles; signal and forecast become pure functions over cached klines.
- A pure-TS `forecast()` function in `core` (Holt's linear exponential smoothing) with a confidence band.
- Asset-class-aware API routes; a new `/api/forecast` endpoint.
- Env-configured Finnhub key with graceful degradation when absent.

**Out of scope (unchanged from Slice 1 deferrals)**
- Postgres, editable watchlist persistence, scheduler, web-push, React PWA, deployment.
- Any trained/heavyweight ML (Python service, ONNX). The forecaster is pure TS behind a `Forecaster` seam so a heavier model can replace it later without touching the API.

## Decisions (from brainstorming)

1. **Forecast model:** lightweight, pure TypeScript (no Python, no training pipeline). Holt's linear exponential smoothing.
2. **Stock data source:** Finnhub, key via `FINNHUB_API_KEY`; stocks degrade gracefully when the key is absent.
3. **Asset-class addressing:** explicit in the route (`/api/signals/:assetClass/:symbol`), watchlist entries tagged `{ assetClass, symbol }`.
4. **Cache composition:** cache raw klines (option 1); signal and forecast are pure transforms over cached klines. One upstream fetch feeds both features — important under Finnhub's tight free-tier rate limits.

## Known Risk (on record)

Finnhub moved historical **stock candles** to its premium tier in 2024; a free key may return only live quotes, not the OHLC series our indicators and forecaster require. Because everything sits behind `MarketDataProvider`, swapping `FinnhubProvider`'s internals for Alpha Vantage's free `TIME_SERIES_DAILY` (also normalizes to `Kline`) touches exactly one file. Treated as a known risk with that swap as the documented fallback.

---

## Architecture

Two subsystems, implemented as two sequential slices off this one spec:

- **Slice 2 — Multi-asset:** provider abstraction + `CoinsProvider`/`FinnhubProvider` + `KlineCache` refactor + asset-class routing + config. Ships multi-asset signals.
- **Slice 3 — Forecaster:** `forecast()` in `core` + `forecastService` + `/api/forecast` route. Ships predictions.

### 1. Provider abstraction (`core`)

```ts
type AssetClass = "crypto" | "stock";

interface MarketDataProvider {
  readonly assetClass: AssetClass;
  readonly allowedIntervals: string[];   // crypto: ["1h","4h"]; stock: ["D","W"]
  readonly defaultInterval: string;      // crypto: "1h"; stock: "D"
  getKlines(symbol: string, interval: string, limit?: number): Promise<Kline[]>;
  getPrice(symbol: string): Promise<number>;
  listSymbols(): Promise<string[]>;
}
```

- **`CoinsProvider`** — the existing `CoinsClient` HTTP logic re-expressed behind this interface (crypto). `CoinsClient` may remain as the internal HTTP detail; the provider is the public seam.
- **`FinnhubProvider`** — new (stock). Normalizes Finnhub's parallel-array candle response (`{ c, h, l, o, t, v, s }`) into `Kline[]`. Handles `s: "no_data"` as an empty series. Injected `fetch` for testability, mirroring `CoinsClient`.
- Both normalize to the **existing `Kline` shape** — no new candle type.

`web` holds a resolver `providerFor(assetClass): MarketDataProvider`:
- unknown class → surfaced as `400 invalid_asset_class` at the route layer;
- `stock` with no key → a disabled sentinel that yields `503 stocks_disabled`.

### 2. Kline cache (`web/src/klineCache.ts`, refactor of `SignalCache`)

The cache's sole job becomes owning the expensive upstream fetch. It caches `Kline[]` keyed by `assetClass:symbol:interval`, preserving the three behaviors verified correct in Slice 1: **TTL freshness, in-flight de-duplication, stale-on-error fallback.**

```ts
type KlinesResult =
  | { status: "ok"; klines: Kline[]; stale?: boolean; staleAsOf?: string }
  | { status: "error"; message: string };

interface KlineCacheDeps {
  resolveProvider(ac: AssetClass): MarketDataProvider;
  ttlMs: number;
  klineLimit: number;
  now?: () => number;
}

class KlineCache {
  getKlines(assetClass: AssetClass, symbol: string, interval: string): Promise<KlinesResult>;
  getMany(entries: { assetClass: AssetClass; symbol: string }[], interval: string): Promise<KlinesResult[]>;
}
```

- `insufficient_data` is **no longer a cache concern** — it is simply what `generateSignal`/`forecast` return over a too-short series.
- The `stale`/`staleAsOf` markers attach at the klines level and flow into whatever is computed from them.
- The Slice 1 dedup/TTL/stale tests port over nearly verbatim, retargeted at klines.

Two thin services sit on top (in `web`):
- `signalService.get(assetClass, symbol, interval)` → `generateSignal` over cached klines.
- `forecastService.get(assetClass, symbol, interval, horizon)` → `forecast` over cached klines.

Both propagate `stale`/`staleAsOf` from the `KlinesResult`.

### 3. Forecaster (`core/src/forecast.ts`, pure TS)

```ts
interface Forecast {
  symbol: string;
  horizon: number;                 // periods ahead
  predicted: number;               // point estimate
  lower: number; upper: number;    // ~80% confidence band
  method: "holt-linear";
  asOf: string;                    // latest candle closeTime, ISO
  disclaimer: string;
}

function forecast(
  symbol: string,
  candles: Kline[],
  opts?: { horizon?: number },
): Forecast | { status: "insufficient_data" };
```

**Method — Holt's linear exponential smoothing (double exponential smoothing).** Tracks two components, current *level* and *trend*, and projects `level + h·trend` for horizon `h`. Chosen over plain linear regression (Holt weights recent candles more, adapting to trend changes) and over ARIMA/Holt-Winters (no seasonality to model — YAGNI). Smoothing parameters α, β fit by minimizing in-sample one-step error over a small grid.

**Confidence band:** from the in-sample one-step residual standard deviation σ, widened by √horizon (errors compound with distance): `predicted ± z·σ·√h` (z for ~80%). A noisy series yields a wide band, not false precision.

**Honesty guards:**
- Same `MIN_CANDLES` (35) minimum as `generateSignal`; otherwise `insufficient_data`.
- A flat/degenerate series yields trend ≈ 0 and a band reflecting near-zero variance rather than a fabricated move.
- Reuses the shared `DISCLAIMER`; the forecast is explicitly a statistical estimate, never a promise.

---

## API Surface

```
GET  /api/signals/:assetClass/:symbol      single signal   (422 insufficient, 502 upstream)
GET  /api/signals/:assetClass              list over that class's watchlist
GET  /api/forecast/:assetClass/:symbol     forecast        (?horizon=N; default from config)
GET  /api/watchlist                        tagged entries: [{ assetClass, symbol }]
GET  /api/pairs/:assetClass                symbols for one class (lightly cached, per class)
POST /api/profit                           unchanged — asset-agnostic math
GET  /api/health                           unchanged
```

- `:assetClass` validated against `["crypto","stock"]`; unknown → `400 invalid_asset_class`.
- **Interval validation is per-provider:** each provider declares `allowedIntervals`, so `?interval=1h` is valid for crypto and rejected for stock, and vice-versa → `400 invalid_interval` with the class-appropriate list in the message.
- Forecast endpoint reuses signals' insufficient/upstream semantics (422 / 502) and carries `stale`/`staleAsOf` when built on stale klines.
- Error shape stays `{ error: { code, message } }`. Upstream error detail is **sanitized** to a static client message and logged server-side (as fixed in Slice 1).
- **Breaking change:** the current `/api/signals/:pair` shape gains the `:assetClass` segment. Acceptable — `web` is unmerged with no clients. Called out explicitly here.

## Config

```
FINNHUB_API_KEY        optional; absent → stocks disabled
FINNHUB_BASE_URL       default https://finnhub.io/api/v1
WATCHLIST              class-tagged: "crypto:BTCPHP,crypto:ETHPHP,stock:AAPL,stock:MSFT"
STOCK_INTERVAL         default "D"   (crypto default "1h" unchanged)
FORECAST_HORIZON       default 5 periods
FORECAST_TTL_MS        defaults to signalTtlMs
```

- `WATCHLIST` parses to `{ assetClass, symbol }[]`. Default remains the current crypto five; **stock defaults empty** unless configured.
- Malformed entries (missing `class:` prefix, unknown class) throw at boot — fail fast, consistent with existing numeric-env validation.

## Graceful Degradation (no Finnhub key)

- `providerFor("stock")` returns a disabled sentinel; stock routes respond `503 { error: { code: "stocks_disabled", message: "Stock data is not configured" } }` — honest and distinct, not a fake 404 or a crash.
- Stock entries drop from the *effective* watchlist, so `GET /api/signals/crypto` and mixed reads keep working untouched.
- `GET /api/watchlist` **still lists** configured stock entries (so a UI can surface "configure a key to enable"); their signal/forecast calls return `stocks_disabled`.
- Health stays green — stocks off is a configuration state, not an outage.

## Testing

- **`forecast()`:** clean linear ramp → point estimate near the extrapolated value with a tight band; flat series → ~no predicted change; noisy series → wide band; short series → `insufficient_data`; a hand-computed Holt series to pin the math.
- **`KlineCache`:** the ported dedup/TTL/stale suite, retargeted at klines.
- **`FinnhubProvider`:** candle normalization + `s:"no_data"`/error handling via injected `fetch`.
- **Routes:** asset-class routing, per-provider interval validation, `stocks_disabled` path, forecast endpoint (200/422/502, horizon query, stale markers).
- All tests use injected mocks — no live network in the default suite (live smoke stays `RUN_SMOKE`-gated, extended to a stock symbol).

## Self-Review Notes

**Spec coverage:** multi-asset provider abstraction ✅; Finnhub stock provider + fallback risk ✅; klines-cache refactor with preserved dedup/TTL/stale ✅; pure-TS Holt forecaster + band + honesty guards ✅; asset-class routes + forecast endpoint ✅; per-provider interval validation ✅; env config + class-tagged watchlist ✅; graceful degradation ✅; testing without live network ✅.

**Deferred (unchanged):** Postgres/persistence, scheduler, web-push, React PWA, deployment, heavyweight/trained ML.

**Type consistency:** `AssetClass`, `MarketDataProvider`, `Kline` (reused), `KlinesResult`, `Forecast` are the shared contracts. `KlineCache` (Slice 2) is consumed by both `signalService` (Slice 2) and `forecastService` (Slice 3). `forecast()` (Slice 3, `core`) is pure over `Kline[]` and independent of `web`.
