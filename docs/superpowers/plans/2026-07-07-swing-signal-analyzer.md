# Swing Signal Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, free (no LLM/paid API) swing-trading analysis endpoint that turns OHLCV klines plus caller-supplied account state into a risk-aware BUY/SELL/HOLD signal with entry/stop/take-profit/size, confidence, reasoning, and risk flags.

**Architecture:** Three new pure `core` modules — `analysis.ts` (klines → `SwingSnapshot`), `risk.ts` (account state, hard gates, sizing math), `decision.ts` (`decide()` → `SwingSignal`) — reusing the existing `ema`/`rsi`/`macd`/`bollinger` helpers. A thin `web` orchestration layer (`analyzeService.ts`) fetches klines via the existing `KlineCache` and calls `decide()`; a `POST /api/analyze/:assetClass` route validates input and returns strict JSON. Everything is deterministic and testable; no network beyond the market-data fetch.

**Tech Stack:** TypeScript (ESM, NodeNext — imports use `.js` extensions), Vitest, Express. Monorepo workspaces `@coins-trend-advisor/core` and the `web` package.

## Global Constraints

- **No LLM, no external paid API, no API keys.** The decision, confidence, reasoning, and sizing are pure functions of the indicator snapshot + account state.
- **Analysis only.** Never places trades, never uses leverage. Risk limits are enforced in code and cannot be overridden by request input.
- **Risk limit clamps (hard, non-overridable):** per-trade risk never exceeds `riskPct`, and never exceeds 1% of equity.
- **ESM import rule:** all relative imports within a package use the `.js` extension (e.g. `import { ema } from "./indicators/index.js"`), even for `.ts` sources. Cross-package imports use `@coins-trend-advisor/core`.
- **Indicator arrays are same-length with leading `null`s** (see `ema`/`rsi`/`macd`); read the value at `series[lastIdx]` and guard for `null`.
- **Config defaults (RiskConfig):** `riskPct` 0.75, `rewardRisk` 2, `atrBufferStock` 1.75, `atrBufferCrypto` 2.0, `cryptoSizeFactor` 0.5, `volatilitySizeFactor` 0.5. Env-overridable, no API-key config.
- **Candle floor for a tradeable signal:** `candleCount < 200` → `insufficient_data`.
- **TDD, DRY, YAGNI, frequent commits.** Run tests from the repo root with the workspace scripts.

---

## File Structure

- `core/src/analysis.ts` (create) — `SwingSnapshot` interface + `buildSnapshot(symbol, assetClass, klines)`. Adds ATR(14, Wilder) and swing-structure classification; reuses existing indicators. Pure.
- `core/src/analysis.ts` internal ATR helper — kept in the same file (only consumer is the snapshot builder).
- `core/src/risk.ts` (create) — `AccountState`, `RiskConfig`, `Gate`, `RiskOutputs`, `Direction`, `DEFAULT_RISK_CONFIG`, `evaluateGates(...)`, `computeRisk(...)`. Pure.
- `core/src/decision.ts` (create) — `SwingSignal` interface + `decide(snapshot, account, assetClass, config)`. Pure. Consumes `analysis.ts` + `risk.ts`.
- `core/src/index.ts` (modify) — re-export the new public types and functions.
- `core/test/analysis.test.ts`, `core/test/risk.test.ts`, `core/test/decision.test.ts` (create).
- `web/src/config.ts` (modify) — add `RiskConfig` defaults, env overrides, onto `AppConfig`.
- `web/src/analyzeService.ts` (create) — `AnalyzeService` class: fetch klines via `KlineCache`, build snapshot, `decide()`, map to result. Thin.
- `web/src/routes/analyze.ts` (create) — `POST /api/analyze/:assetClass` with `ApiError` validation.
- `web/src/server.ts` (modify) — add `analyze: AnalyzeService` to `AppDeps`, mount `analyzeRoutes(deps)`.
- `web/src/index.ts` (modify) — construct `AnalyzeService` and pass into `createApp` (verify against existing wiring).
- `web/test/analyzeService.test.ts`, `web/test/analyze.route.test.ts` (create).

---

## Task 1: `core/src/analysis.ts` — SwingSnapshot + ATR + structure

**Files:**
- Create: `core/src/analysis.ts`
- Test: `core/test/analysis.test.ts`

**Interfaces:**
- Consumes: `ema`, `rsi`, `macd` from `./indicators/index.js`; `type Kline`, `type AssetClass` from `./types.js`.
- Produces:
  - `interface SwingSnapshot { symbol: string; assetClass: AssetClass; lastClose: number; ema50: number; ema200: number; priceVsEma: "above_both" | "below_both" | "between"; structure: "uptrend" | "downtrend" | "sideways"; rsi: number; macdHistogram: number; momentum: "bullish" | "bearish" | "neutral"; trendMomentumAgree: boolean; divergence: boolean; atr14: number; atr20Avg: number; volatilitySpike: boolean; candleCount: number; }`
  - `function buildSnapshot(symbol: string, assetClass: AssetClass, klines: Kline[]): SwingSnapshot | { status: "insufficient_data" }`
  - `const STRUCTURE_LOOKBACK = 20` (candles used for swing-structure and divergence).

Notes for the implementer:
- Return `{ status: "insufficient_data" }` when `klines.length < 200` (the tradeable floor) so callers uniformly branch on it. When enough data, `candleCount = klines.length`.
- `lastIdx = klines.length - 1`; `lastClose = klines[lastIdx].close`.
- `ema50`/`ema200` = `ema(closes, 50)[lastIdx]` / `ema(closes, 200)[lastIdx]`; both are non-null given ≥200 candles.
- `priceVsEma`: `above_both` when `lastClose > ema50 && lastClose > ema200`; `below_both` when `lastClose < ema50 && lastClose < ema200`; else `between`.
- `structure`: compare the most recent `STRUCTURE_LOOKBACK` candles to the `STRUCTURE_LOOKBACK` before them. `recentHigh = max(high)` and `recentLow = min(low)` over the last window; `priorHigh`/`priorLow` over the window before it. `uptrend` when `recentHigh > priorHigh && recentLow > priorLow`; `downtrend` when `recentHigh < priorHigh && recentLow < priorLow`; else `sideways`.
- `rsi` = `rsi(closes, 14)[lastIdx] ?? 50`; `macdHistogram` = `macd(closes, 12, 26, 9).histogram[lastIdx] ?? 0`.
- `momentum`: `bullish` when `rsi > 50 && macdHistogram > 0`; `bearish` when `rsi < 50 && macdHistogram < 0`; else `neutral`.
- `trendMomentumAgree`: `(structure === "uptrend" && momentum === "bullish") || (structure === "downtrend" && momentum === "bearish")`.
- `divergence`: over the last `STRUCTURE_LOOKBACK` candles, let `idxOfHighestClose`/`idxOfLowestClose` be the index of the max/min close in the window; bearish divergence = price makes its window high on the **latest** candle (`idxOfHighestClose === lastIdx`) while `rsi[lastIdx] < rsi[windowStart]`; bullish divergence = price makes its window low on the latest candle while `rsi[lastIdx] > rsi[windowStart]`. `divergence = bearishDiv || bullishDiv`.
- ATR: compute true range `tr[i] = max(high-low, |high-prevClose|, |low-prevClose|)` for `i >= 1`. Wilder ATR(14): seed `atr[13]` (0-based over TR, i.e. first 14 TR values averaged) then `atr[i] = (atr[i-1]*13 + tr[i]) / 14`. `atr14` = the last ATR value. `atr20Avg` = simple mean of the **last 20** ATR values (or all available if fewer). `volatilitySpike = atr14 > 1.5 * atr20Avg`.

- [ ] **Step 1: Write the failing tests**

```ts
// core/test/analysis.test.ts
import { describe, it, expect } from "vitest";
import { buildSnapshot, type SwingSnapshot } from "../src/analysis.js";
import type { Kline } from "../src/types.js";

function k(close: number, t: number, high = close, low = close): Kline {
  return { openTime: t, open: close, high, low, close, volume: 1, closeTime: t + 1 };
}

// 240 candles, gentle convex uptrend; caller can override the tail.
function uptrend(n = 240): Kline[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + 0.02 * i * i;
    return k(c, i * 1000, c + 1, c - 1);
  });
}

describe("buildSnapshot", () => {
  it("reports insufficient data below 200 candles", () => {
    const res = buildSnapshot("BTCPHP", "crypto", uptrend(150));
    expect(res).toEqual({ status: "insufficient_data" });
  });

  it("classifies a convex uptrend as uptrend with bullish momentum", () => {
    const res = buildSnapshot("BTCPHP", "crypto", uptrend());
    if ("status" in res) throw new Error("expected a snapshot");
    expect(res.structure).toBe("uptrend");
    expect(res.priceVsEma).toBe("above_both");
    expect(res.momentum).toBe("bullish");
    expect(res.trendMomentumAgree).toBe(true);
    expect(res.candleCount).toBe(240);
    expect(res.atr14).toBeGreaterThan(0);
  });

  it("classifies a convex downtrend as downtrend with bearish momentum", () => {
    const candles = Array.from({ length: 240 }, (_, i) => {
      const c = 100 + 0.02 * (240 - i) * (240 - i);
      return k(c, i * 1000, c + 1, c - 1);
    });
    const res = buildSnapshot("BTCPHP", "crypto", candles);
    if ("status" in res) throw new Error("expected a snapshot");
    expect(res.structure).toBe("downtrend");
    expect(res.priceVsEma).toBe("below_both");
    expect(res.momentum).toBe("bearish");
  });

  it("computes ATR(14) matching a hand-computed value on a fixed series", () => {
    // Flat-then-known-range tail so ATR is predictable: constant TR = 4.
    const base = Array.from({ length: 220 }, (_, i) => k(100, i * 1000, 102, 98));
    const res = buildSnapshot("BTCPHP", "crypto", base);
    if ("status" in res) throw new Error("expected a snapshot");
    // Every candle close=100, high=102, low=98 -> TR = max(4, 2, 2) = 4.
    expect(res.atr14).toBeCloseTo(4, 6);
    expect(res.volatilitySpike).toBe(false);
  });

  it("flags a volatility spike when the latest ranges blow out", () => {
    const candles = Array.from({ length: 240 }, (_, i) => k(100, i * 1000, 101, 99));
    // Widen the last few candles' range dramatically.
    for (let i = 236; i < 240; i++) candles[i] = k(100, i * 1000, 140, 60);
    const res = buildSnapshot("BTCPHP", "crypto", candles);
    if ("status" in res) throw new Error("expected a snapshot");
    expect(res.volatilitySpike).toBe(true);
  });

  it("classifies a flat series as sideways", () => {
    const candles = Array.from({ length: 240 }, (_, i) => k(100, i * 1000, 101, 99));
    const res = buildSnapshot("BTCPHP", "crypto", candles);
    if ("status" in res) throw new Error("expected a snapshot");
    expect(res.structure).toBe("sideways");
    expect(res.momentum).toBe("neutral");
    expect(res.trendMomentumAgree).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace core -- analysis`
Expected: FAIL — `buildSnapshot` not found / module missing.

- [ ] **Step 3: Implement `core/src/analysis.ts`**

```ts
import { ema, rsi, macd } from "./indicators/index.js";
import type { Kline, AssetClass } from "./types.js";

export const STRUCTURE_LOOKBACK = 20;
const MIN_CANDLES = 200;
const ATR_PERIOD = 14;
const ATR_AVG_WINDOW = 20;

export interface SwingSnapshot {
  symbol: string;
  assetClass: AssetClass;
  lastClose: number;
  ema50: number;
  ema200: number;
  priceVsEma: "above_both" | "below_both" | "between";
  structure: "uptrend" | "downtrend" | "sideways";
  rsi: number;
  macdHistogram: number;
  momentum: "bullish" | "bearish" | "neutral";
  trendMomentumAgree: boolean;
  divergence: boolean;
  atr14: number;
  atr20Avg: number;
  volatilitySpike: boolean;
  candleCount: number;
}

function atrSeries(klines: Kline[]): number[] {
  const tr: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const h = klines[i]!.high;
    const l = klines[i]!.low;
    const pc = klines[i - 1]!.close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const out: number[] = [];
  if (tr.length < ATR_PERIOD) return out;
  let seed = 0;
  for (let i = 0; i < ATR_PERIOD; i++) seed += tr[i]!;
  seed /= ATR_PERIOD;
  out.push(seed);
  for (let i = ATR_PERIOD; i < tr.length; i++) {
    out.push((out[out.length - 1]! * (ATR_PERIOD - 1) + tr[i]!) / ATR_PERIOD);
  }
  return out;
}

function classifyStructure(klines: Kline[]): "uptrend" | "downtrend" | "sideways" {
  const n = klines.length;
  const w = STRUCTURE_LOOKBACK;
  const recent = klines.slice(n - w);
  const prior = klines.slice(n - 2 * w, n - w);
  const recentHigh = Math.max(...recent.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));
  const priorHigh = Math.max(...prior.map((c) => c.high));
  const priorLow = Math.min(...prior.map((c) => c.low));
  if (recentHigh > priorHigh && recentLow > priorLow) return "uptrend";
  if (recentHigh < priorHigh && recentLow < priorLow) return "downtrend";
  return "sideways";
}

export function buildSnapshot(
  symbol: string,
  assetClass: AssetClass,
  klines: Kline[],
): SwingSnapshot | { status: "insufficient_data" } {
  if (klines.length < MIN_CANDLES) return { status: "insufficient_data" };

  const closes = klines.map((c) => c.close);
  const lastIdx = closes.length - 1;
  const lastClose = closes[lastIdx]!;
  const ema50 = ema(closes, 50)[lastIdx]!;
  const ema200 = ema(closes, 200)[lastIdx]!;

  const priceVsEma =
    lastClose > ema50 && lastClose > ema200
      ? "above_both"
      : lastClose < ema50 && lastClose < ema200
        ? "below_both"
        : "between";

  const structure = classifyStructure(klines);

  const rsiSeries = rsi(closes, 14);
  const rsiVal = rsiSeries[lastIdx] ?? 50;
  const macdHistogram = macd(closes, 12, 26, 9).histogram[lastIdx] ?? 0;

  const momentum =
    rsiVal > 50 && macdHistogram > 0
      ? "bullish"
      : rsiVal < 50 && macdHistogram < 0
        ? "bearish"
        : "neutral";

  const trendMomentumAgree =
    (structure === "uptrend" && momentum === "bullish") ||
    (structure === "downtrend" && momentum === "bearish");

  // Divergence over the last STRUCTURE_LOOKBACK closes.
  const winStart = lastIdx - STRUCTURE_LOOKBACK + 1;
  let hiIdx = winStart;
  let loIdx = winStart;
  for (let i = winStart; i <= lastIdx; i++) {
    if (closes[i]! > closes[hiIdx]!) hiIdx = i;
    if (closes[i]! < closes[loIdx]!) loIdx = i;
  }
  const rsiStart = rsiSeries[winStart] ?? 50;
  const bearishDiv = hiIdx === lastIdx && rsiVal < rsiStart;
  const bullishDiv = loIdx === lastIdx && rsiVal > rsiStart;
  const divergence = bearishDiv || bullishDiv;

  const atr = atrSeries(klines);
  const atr14 = atr[atr.length - 1] ?? 0;
  const tail = atr.slice(Math.max(0, atr.length - ATR_AVG_WINDOW));
  const atr20Avg = tail.length > 0 ? tail.reduce((a, b) => a + b, 0) / tail.length : 0;
  const volatilitySpike = atr20Avg > 0 && atr14 > 1.5 * atr20Avg;

  return {
    symbol,
    assetClass,
    lastClose,
    ema50,
    ema200,
    priceVsEma,
    structure,
    rsi: rsiVal,
    macdHistogram,
    momentum,
    trendMomentumAgree,
    divergence,
    atr14,
    atr20Avg,
    volatilitySpike,
    candleCount: klines.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace core -- analysis`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add core/src/analysis.ts core/test/analysis.test.ts
git commit -m "feat(core): SwingSnapshot analysis (ATR, structure, momentum, divergence)"
```

---

## Task 2: `core/src/risk.ts` — account state, gates, sizing

**Files:**
- Create: `core/src/risk.ts`
- Test: `core/test/risk.test.ts`

**Interfaces:**
- Consumes: `type SwingSnapshot` from `./analysis.js`; `type AssetClass` from `./types.js`.
- Produces:
  - `type Direction = "BUY" | "SELL"`
  - `interface AccountState { equity: number; position: { size: number; entryPrice: number } | null; lossToDate: { dayPct: number; weekPct: number }; marketStatus?: "open" | "closed"; }`
  - `interface RiskConfig { riskPct: number; rewardRisk: number; atrBufferStock: number; atrBufferCrypto: number; cryptoSizeFactor: number; volatilitySizeFactor: number; }`
  - `const DEFAULT_RISK_CONFIG: RiskConfig`
  - `type GateReason = "insufficient_data" | "daily_loss_limit" | "weekly_loss_limit" | "market_closed" | "trend_momentum_conflict" | "adding_to_loser"`
  - `type Gate = { blocked: true; reason: GateReason } | { blocked: false }`
  - `interface RiskOutputs { entryPrice: number; stopLoss: number; takeProfit: number; positionSizePct: number; }`
  - `function evaluateGates(snapshot: SwingSnapshot, account: AccountState, assetClass: AssetClass, direction: Direction): Gate`
  - `function computeRisk(snapshot: SwingSnapshot, account: AccountState, assetClass: AssetClass, direction: Direction, config: RiskConfig): RiskOutputs`

Notes:
- Gate order (first blocker wins): `candleCount < 200` → `insufficient_data`; `dayPct >= 2` → `daily_loss_limit`; `weekPct >= 5` → `weekly_loss_limit`; stock + `marketStatus !== "open"` → `market_closed`; `!trendMomentumAgree` → `trend_momentum_conflict`; adding-to-loser → `adding_to_loser`; else `{ blocked: false }`.
- Adding-to-loser: `account.position` exists, the position is the same side as `direction` (position size sign; treat `size > 0` as long/BUY side, `size < 0` as short/SELL side — but this app only tracks long-style `size` as a positive quantity, so define same-side as: `direction === "BUY"` with an existing long position, i.e. `position.size > 0`), and the position is currently at a loss for that direction: for BUY, `lastClose < entryPrice`. For SELL we do not add to a tracked long, so `adding_to_loser` only applies to BUY here. Keep it simple and match the test.
- `computeRisk`: `entry = snapshot.lastClose`. `buffer = assetClass === "crypto" ? Math.max(config.atrBufferCrypto, 2) : config.atrBufferStock`. `stopDistance = snapshot.atr14 * buffer`. BUY: `stop = entry - stopDistance`, `tp = entry + stopDistance * config.rewardRisk`. SELL: `stop = entry + stopDistance`, `tp = entry - stopDistance * config.rewardRisk`. Sizing: `let sizePct = Math.min(config.riskPct, 1)`; if crypto `sizePct *= config.cryptoSizeFactor`; if `snapshot.volatilitySpike` `sizePct *= config.volatilitySizeFactor`; final clamp `positionSizePct = Math.min(sizePct, config.riskPct, 1)`.

- [ ] **Step 1: Write the failing tests**

```ts
// core/test/risk.test.ts
import { describe, it, expect } from "vitest";
import {
  evaluateGates,
  computeRisk,
  DEFAULT_RISK_CONFIG,
  type AccountState,
} from "../src/risk.js";
import type { SwingSnapshot } from "../src/analysis.js";

function snap(over: Partial<SwingSnapshot> = {}): SwingSnapshot {
  return {
    symbol: "BTCPHP",
    assetClass: "crypto",
    lastClose: 1000,
    ema50: 950,
    ema200: 900,
    priceVsEma: "above_both",
    structure: "uptrend",
    rsi: 60,
    macdHistogram: 5,
    momentum: "bullish",
    trendMomentumAgree: true,
    divergence: false,
    atr14: 10,
    atr20Avg: 10,
    volatilitySpike: false,
    candleCount: 240,
    ...over,
  };
}

const cleanAccount: AccountState = {
  equity: 100000,
  position: null,
  lossToDate: { dayPct: 0, weekPct: 0 },
  marketStatus: "open",
};

describe("evaluateGates", () => {
  it("passes a clean agreed uptrend", () => {
    expect(evaluateGates(snap(), cleanAccount, "crypto", "BUY")).toEqual({ blocked: false });
  });
  it("blocks insufficient data", () => {
    expect(evaluateGates(snap({ candleCount: 100 }), cleanAccount, "crypto", "BUY"))
      .toEqual({ blocked: true, reason: "insufficient_data" });
  });
  it("blocks daily loss limit at 2%", () => {
    const a = { ...cleanAccount, lossToDate: { dayPct: 2, weekPct: 0 } };
    expect(evaluateGates(snap(), a, "crypto", "BUY")).toEqual({ blocked: true, reason: "daily_loss_limit" });
  });
  it("blocks weekly loss limit at 5%", () => {
    const a = { ...cleanAccount, lossToDate: { dayPct: 0, weekPct: 5 } };
    expect(evaluateGates(snap(), a, "crypto", "BUY")).toEqual({ blocked: true, reason: "weekly_loss_limit" });
  });
  it("blocks a closed stock market", () => {
    const a = { ...cleanAccount, marketStatus: "closed" as const };
    expect(evaluateGates(snap({ assetClass: "stock" }), a, "stock", "BUY"))
      .toEqual({ blocked: true, reason: "market_closed" });
  });
  it("blocks trend/momentum conflict", () => {
    expect(evaluateGates(snap({ trendMomentumAgree: false }), cleanAccount, "crypto", "BUY"))
      .toEqual({ blocked: true, reason: "trend_momentum_conflict" });
  });
  it("blocks adding to a losing long", () => {
    const a: AccountState = { ...cleanAccount, position: { size: 0.5, entryPrice: 1200 } };
    // lastClose 1000 < entry 1200 -> long is underwater
    expect(evaluateGates(snap(), a, "crypto", "BUY")).toEqual({ blocked: true, reason: "adding_to_loser" });
  });
});

describe("computeRisk", () => {
  it("places stop below and TP above entry for BUY, with crypto buffer >= 2", () => {
    const r = computeRisk(snap(), cleanAccount, "crypto", "BUY", DEFAULT_RISK_CONFIG);
    expect(r.entryPrice).toBe(1000);
    expect(r.stopLoss).toBeCloseTo(1000 - 10 * 2, 6); // buffer max(2.0,2)=2
    expect(r.takeProfit).toBeCloseTo(1000 + 10 * 2 * 2, 6);
  });
  it("mirrors stop/TP for SELL", () => {
    const r = computeRisk(snap({ structure: "downtrend", momentum: "bearish" }), cleanAccount, "crypto", "SELL", DEFAULT_RISK_CONFIG);
    expect(r.stopLoss).toBeCloseTo(1000 + 10 * 2, 6);
    expect(r.takeProfit).toBeCloseTo(1000 - 10 * 2 * 2, 6);
  });
  it("makes crypto size half of stock size for the same inputs", () => {
    const crypto = computeRisk(snap(), cleanAccount, "crypto", "BUY", DEFAULT_RISK_CONFIG);
    const stock = computeRisk(snap({ assetClass: "stock" }), cleanAccount, "stock", "BUY", DEFAULT_RISK_CONFIG);
    expect(crypto.positionSizePct).toBeCloseTo(stock.positionSizePct * 0.5, 6);
  });
  it("halves size on a volatility spike", () => {
    const normal = computeRisk(snap(), cleanAccount, "crypto", "BUY", DEFAULT_RISK_CONFIG);
    const spiked = computeRisk(snap({ volatilitySpike: true }), cleanAccount, "crypto", "BUY", DEFAULT_RISK_CONFIG);
    expect(spiked.positionSizePct).toBeCloseTo(normal.positionSizePct * 0.5, 6);
  });
  it("never exceeds riskPct or 1%", () => {
    const r = computeRisk(snap(), cleanAccount, "stock", "BUY", { ...DEFAULT_RISK_CONFIG, riskPct: 5 });
    expect(r.positionSizePct).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace core -- risk`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement `core/src/risk.ts`**

```ts
import type { AssetClass } from "./types.js";
import type { SwingSnapshot } from "./analysis.js";

export type Direction = "BUY" | "SELL";

export interface AccountState {
  equity: number;
  position: { size: number; entryPrice: number } | null;
  lossToDate: { dayPct: number; weekPct: number };
  marketStatus?: "open" | "closed";
}

export interface RiskConfig {
  riskPct: number;
  rewardRisk: number;
  atrBufferStock: number;
  atrBufferCrypto: number;
  cryptoSizeFactor: number;
  volatilitySizeFactor: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  riskPct: 0.75,
  rewardRisk: 2,
  atrBufferStock: 1.75,
  atrBufferCrypto: 2.0,
  cryptoSizeFactor: 0.5,
  volatilitySizeFactor: 0.5,
};

export type GateReason =
  | "insufficient_data"
  | "daily_loss_limit"
  | "weekly_loss_limit"
  | "market_closed"
  | "trend_momentum_conflict"
  | "adding_to_loser";

export type Gate = { blocked: true; reason: GateReason } | { blocked: false };

export interface RiskOutputs {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSizePct: number;
}

const MIN_CANDLES = 200;
const DAILY_LOSS_LIMIT_PCT = 2;
const WEEKLY_LOSS_LIMIT_PCT = 5;

export function evaluateGates(
  snapshot: SwingSnapshot,
  account: AccountState,
  assetClass: AssetClass,
  direction: Direction,
): Gate {
  if (snapshot.candleCount < MIN_CANDLES) return { blocked: true, reason: "insufficient_data" };
  if (account.lossToDate.dayPct >= DAILY_LOSS_LIMIT_PCT) return { blocked: true, reason: "daily_loss_limit" };
  if (account.lossToDate.weekPct >= WEEKLY_LOSS_LIMIT_PCT) return { blocked: true, reason: "weekly_loss_limit" };
  if (assetClass === "stock" && account.marketStatus !== "open") return { blocked: true, reason: "market_closed" };
  if (!snapshot.trendMomentumAgree) return { blocked: true, reason: "trend_momentum_conflict" };
  const pos = account.position;
  if (
    direction === "BUY" &&
    pos !== null &&
    pos.size > 0 &&
    snapshot.lastClose < pos.entryPrice
  ) {
    return { blocked: true, reason: "adding_to_loser" };
  }
  return { blocked: false };
}

export function computeRisk(
  snapshot: SwingSnapshot,
  _account: AccountState,
  assetClass: AssetClass,
  direction: Direction,
  config: RiskConfig,
): RiskOutputs {
  const entry = snapshot.lastClose;
  const buffer =
    assetClass === "crypto" ? Math.max(config.atrBufferCrypto, 2) : config.atrBufferStock;
  const stopDistance = snapshot.atr14 * buffer;
  const stopLoss = direction === "BUY" ? entry - stopDistance : entry + stopDistance;
  const takeProfit =
    direction === "BUY"
      ? entry + stopDistance * config.rewardRisk
      : entry - stopDistance * config.rewardRisk;

  let sizePct = Math.min(config.riskPct, 1);
  if (assetClass === "crypto") sizePct *= config.cryptoSizeFactor;
  if (snapshot.volatilitySpike) sizePct *= config.volatilitySizeFactor;
  const positionSizePct = Math.min(sizePct, config.riskPct, 1);

  return { entryPrice: entry, stopLoss, takeProfit, positionSizePct };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace core -- risk`
Expected: PASS (all 13).

- [ ] **Step 5: Commit**

```bash
git add core/src/risk.ts core/test/risk.test.ts
git commit -m "feat(core): risk gates and ATR-based sizing/stop/TP math"
```

---

## Task 3: `core/src/decision.ts` — decide() → SwingSignal

**Files:**
- Create: `core/src/decision.ts`
- Test: `core/test/decision.test.ts`

**Interfaces:**
- Consumes: `type SwingSnapshot` from `./analysis.js`; `AccountState`, `RiskConfig`, `Direction`, `evaluateGates`, `computeRisk`, `type GateReason` from `./risk.js`; `type AssetClass` from `./types.js`.
- Produces:
  - `type SwingAction = "BUY" | "SELL" | "HOLD"`
  - `interface SwingSignal { action: SwingAction; confidence: number; entry_price: number | null; stop_loss: number | null; take_profit: number | null; position_size_pct: number; reasoning: string; risk_flags: string[]; }`
  - `function decide(snapshot: SwingSnapshot, account: AccountState, assetClass: AssetClass, config: RiskConfig): SwingSignal`

Notes:
- Direction candidate: `uptrend → "BUY"`, `downtrend → "SELL"`, `sideways → HOLD` (no direction).
- If sideways OR a gate blocks: return HOLD, `confidence: 0`, price fields `null`, `position_size_pct: 0`, `reasoning` naming the reason, `risk_flags` containing the mapped flag (see map). For sideways with no gate, reasoning: `"Sideways structure — no trend to follow; holding."` and `risk_flags: []`.
- Gate-reason → flag text map (also used for context flags): `insufficient_data`→`"insufficient data"`, `daily_loss_limit`→`"daily loss limit hit"`, `weekly_loss_limit`→`"weekly loss limit hit"`, `market_closed`→`"market closed"`, `trend_momentum_conflict`→`"trend/momentum conflict"`, `adding_to_loser`→`"adding to losing position blocked"`.
- Permitted trade confidence (additive, then clamp [0,100]):
  - base 60.
  - price fully aligned (`above_both` for BUY / `below_both` for SELL): +15.
  - momentum strength: `+Math.min(15, Math.round(Math.abs(snapshot.rsi - 50) / 2))`.
  - Bollinger context flag: **v1 keeps this at 0** (the snapshot does not carry a Bollinger position; adding one is deferred — see YAGNI note). Do not add a partial band read; the spec's ±10 pullback/chase term is out of scope for this task and its absence is documented in the plan.
  - divergence: −20, and push `"divergence risk"`.
  - volatilitySpike: −10, and push `"high volatility regime"`.
- Reasoning (permitted trade): templated, e.g. build from `structure`, `priceVsEma`, `rsi` (rounded), macd sign, and volatility. Example: ```${structure === "uptrend" ? "Uptrend" : "Downtrend"} confirmed: price ${priceVsEma.replace("_"," ")} EMA50/EMA200 with RSI ${Math.round(rsi)} and a ${macdHistogram >= 0 ? "positive" : "negative"} MACD histogram. Momentum agrees with trend.${volatilitySpike ? " ATR spike flagged — position size halved." : ""}${divergence ? " Divergence warning — confidence reduced." : ""}` ``
- On a permitted trade, fill price fields + size from `computeRisk`.

- [ ] **Step 1: Write the failing tests**

```ts
// core/test/decision.test.ts
import { describe, it, expect } from "vitest";
import { decide } from "../src/decision.js";
import { DEFAULT_RISK_CONFIG, type AccountState } from "../src/risk.js";
import type { SwingSnapshot } from "../src/analysis.js";

function snap(over: Partial<SwingSnapshot> = {}): SwingSnapshot {
  return {
    symbol: "BTCPHP", assetClass: "crypto", lastClose: 1000, ema50: 950, ema200: 900,
    priceVsEma: "above_both", structure: "uptrend", rsi: 62, macdHistogram: 5,
    momentum: "bullish", trendMomentumAgree: true, divergence: false, atr14: 10,
    atr20Avg: 10, volatilitySpike: false, candleCount: 240, ...over,
  };
}
const account: AccountState = {
  equity: 100000, position: null, lossToDate: { dayPct: 0, weekPct: 0 }, marketStatus: "open",
};

describe("decide", () => {
  it("BUYs an agreed uptrend with non-null prices and a computed confidence", () => {
    const s = decide(snap(), account, "crypto", DEFAULT_RISK_CONFIG);
    expect(s.action).toBe("BUY");
    expect(s.confidence).toBeGreaterThan(60);
    expect(s.entry_price).not.toBeNull();
    expect(s.stop_loss).not.toBeNull();
    expect(s.take_profit).not.toBeNull();
    expect(s.position_size_pct).toBeGreaterThan(0);
    expect(s.reasoning).toContain("Uptrend");
  });

  it("HOLDs a sideways market with confidence 0 and null prices", () => {
    const s = decide(snap({ structure: "sideways", momentum: "neutral", trendMomentumAgree: false }), account, "crypto", DEFAULT_RISK_CONFIG);
    expect(s.action).toBe("HOLD");
    expect(s.confidence).toBe(0);
    expect(s.entry_price).toBeNull();
    expect(s.position_size_pct).toBe(0);
  });

  it("HOLDs and flags when a gate blocks", () => {
    const a = { ...account, lossToDate: { dayPct: 3, weekPct: 0 } };
    const s = decide(snap(), a, "crypto", DEFAULT_RISK_CONFIG);
    expect(s.action).toBe("HOLD");
    expect(s.confidence).toBe(0);
    expect(s.risk_flags).toContain("daily loss limit hit");
  });

  it("subtracts at least 20 for divergence", () => {
    const base = decide(snap(), account, "crypto", DEFAULT_RISK_CONFIG);
    const div = decide(snap({ divergence: true }), account, "crypto", DEFAULT_RISK_CONFIG);
    expect(base.confidence - div.confidence).toBeGreaterThanOrEqual(20);
    expect(div.risk_flags).toContain("divergence risk");
  });

  it("subtracts 10 and halves size on a volatility spike", () => {
    const base = decide(snap(), account, "crypto", DEFAULT_RISK_CONFIG);
    const spk = decide(snap({ volatilitySpike: true }), account, "crypto", DEFAULT_RISK_CONFIG);
    expect(base.confidence - spk.confidence).toBe(10);
    expect(spk.position_size_pct).toBeCloseTo(base.position_size_pct * 0.5, 6);
    expect(spk.risk_flags).toContain("high volatility regime");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace core -- decision`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `core/src/decision.ts`**

```ts
import type { AssetClass } from "./types.js";
import type { SwingSnapshot } from "./analysis.js";
import {
  evaluateGates,
  computeRisk,
  type AccountState,
  type RiskConfig,
  type Direction,
  type GateReason,
} from "./risk.js";

export type SwingAction = "BUY" | "SELL" | "HOLD";

export interface SwingSignal {
  action: SwingAction;
  confidence: number;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  position_size_pct: number;
  reasoning: string;
  risk_flags: string[];
}

const GATE_FLAG: Record<GateReason, string> = {
  insufficient_data: "insufficient data",
  daily_loss_limit: "daily loss limit hit",
  weekly_loss_limit: "weekly loss limit hit",
  market_closed: "market closed",
  trend_momentum_conflict: "trend/momentum conflict",
  adding_to_loser: "adding to losing position blocked",
};

function hold(reasoning: string, risk_flags: string[]): SwingSignal {
  return {
    action: "HOLD",
    confidence: 0,
    entry_price: null,
    stop_loss: null,
    take_profit: null,
    position_size_pct: 0,
    reasoning,
    risk_flags,
  };
}

export function decide(
  snapshot: SwingSnapshot,
  account: AccountState,
  assetClass: AssetClass,
  config: RiskConfig,
): SwingSignal {
  const direction: Direction | null =
    snapshot.structure === "uptrend" ? "BUY" : snapshot.structure === "downtrend" ? "SELL" : null;

  if (direction === null) {
    return hold("Sideways structure — no trend to follow; holding.", []);
  }

  const gate = evaluateGates(snapshot, account, assetClass, direction);
  if (gate.blocked) {
    const flag = GATE_FLAG[gate.reason];
    return hold(`Trade blocked: ${flag}.`, [flag]);
  }

  let confidence = 60;
  const aligned =
    (direction === "BUY" && snapshot.priceVsEma === "above_both") ||
    (direction === "SELL" && snapshot.priceVsEma === "below_both");
  if (aligned) confidence += 15;
  confidence += Math.min(15, Math.round(Math.abs(snapshot.rsi - 50) / 2));

  const risk_flags: string[] = [];
  if (snapshot.divergence) {
    confidence -= 20;
    risk_flags.push("divergence risk");
  }
  if (snapshot.volatilitySpike) {
    confidence -= 10;
    risk_flags.push("high volatility regime");
  }
  confidence = Math.max(0, Math.min(100, confidence));

  const r = computeRisk(snapshot, account, assetClass, direction, config);

  const reasoning =
    `${snapshot.structure === "uptrend" ? "Uptrend" : "Downtrend"} confirmed: price ` +
    `${snapshot.priceVsEma.replace(/_/g, " ")} EMA50/EMA200 with RSI ${Math.round(snapshot.rsi)} ` +
    `and a ${snapshot.macdHistogram >= 0 ? "positive" : "negative"} MACD histogram. ` +
    `Momentum agrees with trend.` +
    (snapshot.volatilitySpike ? " ATR spike flagged — position size halved." : "") +
    (snapshot.divergence ? " Divergence warning — confidence reduced." : "");

  return {
    action: direction,
    confidence,
    entry_price: r.entryPrice,
    stop_loss: r.stopLoss,
    take_profit: r.takeProfit,
    position_size_pct: r.positionSizePct,
    reasoning,
    risk_flags,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace core -- decision`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add core/src/decision.ts core/test/decision.test.ts
git commit -m "feat(core): deterministic decide() producing SwingSignal"
```

---

## Task 4: Export the swing-signal API from core

**Files:**
- Modify: `core/src/index.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 1–3.
- Produces: public barrel exports so `web` can `import { buildSnapshot, decide, DEFAULT_RISK_CONFIG, type SwingSignal, type AccountState, type RiskConfig } from "@coins-trend-advisor/core"`.

- [ ] **Step 1: Add exports**

Append to `core/src/index.ts`:

```ts
export { buildSnapshot, type SwingSnapshot } from "./analysis.js";
export {
  evaluateGates,
  computeRisk,
  DEFAULT_RISK_CONFIG,
  type AccountState,
  type RiskConfig,
  type Gate,
  type GateReason,
  type RiskOutputs,
  type Direction,
} from "./risk.js";
export { decide, type SwingSignal, type SwingAction } from "./decision.js";
```

- [ ] **Step 2: Typecheck/build the core package**

Run: `npm run build --workspace core` (or `npm test --workspace core` if build isn't a script)
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add core/src/index.ts
git commit -m "feat(core): export swing-signal analysis/risk/decision API"
```

---

## Task 5: Wire `RiskConfig` into web config

**Files:**
- Modify: `web/src/config.ts`
- Test: `web/test/config.test.ts` (append if it exists; otherwise create with just these cases)

**Interfaces:**
- Consumes: `type RiskConfig` from `@coins-trend-advisor/core`, `DEFAULT_RISK_CONFIG`.
- Produces: `AppConfig.risk: RiskConfig`, populated from env with defaults.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/config.test.ts (add this describe block; keep existing imports/tests if present)
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig risk", () => {
  it("defaults risk config", () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.risk).toEqual({
      riskPct: 0.75, rewardRisk: 2, atrBufferStock: 1.75,
      atrBufferCrypto: 2.0, cryptoSizeFactor: 0.5, volatilitySizeFactor: 0.5,
    });
  });
  it("overrides risk config from env", () => {
    const c = loadConfig({ RISK_PCT: "0.5", REWARD_RISK: "3" } as unknown as NodeJS.ProcessEnv);
    expect(c.risk.riskPct).toBe(0.5);
    expect(c.risk.rewardRisk).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace web -- config`
Expected: FAIL — `c.risk` undefined.

- [ ] **Step 3: Implement**

In `web/src/config.ts`, add the import and field. Add to imports:

```ts
import type { AssetClass, RiskConfig } from "@coins-trend-advisor/core";
import { DEFAULT_RISK_CONFIG } from "@coins-trend-advisor/core";
```

Add `risk: RiskConfig;` to the `AppConfig` interface. In `loadConfig`'s returned object, add:

```ts
    risk: {
      riskPct: num(env, "RISK_PCT", DEFAULT_RISK_CONFIG.riskPct),
      rewardRisk: num(env, "REWARD_RISK", DEFAULT_RISK_CONFIG.rewardRisk),
      atrBufferStock: num(env, "ATR_BUFFER_STOCK", DEFAULT_RISK_CONFIG.atrBufferStock),
      atrBufferCrypto: num(env, "ATR_BUFFER_CRYPTO", DEFAULT_RISK_CONFIG.atrBufferCrypto),
      cryptoSizeFactor: num(env, "CRYPTO_SIZE_FACTOR", DEFAULT_RISK_CONFIG.cryptoSizeFactor),
      volatilitySizeFactor: num(env, "VOLATILITY_SIZE_FACTOR", DEFAULT_RISK_CONFIG.volatilitySizeFactor),
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace web -- config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/config.ts web/test/config.test.ts
git commit -m "feat(web): add env-overridable RiskConfig to app config"
```

---

## Task 6: `web/src/analyzeService.ts` — orchestration

**Files:**
- Create: `web/src/analyzeService.ts`
- Test: `web/test/analyzeService.test.ts`

**Interfaces:**
- Consumes: `KlineCache` (`getKlines(assetClass, symbol, interval)` → `KlinesResult`) from `./klineCache.js`; `buildSnapshot`, `decide`, `type SwingSignal`, `type AccountState`, `type RiskConfig`, `type AssetClass` from `@coins-trend-advisor/core`.
- Produces:
  - `class AnalyzeService { constructor(deps: { cache: KlineCache; risk: RiskConfig }); analyze(assetClass: AssetClass, symbol: string, interval: string, account: AccountState): Promise<SwingSignal> }`

Notes:
- Fetch klines. If `status === "error"` OR `buildSnapshot` returns `insufficient_data` → return a safe HOLD `SwingSignal`: `confidence 0`, null prices, size 0, `risk_flags: ["insufficient data"]`, reasoning describing what's missing (`"No decision: market data unavailable."` for error, `"No decision: not enough candles for analysis."` for insufficient).
- Otherwise `decide(snapshot, account, assetClass, this.deps.risk)`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/test/analyzeService.test.ts
import { describe, it, expect } from "vitest";
import { AnalyzeService } from "../src/analyzeService.js";
import { DEFAULT_RISK_CONFIG, type AccountState } from "@coins-trend-advisor/core";
import type { Kline } from "@coins-trend-advisor/core";
import type { KlineCache, KlinesResult } from "../src/klineCache.js";

function k(close: number, t: number): Kline {
  return { openTime: t, open: close, high: close + 1, low: close - 1, close, volume: 1, closeTime: t + 1 };
}
function uptrend(n = 240): Kline[] {
  return Array.from({ length: n }, (_, i) => k(100 + 0.02 * i * i, i * 1000));
}
function fakeCache(result: KlinesResult): KlineCache {
  return { getKlines: async () => result } as unknown as KlineCache;
}
const account: AccountState = {
  equity: 100000, position: null, lossToDate: { dayPct: 0, weekPct: 0 }, marketStatus: "open",
};

describe("AnalyzeService", () => {
  it("assembles a BUY signal from fixture klines", async () => {
    const svc = new AnalyzeService({ cache: fakeCache({ status: "ok", klines: uptrend() }), risk: DEFAULT_RISK_CONFIG });
    const s = await svc.analyze("crypto", "BTCPHP", "1d", account);
    expect(s.action).toBe("BUY");
    expect(s.entry_price).not.toBeNull();
  });
  it("returns a safe HOLD when klines error", async () => {
    const svc = new AnalyzeService({ cache: fakeCache({ status: "error", message: "boom" }), risk: DEFAULT_RISK_CONFIG });
    const s = await svc.analyze("crypto", "BTCPHP", "1d", account);
    expect(s.action).toBe("HOLD");
    expect(s.confidence).toBe(0);
    expect(s.risk_flags).toContain("insufficient data");
  });
  it("returns a safe HOLD when there are too few candles", async () => {
    const svc = new AnalyzeService({ cache: fakeCache({ status: "ok", klines: uptrend(50) }), risk: DEFAULT_RISK_CONFIG });
    const s = await svc.analyze("crypto", "BTCPHP", "1d", account);
    expect(s.action).toBe("HOLD");
    expect(s.risk_flags).toContain("insufficient data");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace web -- analyzeService`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `web/src/analyzeService.ts`**

```ts
import {
  buildSnapshot,
  decide,
  type AccountState,
  type AssetClass,
  type RiskConfig,
  type SwingSignal,
} from "@coins-trend-advisor/core";
import type { KlineCache } from "./klineCache.js";

export interface AnalyzeServiceDeps {
  cache: KlineCache;
  risk: RiskConfig;
}

function safeHold(reasoning: string): SwingSignal {
  return {
    action: "HOLD",
    confidence: 0,
    entry_price: null,
    stop_loss: null,
    take_profit: null,
    position_size_pct: 0,
    reasoning,
    risk_flags: ["insufficient data"],
  };
}

export class AnalyzeService {
  constructor(private readonly deps: AnalyzeServiceDeps) {}

  async analyze(
    assetClass: AssetClass,
    symbol: string,
    interval: string,
    account: AccountState,
  ): Promise<SwingSignal> {
    const klines = await this.deps.cache.getKlines(assetClass, symbol, interval);
    if (klines.status === "error") {
      return safeHold("No decision: market data unavailable.");
    }
    const snapshot = buildSnapshot(symbol, assetClass, klines.klines);
    if ("status" in snapshot) {
      return safeHold("No decision: not enough candles for analysis.");
    }
    return decide(snapshot, account, assetClass, this.deps.risk);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace web -- analyzeService`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add web/src/analyzeService.ts web/test/analyzeService.test.ts
git commit -m "feat(web): AnalyzeService orchestrating klines -> swing signal"
```

---

## Task 7: `web/src/routes/analyze.ts` — POST endpoint + wiring

**Files:**
- Create: `web/src/routes/analyze.ts`
- Modify: `web/src/server.ts` (add `analyze: AnalyzeService` to `AppDeps`, mount route)
- Modify: `web/src/index.ts` (construct `AnalyzeService`; verify current wiring first)
- Test: `web/test/analyze.route.test.ts`

**Interfaces:**
- Consumes: `AnalyzeService.analyze(...)`, `parseAssetClass` from `./shared.js`, `ApiError`/`asyncHandler` from `../errors.js`, `AppDeps` from `../server.js`.
- Produces: `function analyzeRoutes(deps: AppDeps): Router` handling `POST /analyze/:assetClass`.

Notes:
- Validate: `symbol` non-empty string; `interval` string (default from config: `assetClass === "stock" ? config.stockInterval : config.cryptoInterval`); `equity` finite number; `position` is `null` or `{ size: finite, entryPrice: finite }`; `lossToDate` `{ dayPct: finite, weekPct: finite }`; `marketStatus` optional, one of `"open"`/`"closed"`. Throw `ApiError("invalid_input", 400, ...)` on any violation.
- Use `parseAssetClass(req.params.assetClass)`.
- Respond `res.json(signal)`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/test/analyze.route.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { analyzeRoutes } from "../src/routes/analyze.js";
import { errorMiddleware } from "../src/errors.js";
import { DEFAULT_RISK_CONFIG, type SwingSignal } from "@coins-trend-advisor/core";
import type { AppDeps } from "../src/server.js";

function buySignal(): SwingSignal {
  return {
    action: "BUY", confidence: 80, entry_price: 1000, stop_loss: 980,
    take_profit: 1040, position_size_pct: 0.375, reasoning: "Uptrend confirmed.", risk_flags: [],
  };
}

function makeApp(analyzeImpl: () => Promise<SwingSignal>): Express {
  const deps = {
    config: { cryptoInterval: "1d", stockInterval: "D" },
    analyze: { analyze: analyzeImpl },
  } as unknown as AppDeps;
  const app = express();
  app.use(express.json());
  app.use("/api", analyzeRoutes(deps));
  app.use(errorMiddleware);
  return app;
}

const body = {
  symbol: "BTCPHP", interval: "1d", equity: 100000,
  position: null, lossToDate: { dayPct: 0, weekPct: 0 }, marketStatus: "open",
};

describe("POST /api/analyze/:assetClass", () => {
  it("returns the signal for a valid request", async () => {
    const app = makeApp(async () => buySignal());
    const res = await request(app).post("/api/analyze/crypto").send(body);
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("BUY");
  });
  it("rejects a missing equity", async () => {
    const app = makeApp(async () => buySignal());
    const res = await request(app).post("/api/analyze/crypto").send({ ...body, equity: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_input");
  });
  it("rejects a non-finite position entryPrice", async () => {
    const app = makeApp(async () => buySignal());
    const res = await request(app).post("/api/analyze/crypto")
      .send({ ...body, position: { size: 1, entryPrice: "x" } });
    expect(res.status).toBe(400);
  });
  it("rejects an unknown asset class", async () => {
    const app = makeApp(async () => buySignal());
    const res = await request(app).post("/api/analyze/gold").send(body);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace web -- analyze.route`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `web/src/routes/analyze.ts`**

```ts
import { Router } from "express";
import type { AccountState, AssetClass } from "@coins-trend-advisor/core";
import type { AppDeps } from "../server.js";
import { ApiError, asyncHandler } from "../errors.js";
import { parseAssetClass } from "./shared.js";

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError("invalid_input", 400, `${name} must be a finite number`);
  }
  return value;
}

function parseAccount(body: Record<string, unknown>): AccountState {
  const equity = finite(body.equity, "equity");

  let position: AccountState["position"] = null;
  if (body.position !== null && body.position !== undefined) {
    const p = body.position as Record<string, unknown>;
    position = {
      size: finite(p.size, "position.size"),
      entryPrice: finite(p.entryPrice, "position.entryPrice"),
    };
  }

  const l = (body.lossToDate ?? {}) as Record<string, unknown>;
  const lossToDate = {
    dayPct: finite(l.dayPct, "lossToDate.dayPct"),
    weekPct: finite(l.weekPct, "lossToDate.weekPct"),
  };

  let marketStatus: AccountState["marketStatus"];
  if (body.marketStatus !== undefined) {
    if (body.marketStatus !== "open" && body.marketStatus !== "closed") {
      throw new ApiError("invalid_input", 400, "marketStatus must be 'open' or 'closed'");
    }
    marketStatus = body.marketStatus;
  }

  return { equity, position, lossToDate, marketStatus };
}

export function analyzeRoutes(deps: AppDeps): Router {
  const r = Router();
  r.post(
    "/analyze/:assetClass",
    asyncHandler(async (req, res) => {
      const assetClass: AssetClass = parseAssetClass(req.params.assetClass);
      const body = (req.body ?? {}) as Record<string, unknown>;

      if (typeof body.symbol !== "string" || body.symbol.trim() === "") {
        throw new ApiError("invalid_input", 400, "symbol must be a non-empty string");
      }
      const configDefault =
        assetClass === "stock" ? deps.config.stockInterval : deps.config.cryptoInterval;
      const interval =
        body.interval === undefined
          ? configDefault
          : typeof body.interval === "string" && body.interval.trim() !== ""
            ? body.interval
            : (() => {
                throw new ApiError("invalid_input", 400, "interval must be a non-empty string");
              })();

      const account = parseAccount(body);
      const signal = await deps.analyze.analyze(assetClass, body.symbol, interval, account);
      res.json(signal);
    }),
  );
  return r;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace web -- analyze.route`
Expected: PASS (all 4).

- [ ] **Step 5: Wire into the server + composition root**

In `web/src/server.ts`: add `import type { AnalyzeService } from "./analyzeService.js";`, add `analyze: AnalyzeService;` to `AppDeps`, add `import { analyzeRoutes } from "./routes/analyze.js";`, and mount after the other routes (inside the token-guarded section): `app.use("/api", analyzeRoutes(deps));`

In `web/src/index.ts` (read it first to match the existing construction style): construct `const analyze = new AnalyzeService({ cache, risk: config.risk });` and include `analyze` in the `deps`/`createApp` call. Import `AnalyzeService` from `./analyzeService.js`.

- [ ] **Step 6: Run the full web suite + typecheck**

Run: `npm test --workspace web`
Expected: PASS (existing + new). If a build script exists: `npm run build --workspace web` clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/routes/analyze.ts web/src/server.ts web/src/index.ts web/test/analyze.route.test.ts
git commit -m "feat(web): POST /api/analyze/:assetClass swing-signal endpoint"
```

---

## Task 8: Docs — README endpoint + env vars

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the endpoint**

Add `POST /api/analyze/:assetClass` to the API routes section with the request-body shape from the spec and a one-line note that it is deterministic/free and analysis-only (never trades, non-overridable risk limits). Add the new env vars (`RISK_PCT`, `REWARD_RISK`, `ATR_BUFFER_STOCK`, `ATR_BUFFER_CRYPTO`, `CRYPTO_SIZE_FACTOR`, `VOLATILITY_SIZE_FACTOR`) with defaults to the env table.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document /api/analyze endpoint and risk env vars"
```

---

## Self-Review Notes

- **Spec coverage:** analysis.ts (Task 1), risk.ts (Task 2), decision.ts (Task 3), core exports (Task 4), config (Task 5), analyzeService (Task 6), route + wiring (Task 7), docs (Task 8). Output schema fields are produced by `decide`/`safeHold` and asserted in tests. All gate reasons + flags covered in Task 2/3 tests.
- **Known deviation from spec (documented):** the confidence formula's Bollinger "pullback +10 / chasing −10" term is **deferred** — `SwingSnapshot` intentionally does not carry a Bollinger position in v1 (YAGNI: it needs a band-location field not required elsewhere). Confidence uses base 60 + alignment 15 + momentum ≤15 − divergence 20 − volatility 10. This keeps the ±20 divergence and 10 volatility guarantees the tests and spec require. If the Bollinger term is wanted, add a `bollingerContext` field to the snapshot in a follow-up slice.
- **Adding-to-loser scope:** the app tracks positions as a positive `size` (long-style). The gate therefore fires for `BUY` into an underwater long only; short-side add-to-loser is out of scope (no short position representation exists). Documented here and reflected in the Task 2 test.
- **Type consistency:** `Direction` = `"BUY" | "SELL"` (risk.ts) vs `SwingAction` = adds `"HOLD"` (decision.ts) — `decide` narrows a `Direction|null` before use. `AccountState.marketStatus` optional throughout. `buildSnapshot` returns `SwingSnapshot | { status: "insufficient_data" }` and every caller branches on `"status" in x`.
