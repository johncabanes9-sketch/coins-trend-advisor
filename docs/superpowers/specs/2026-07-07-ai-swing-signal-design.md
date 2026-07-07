# AI-Assisted Swing Signal — Design

Date: 2026-07-07
Status: Approved (backend-only v1)

## Problem

The app produces deterministic technical signals (`core/src/signal.ts`) and price
forecasts, but has no risk-aware, trade-shaped recommendation: no position
sizing, stop-loss/take-profit, ATR-based volatility handling, or account-level
risk limits. The goal is a **swing-trading analysis endpoint** that takes market
data plus caller-supplied account state and returns a structured signal
(BUY/SELL/HOLD with entry/stop/TP/size), following a trend-following,
momentum-confirmed strategy.

This is an **analysis** tool. It never places trades, never uses leverage, and
its risk limits are enforced in code and cannot be overridden by prompt input.

## Core principle: LLM judges inside a code-controlled envelope

The deterministic layer computes every number and enforces every hard rule. The
LLM decides only direction, confidence, reasoning, and risk flags — and it can
only narrow toward HOLD, never turn a code-forced HOLD into a trade. Position
sizing, stop distances, and the loss/risk caps never depend on the model.

Decision flow:

```
OHLCV klines ──► [core/analysis: EMA/RSI/MACD/ATR, trend structure,
                  momentum agreement, volatility regime] ──► Snapshot
Snapshot + account state ──► [core/risk: hard gates + sizing math]
   │
   ├─ gate fires (insufficient data | loss-limit | market closed |
   │             trend/momentum conflict) ──► HOLD (no LLM call)
   │
   └─ trade permitted ──► [LLM: action/confidence/reasoning/flags]
                          ──► [code: fill entry/stop/TP/size, clamp to
                               risk caps, apply divergence penalty] ──► JSON
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

Turns a snapshot + account state + a proposed direction into risk outputs and
hard gates.

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
  - direction would increase an existing position already at a loss →
    `adding_to_loser`.
- `computeRisk(snapshot, account, assetClass, direction, config)`:
  - buffer = crypto ? `max(atrBufferCrypto, 2)` : `atrBufferStock`.
  - stopDistance = `atr14 * buffer`.
  - stop = entry ∓ stopDistance (below entry for BUY, above for SELL).
  - takeProfit = entry ± `stopDistance * rewardRisk` (mirrored by direction).
  - rawSizePct = `min(riskPct, 1)`; size in equity terms =
    `equity * rawSizePct/100 / stopDistance` units, expressed back as
    `positionSizePct` of equity; crypto multiplies by `cryptoSizeFactor`;
    `volatilitySpike` multiplies by `volatilitySizeFactor`.
  - `positionSizePct` clamped so per-trade risk never exceeds `riskPct` (and
    never exceeds 1%).

### web/src/llm/analyzer.ts (LLM judgment)

- Thin wrapper over the Anthropic SDK (`@anthropic-ai/sdk`), model
  `claude-sonnet-5`. Exact params (max_tokens, temperature, system prompt,
  tool/JSON-mode) confirmed against the `claude-api` reference skill during
  planning.
- Input: the `SwingSnapshot` (never raw OHLCV) + asset class + the allowed
  directions. Output parsed to `{ action, confidence, reasoning, risk_flags }`.
- The client is injected (interface) so tests use a fake — no network in tests.
- Robust parse: if the model returns malformed JSON or an out-of-envelope action
  (e.g. BUY when only HOLD/SELL is permitted), the service falls back to HOLD
  with a `risk_flags` note. The model cannot widen the decision.

### web/src/analyzeService.ts (orchestration)

`analyze(assetClass, symbol, interval, account, config)`:
1. Fetch klines via the existing `KlineCache`.
2. Build snapshot (`analysis.ts`). If klines errored/insufficient → HOLD,
   confidence 0, `risk_flags: ["insufficient_data"]`, stating what's missing.
3. Determine the candidate direction from `structure` (uptrend→BUY,
   downtrend→SELL). Run `evaluateGates`. If blocked → HOLD, confidence 0, the
   gate reason in `risk_flags`, no LLM call.
4. Otherwise call the LLM for judgment; assemble the final JSON with
   `computeRisk` outputs. If `divergence`, subtract ≥20 from confidence and add
   `"divergence risk"`. If `volatilitySpike`, add `"high volatility regime"`
   (size is already halved by `computeRisk` via `volatilitySizeFactor`).
5. Return the strict JSON schema below.

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
  `routes/profit.ts`).
- If `ANTHROPIC_API_KEY` is unset → `ApiError("analyzer_disabled", 503, ...)`,
  mirroring how stocks degrade when unconfigured.

### Config (web/src/config.ts)

Add: `anthropicApiKey` (from `ANTHROPIC_API_KEY`), and `RiskConfig` defaults
(riskPct 0.75, rewardRisk 2, atrBufferStock 1.75, atrBufferCrypto 2.0,
cryptoSizeFactor 0.5, volatilitySizeFactor 0.5), overridable via env.

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

## Testing (TDD priority: the deterministic layer)

Core (`analysis.ts`, `risk.ts`) — full unit coverage:
- ATR(14) matches a hand-computed value on a fixed candle series.
- Trend structure classification (uptrend / downtrend / sideways).
- Momentum agreement and divergence detection.
- Sizing math: position size respects riskPct; crypto is half of stock for the
  same inputs; stop/TP mirrored correctly for BUY vs SELL.
- Every hard gate returns the right reason: insufficient data (<200 candles),
  daily ≥2%, weekly ≥5%, stock market closed, trend/momentum conflict, adding to
  a loser.

Web (mocked LLM client):
- Orchestration assembles the schema with code-computed prices.
- **Invariant:** a code-forced HOLD stays HOLD even if the fake LLM returns BUY.
- Divergence subtracts ≥20 confidence.
- Missing API key → 503 analyzer_disabled.
- Malformed LLM output → safe HOLD.

## Out of scope (v1 / YAGNI)

- No frontend UI (backend JSON endpoint only; a panel is a later slice).
- No persisted account/portfolio or live exchange integration — account state is
  caller-supplied per request.
- No trade execution, no leverage, no trailing-stop variant (fixed RR TP only).
- No streaming; single request/response.
