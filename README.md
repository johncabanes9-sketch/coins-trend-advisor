# coins-trend-advisor

A stateless HTTP backend that turns raw market candles into **trend signals** and short-horizon **price forecasts** for crypto (via [Coins.ph](https://coins.ph)) and, optionally, US stocks (via [Finnhub](https://finnhub.io)).

Everything is a technical-indicator-based estimate — **not** financial advice. Every signal and forecast carries a `disclaimer` field to that effect.

## What's inside

npm-workspaces monorepo, two packages:

| Package | Role |
|---------|------|
| [`core`](core) | Pure, dependency-free TypeScript: indicators (EMA/RSI/MACD/Bollinger), the signal engine, the Holt-linear `forecast()`, profit math, and the market-data providers (`CoinsProvider`, `FinnhubProvider`) behind a common `MarketDataProvider` interface. |
| [`web`](web) | An Express 4 API over `core`. A `KlineCache` caches raw candles (keyed `assetClass:symbol:interval`) so a signal and a forecast for the same symbol share **one** upstream fetch; `SignalService` / `ForecastService` are pure functions over that cache. |

There is **no frontend** — this is a JSON API.

## Prerequisites

- Node.js 20+
- npm (workspaces)

## Setup

From the repo root:

```bash
npm install          # installs all workspaces
npm run build -w core   # web imports resolve to core/dist — build core first
```

> The `web` server imports `@coins-trend-advisor/core`, which resolves to `core/dist`. Rebuild core (`npm run build -w core`) after changing any `core/src` file, or run the tests instead (Vitest resolves the TypeScript source directly).

## Run

```bash
cd web
npm start      # tsx src/index.ts  → http://localhost:3001
npm run dev    # same, but auto-restarts on changes (tsx watch)
```

Quick check:

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/forecast/crypto/BTCPHP
```

Crypto works out of the box against the public Coins.ph API. Stocks require a Finnhub key (see below).

## API

All routes are under `/api`, JSON in and out. Errors always have the shape `{ "error": { "code", "message" } }`. Upstream failures are logged server-side and returned to the client as a static message (no upstream detail or API keys leak).

`:assetClass` is `crypto` or `stock`. Intervals are validated per asset class: crypto `1h`/`4h` (default `1h`), stock `D`/`W` (default `D`).

| Method & Route | Description |
|----------------|-------------|
| `GET /api/health` | Liveness — `{ status, uptime }`. Never requires auth. |
| `GET /api/watchlist` | Configured symbols, tagged by asset class (lists disabled stocks too). |
| `GET /api/signals/:assetClass` | Signals for the whole watchlist of that class. |
| `GET /api/signals/:assetClass/:symbol` | Single signal. `?interval=…` |
| `GET /api/forecast/:assetClass/:symbol` | Holt-linear forecast + ~80% confidence band. `?interval=…&horizon=N` |
| `GET /api/pairs/:assetClass` | Symbols available from the provider (cached 1h). |
| `POST /api/profit` | Profit calculator. JSON body: `{ entryPrice, positionSize, targetPrice, feePct }` (all finite numbers). |
| `POST /api/analyze/:assetClass` | Deterministic swing-signal analysis (free, no LLM). JSON body: `{ symbol, interval?, equity, position?, lossToDate?, marketStatus? }`. Response: `{ action: "BUY"/"SELL"/"HOLD", confidence, entry_price, stop_loss, take_profit, position_size_pct, reasoning, risk_flags }`. Analysis-only; never places trades and risk limits cannot be overridden. position_size_pct is a flat percent of equity; the equity field is currently informational (validated but does not scale sizing). |

Status codes: `422 insufficient_data` (fewer than 35 candles), `502 upstream_unavailable` (provider failed), `503 stocks_disabled` (stock route with no Finnhub key), `400` for an unknown asset class / interval / horizon.

### Example

```bash
curl "http://localhost:3001/api/forecast/crypto/BTCPHP?horizon=5"
```

```json
{
  "assetClass": "crypto",
  "symbol": "BTCPHP",
  "status": "ok",
  "interval": "1h",
  "forecast": {
    "symbol": "BTCPHP",
    "horizon": 5,
    "predicted": 3800583.07,
    "lower": 3757138.19,
    "upper": 3844027.95,
    "method": "holt-linear",
    "asOf": "2026-07-06T14:59:59.999Z",
    "disclaimer": "Technical-indicator-based estimate, not a guarantee of outcome."
  }
}
```

## Configuration

All optional, via environment variables:

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3001` | HTTP port |
| `WATCHLIST` | 5 crypto pairs | Comma list of `class:symbol`, e.g. `crypto:BTCPHP,stock:AAPL` |
| `FINNHUB_API_KEY` | — | **Required to enable stocks.** Without it, stock routes return `503 stocks_disabled` (crypto is unaffected). |
| `CRYPTO_INTERVAL` | `1h` | Default interval for crypto when none is supplied |
| `STOCK_INTERVAL` | `D` | Default interval for stocks |
| `KLINE_LIMIT` | `250` | Candles requested per fetch |
| `FORECAST_HORIZON` | `5` | Default forecast horizon (steps) |
| `SIGNAL_TTL_MS` | `300000` | Cache TTL for candles (shared by signals + forecasts) |
| `RISK_PCT` | `0.75` | Risk per trade as % of equity (swing-signal analyzer) |
| `REWARD_RISK` | `2` | Reward-to-risk ratio for take-profit targets |
| `ATR_BUFFER_STOCK` | `1.75` | ATR multiplier for stock stop-loss placement |
| `ATR_BUFFER_CRYPTO` | `2.0` | ATR multiplier for crypto stop-loss placement |
| `CRYPTO_SIZE_FACTOR` | `0.5` | Position-size scaling for crypto (vs. stock baseline) |
| `VOLATILITY_SIZE_FACTOR` | `0.5` | Position-size scaling for high-volatility markets |
| `COINS_BASE_URL` | `https://api.pro.coins.ph` | Coins.ph API base |
| `FINNHUB_BASE_URL` | `https://finnhub.io/api/v1` | Finnhub API base |
| `API_TOKEN` | — | If set, every `/api` route except `/health` requires `Authorization: Bearer <token>` |

Example — stocks enabled, token-protected (PowerShell):

```powershell
$env:FINNHUB_API_KEY="your_key"
$env:WATCHLIST="crypto:BTCPHP,stock:AAPL"
$env:API_TOKEN="s3cret"
npm start
```

## Development

```bash
# Tests (Vitest — resolves core TypeScript directly, no build needed)
npm test -w core
npm test -w web

# Typecheck
npm run typecheck -w core
npm run typecheck -w web
```

A live smoke test hits the real upstreams; it is skipped unless `RUN_SMOKE=1`.

## Deploy

See [docs/deploy-vercel.md](docs/deploy-vercel.md) for deploying the app to
Vercel's free tier (static frontend + serverless backend + Upstash Redis cache).

## Not yet implemented

Persistence (Postgres), scheduler, web-push, PWA, and any trained/heavyweight ML model. The `forecast()` seam allows swapping in a heavier model later without changing the API.
