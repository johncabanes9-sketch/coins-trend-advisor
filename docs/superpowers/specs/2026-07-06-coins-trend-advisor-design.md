# Coins.ph Trend Advisor — Design

## Purpose

A decision-support tool for crypto trading on Coins.ph. It watches a set of coin
pairs, computes technical-indicator-based trend signals, and helps size trades
with a profit/loss calculator. It does **not** place trades automatically —
the user reviews signals and executes manually on Coins.ph.

Accuracy framing: signals are technical-indicator-based probability estimates,
not guarantees. No trading tool can guarantee profit; the goal is to give the
user a clear, explainable read on trend conditions, not a black-box promise.

## Non-goals (for this version)

- No automated order placement (no Coins.ph API keys/secrets needed).
- No ML price prediction model.
- No native iOS/Android app.
- No multi-user auth/accounts — single-user tool.

## Architecture

Three components share one core library so indicator math is written once:

```
coins-trend-advisor/
  core/         TypeScript library: data fetch, indicators, signal generation,
                profit calculator. No I/O framework dependencies.
  web/          React PWA frontend + Node/Express backend API + scheduled job
                + web-push notifications.
  mcp-server/   MCP server (@modelcontextprotocol/sdk) wrapping `core`,
                exposing tools to Claude.
```

- `core` depends on nothing except an HTTP client and the Coins.ph public API.
- `web` and `mcp-server` both import `core`; neither duplicates indicator logic.
- `web`'s backend is the only component with a database and a scheduler.

## Data source

Coins.ph Pro public REST API (`https://api.pro.coins.ph`), no authentication
required for market data:

- `/openapi/quote/v1/klines` — candlestick data (used for indicators)
- `/openapi/quote/v1/ticker/24hr` — 24hr stats
- `/openapi/quote/v1/ticker/price` — latest price
- `/openapi/v1/pairs` — available trading pairs

Rate limit: 120 requests/minute per IP. The backend caches signals (recomputed
every few minutes via a scheduled job) rather than hitting the API per user
request, and backs off on HTTP 429.

## Signal engine (`core`)

For each watched pair, on 1h and 4h candles:

- **RSI(14)** — overbought (>70) / oversold (<30)
- **EMA(12) / EMA(26) crossover** — trend direction
- **MACD** — momentum confirmation
- **Bollinger Bands(20, 2)** — volatility / price extremes

Each indicator casts a vote (bullish/bearish/neutral). Votes combine into one
signal per pair:

```ts
type Signal = {
  pair: string;               // e.g. "BTCPHP"
  trend: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  confidence: number;         // 0-1, e.g. 0.75 = 3 of 4 indicators agree
  reasoning: string;          // plain-English, e.g. "RSI oversold at 28,
                               //  price at lower Bollinger Band"
  indicators: { rsi: number; emaCrossover: "bullish"|"bearish"|"none";
                macd: number; bollinger: "upper"|"lower"|"mid" };
  asOf: string;                // ISO timestamp of underlying candle data
};
```

Every signal display includes a visible disclaimer: technical-indicator based,
not a guarantee of outcome.

## Watchlist

Default: a curated list of top Coins.ph pairs (BTC, ETH, and a handful of other
majors vs PHP/USDT). Editable later via settings — add/remove pairs from the
full list returned by `/openapi/v1/pairs`.

## Profit calculator (`core`)

Manual inputs: entry price, position size, target sell price (or target %).

```ts
function calculateProfit(input: {
  entryPrice: number;
  positionSize: number;      // in quote currency, e.g. PHP
  targetPrice: number;
  feePct: number;             // Coins.ph maker/taker fee, user-configurable
}): { grossProfit: number; feesPaid: number; netProfit: number; netProfitPct: number };
```

Fee percentage defaults to Coins.ph's published taker fee but is user-editable
since fee tiers can change.

## Web app (PWA)

- **Dashboard**: watchlist with current signal per pair, trend chart.
- **Coin detail**: indicator breakdown and reasoning for one pair.
- **Profit calculator**: manual entry form → computed profit/loss.
- **Settings**: manage watchlist, notification on/off, fee %.
- Installable to phone home screen (manifest + service worker) so push
  notifications work and it feels app-like without an app store.

## Notifications

Web push (VAPID keys) triggered by the backend's scheduled job whenever a
watched pair's signal crosses into `buy`/`strong_buy`/`sell`/`strong_sell`
territory. Requires the PWA installed once; no per-notification user action
needed after that.

## MCP server

Exposes tools backed directly by `core` (no network hop to `web`'s API):

- `get_signal(pair)` — current signal + reasoning for one pair
- `list_watchlist()` — current watched pairs and their signals
- `calculate_profit(entryPrice, positionSize, targetPrice, feePct)`

Run locally via stdio for use with Claude Code/Desktop, configured against the
same Coins.ph public API — no separate deployment required for this piece.

## Hosting

- `web` (frontend + backend): free tier on Render or Railway.
- Database: Postgres free tier (Neon or Supabase) — stores watchlist config
  and push subscriptions only. No funds, keys, or account data stored, since
  there's no order execution in this version.
- Free tiers may sleep after inactivity; first load after idle may take a few
  extra seconds. Acceptable for a personal decision-support tool.

## Error handling

- Coins.ph unreachable or rate-limited → UI shows "data stale as of <time>"
  using last-cached signal, rather than failing silently or showing wrong data.
- Missing/incomplete candle data for a pair → that pair shows "insufficient
  data" instead of a fabricated signal.

## Testing

- Unit tests for each indicator function and for `calculateProfit`, against
  known input/output pairs.
- Unit tests for signal combination logic (given fixed indicator outputs,
  confirm correct trend/confidence).
- One smoke test hitting the real Coins.ph public klines endpoint (skippable
  offline/in CI without network).

## Future possibilities (explicitly out of scope now)

- Sentiment/news signals (e.g. Fear & Greed Index, CryptoPanic).
- Multi-user support.
- Optional semi-automated execution via authenticated Coins.ph API, behind an
  explicit opt-in and per-trade confirmation.
