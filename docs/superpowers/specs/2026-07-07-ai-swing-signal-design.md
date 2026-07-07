# Swing Signal Analyzer — Design (deterministic, free)

Date: 2026-07-07
Status: Approved (backend-only v1, fully deterministic — no LLM/paid API)

## Problem

The app produces deterministic technical signals (`core/src/signal.ts`) and price
forecasts, but has no risk-aware, trade-shaped recommendation: no position
sizing, stop-loss/take-profit, ATR-based volatility handling, or account-level
risk limits. The goal is a **swing-trading analysis endpoint** that takes market
data plus caller-supplied account state and returns a structured signal
(BUY/SELL/HOLD with entry/stop/TP/size), following a trend-following,
momentum-confirmed strategy.

This is an **analysis** tool. It never places trades, never uses leverage, and
its risk limits are enforced in code and cannot be overridden by input.

## Free & deterministic

Everything runs in plain code — no language model, no external paid API, no API
keys. Market data comes from the Coins.ph public API already in use. Cost to run:
zero. The decision, confidence score, and reasoning text are all computed from
the indicator snapshot by pure, testable functions.

Decision flow:

```
OHLCV klines ──► [core/analysis: EMA/RSI/MACD/ATR, trend structure,
                  momentum agreement, volatility regime] ──► Snapshot
Snapshot + account state ──► [core/decision + core/risk:
                              hard gates, direction, confidence,
                              reasoning, sizing math] ──► strict JSON
```

## Components

### core/src/analysis.ts (pure, deterministic)

Computes a `SwingSnapshot` from klines. No decisions.

```ts
export interface SwingSnapshot {
  symbol: string;
  assetClass: AssetClass;
  lastClose: number;
  ema50: number;
  ema200: number;
  priceVsEma: "above_both" | "below_both" | "between"; // trend location
  structure: "uptrend" | "downtrend" | "sideways";     // higher-highs/lower-lows
  rsi: number;
  macdHistogram: number;
  momentum: "bullish" | "bearish" | "neutral";
  trendMomentumAgree: boolean;   // trend dir and momentum dir match
  divergence: boolean;           // price extreme vs RSI failing to confirm
  atr14: number;
  atr20Avg: number;
  volatilitySpike: boolean;      // atr14 > 1.5 * atr20Avg
  candleCount: number;
}
```

- Trend location from price vs EMA50/EMA200. `structure` from swing highs/lows
  over a lookback window (last N candles; higher highs AND higher lows = uptrend,
  lower highs AND lower lows = downtrend, else sideways).
- `momentum`: bullish when RSI > 50 and macdHistogram > 0; bearish when RSI < 50
  and macdHistogram < 0; else neutral.
- `trendMomentumAgree`: (structure uptrend + momentum bullish) or (structure
  downtrend + momentum bearish).
- `divergence`: price makes a new high over the lookback while RSI does not (or
  new low while RSI rises).
- ATR(14) via Wilder's true range; `atr20Avg` = simple mean of the last 20 ATR
  values; `volatilitySpike` when `atr14 > 1.5 * atr20Avg`.
- Reuses EMA/RSI/MACD helpers already in the indicator code; only ATR and swing
  structure are new.

### core/src/risk.ts (pure, deterministic)

Account state, hard gates, and sizing math.

```ts
export interface AccountState {
  equity: number;
  position: { size: number; entryPrice: number } | null;
  lossToDate: { dayPct: number; weekPct: number };
  marketStatus?: "open" | "closed"; // stocks only
}

export interface RiskConfig {
  riskPct: number;          // per-trade risk, default 0.75 (within 0.5–1)
  rewardRisk: number;       // TP multiple, default 2
  atrBufferStock: number;   // default 1.75
  atrBufferCrypto: number;  // default 2.0 (min)
  cryptoSizeFactor: number; // default 0.5 (crypto = half stock size)
  volatilitySizeFactor: number; // default 0.5 (halve size on ATR spike)
}

export type Gate =
  | { blocked: true; reason: "insufficient_data" | "daily_loss_limit"
      | "weekly_loss_limit" | "market_closed" | "trend_momentum_conflict"
      | "adding_to_loser"; }
  | { blocked: false };

export interface RiskOutputs {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSizePct: number; // % of equity, after clamps
}
```

- `evaluateGates(snapshot, account, assetClass, direction)` returns the first
  hard blocker, or `{ blocked: false }`:
  - `candleCount < 200` → `insufficient_data`.
  - `lossToDate.dayPct >= 2` → `daily_loss_limit`; `weekPct >= 5` →
    `weekly_loss_limit`.
  - stock + `marketStatus !== "open"` → `market_closed`.
  - `!trendMomentumAgree` → `trend_momentum_conflict`.
  - direction would increase an existing position already at a loss (position
    same side as `direction`, and `lastClose` worse than `entryPrice`) →
    `adding_to_loser`.
- `computeRisk(snapshot, account, assetClass, direction, config)`:
  - buffer = crypto ? `max(atrBufferCrypto, 2)` : `atrBufferStock`.
  - stopDistance = `atr14 * buffer`.
  - stop = entry ∓ stopDistance (below entry for BUY, above for SELL).
  - takeProfit = entry ± `stopDistance * rewardRisk` (mirrored by direction).
  - rawSizePct = `min(riskPct, 1)`; crypto multiplies by `cryptoSizeFactor`;
    `volatilitySpike` multiplies by `volatilitySizeFactor`.
  - `positionSizePct` clamped so per-trade risk never exceeds `riskPct` (and
    never exceeds 1%).

### core/src/decision.ts (pure, deterministic — replaces the LLM)

`decide(snapshot, account, assetClass, config): SwingSignal` — the whole call:

- **Direction candidate** from `structure`: uptrend → BUY, downtrend → SELL,
  sideways → HOLD.
- **Gates:** run `evaluateGates`. If blocked (or direction is HOLD) → HOLD,
  confidence 0, price fields null, size 0, `reasoning` naming the block, and the
  gate reason pushed to `risk_flags`.
- **Confidence (0–100), additive then clamped:**
  - base 60 for a gated-through trend+momentum-agreed signal.
  - `priceVsEma` fully aligned with direction (above_both for BUY / below_both
    for SELL): +15.
  - momentum strength: `+min(15, round(abs(rsi-50)/2))`.
  - secondary context (Bollinger from existing indicators): entry on a pullback
    toward the mid/opposite band in the trend direction +10; stretched to the
    far band (chasing) −10; else 0.
  - `divergence`: −20 (satisfies "reduce by at least 20").
  - `volatilitySpike`: −10.
  - clamp to [0, 100].
- **Reasoning:** a templated 2–3 sentence string built from snapshot facts, e.g.
  `"Uptrend confirmed: price above EMA50/EMA200 with RSI 61 and a positive MACD
  histogram. Momentum agrees with trend. ATR spike flagged — position size
  halved."` No free text beyond the template slots.
- **risk_flags:** `"divergence risk"`, `"high volatility regime"`,
  `"market closed"`, `"daily loss limit hit"`, `"weekly loss limit hit"`,
  `"adding to losing position blocked"`, `"insufficient data"` — included when
  the corresponding condition holds.
- On a permitted trade, fills `entry/stop/take_profit/position_size_pct` from
  `computeRisk`.

`SwingSignal` is the strict JSON shape below.

### web/src/analyzeService.ts (orchestration, thin)

`analyze(assetClass, symbol, interval, account, config)`:
1. Fetch klines via the existing `KlineCache`.
2. If klines errored/insufficient → HOLD, confidence 0,
   `risk_flags: ["insufficient data"]`, reasoning states what's missing.
3. Build snapshot (`analysis.ts`), call `decide(...)` (`decision.ts`), return the
   result. No network beyond the market-data fetch.

### web/src/routes/analyze.ts

`POST /api/analyze/:assetClass`, body:
```json
{ "symbol": "BTCPHP", "interval": "1d",
  "equity": 100000,
  "position": { "size": 0.01, "entryPrice": 3800000 },
  "lossToDate": { "dayPct": 0, "weekPct": 0 },
  "marketStatus": "open" }
```
- Validates every field is present and finite (reuse the `ApiError` pattern from
  `routes/profit.ts`); `position` may be `null`; `marketStatus` optional
  (required-open only affects stocks).
- No API key, no external service — always available.

### Config (web/src/config.ts)

Add `RiskConfig` defaults (riskPct 0.75, rewardRisk 2, atrBufferStock 1.75,
atrBufferCrypto 2.0, cryptoSizeFactor 0.5, volatilitySizeFactor 0.5),
overridable via env. No API-key config.

## Output schema (strict JSON)

```json
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": 0-100,
  "entry_price": number | null,
  "stop_loss": number | null,
  "take_profit": number | null,
  "position_size_pct": number,
  "reasoning": "2-3 sentences citing trend + momentum agreement/conflict and volatility",
  "risk_flags": ["divergence risk", "high volatility regime", "market closed", "daily loss limit hit", ...]
}
```
On any HOLD, price fields are `null` and `position_size_pct` is 0.

## Testing (TDD)

Core is the whole feature now — full unit coverage of pure functions:
- `analysis.ts`: ATR(14) matches a hand-computed value on a fixed candle series;
  trend structure classification (uptrend / downtrend / sideways); momentum
  agreement; divergence detection; volatility spike threshold.
- `risk.ts`: sizing respects riskPct; crypto is half of stock for the same
  inputs; volatility spike halves size; stop/TP mirrored correctly for BUY vs
  SELL; every gate returns the right reason (insufficient data <200 candles,
  daily ≥2%, weekly ≥5%, stock market closed, trend/momentum conflict, adding to
  a loser).
- `decision.ts`: agreed uptrend → BUY with a computed confidence and non-null
  prices; sideways → HOLD; a blocked gate → HOLD with confidence 0 and the right
  flag; divergence subtracts ≥20; volatility spike subtracts 10 and halves size;
  reasoning string contains the expected facts.

Web (`analyzeService` + route) with a fake `KlineCache`:
- Assembles the schema end-to-end from fixture klines.
- Insufficient/errored klines → safe HOLD.
- Request validation rejects missing/non-finite fields with `ApiError`.

## Out of scope (v1 / YAGNI)

- No LLM / AI model, no external paid API, no API keys.
- No frontend UI (backend JSON endpoint only; a panel is a later slice).
- No persisted account/portfolio or live exchange integration — account state is
  caller-supplied per request.
- No trade execution, no leverage, no trailing-stop variant (fixed RR TP only).
