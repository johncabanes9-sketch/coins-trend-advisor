# Coins Trend Advisor — `core` Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-agnostic `core` TypeScript library — indicator math, signal generation, profit calculator, and a Coins.ph public-API client — that both the future `web` backend and `mcp-server` will import.

**Architecture:** Pure functions with no I/O framework dependencies. Indicator functions take arrays of candle closes and return aligned arrays. A signal engine combines indicator votes into one `Signal` per pair. A thin `fetch`-based client reads Coins.ph public market data. Everything is unit-tested against hand-computable inputs; one skippable smoke test hits the live API.

**Tech Stack:** TypeScript (strict), Node 20 (global `fetch`, no HTTP dependency), Vitest for tests, `tsup` for the build. ESM modules.

## Global Constraints

- Package name: `@coins-trend-advisor/core`. Module type: ESM (`"type": "module"`).
- Node 20+ required (uses global `fetch`, no `node-fetch`/`axios`).
- `core` has **zero runtime dependencies** — only devDependencies (typescript, vitest, tsup, @types/node).
- No I/O framework code (no Express, no MCP SDK, no React). Pure library only.
- Coins.ph Pro public API base URL: `https://api.pro.coins.ph`. No auth for any endpoint used here.
- All indicator functions operate on `number[]` of **closing prices**, oldest-first, and return `(number | null)[]` **aligned to the input length** — leading positions that lack enough data are `null`.
- Public API surface is exported from `core/src/index.ts` only. Internal modules are not part of the contract.
- Every generated `Signal` carries the disclaimer string exactly: `"Technical-indicator-based estimate, not a guarantee of outcome."`

---

## File Structure

```
core/
  package.json
  tsconfig.json
  vitest.config.ts
  tsup.config.ts
  src/
    types.ts              Shared types: Kline, Signal, Vote, IndicatorSnapshot
    indicators/
      ema.ts              ema(values, period)
      rsi.ts              rsi(values, period)
      macd.ts             macd(values, fast, slow, signal)
      bollinger.ts        bollinger(values, period, k)
      index.ts            re-exports all indicators
    signal.ts             generateSignal(...) — combines votes
    profit.ts             calculateProfit(input)
    coinsClient.ts        CoinsClient: klines, ticker, pairs; 429 backoff
    index.ts              Public exports
  test/
    indicators/ema.test.ts
    indicators/rsi.test.ts
    indicators/macd.test.ts
    indicators/bollinger.test.ts
    signal.test.ts
    profit.test.ts
    coinsClient.smoke.test.ts
```

---

## Task 1: Package scaffolding and types

**Files:**
- Create: `core/package.json`
- Create: `core/tsconfig.json`
- Create: `core/vitest.config.ts`
- Create: `core/tsup.config.ts`
- Create: `core/src/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: build/test tooling and the shared types every later task imports:
  - `Kline` — one candle.
  - `Vote = "bullish" | "bearish" | "neutral"`.
  - `Trend = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell"`.
  - `IndicatorSnapshot`, `Signal` (as in the design spec).

- [ ] **Step 1: Create `core/package.json`**

```json
{
  "name": "@coins-trend-advisor/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 2: Create `core/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create `core/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
});
```

- [ ] **Step 5: Create `core/src/types.ts`**

```ts
/** One candlestick, normalized from the Coins.ph klines response. */
export interface Kline {
  openTime: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number; // ms epoch
}

export type Vote = "bullish" | "bearish" | "neutral";

export type Trend = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";

/** Raw indicator readings captured on the latest candle. */
export interface IndicatorSnapshot {
  rsi: number;
  emaCrossover: "bullish" | "bearish" | "none";
  macd: number; // histogram value (macd line - signal line)
  bollinger: "upper" | "lower" | "mid";
}

export interface Signal {
  pair: string;
  trend: Trend;
  confidence: number; // 0-1
  reasoning: string;
  indicators: IndicatorSnapshot;
  asOf: string; // ISO timestamp of the latest candle's closeTime
  disclaimer: string;
}

export const DISCLAIMER =
  "Technical-indicator-based estimate, not a guarantee of outcome.";
```

- [ ] **Step 6: Install deps and verify typecheck**

Run: `cd core && npm install && npm run typecheck`
Expected: install succeeds; `tsc --noEmit` exits 0 with no output.

- [ ] **Step 7: Commit**

```bash
git add core/package.json core/tsconfig.json core/vitest.config.ts core/tsup.config.ts core/src/types.ts
git commit -m "chore(core): scaffold package, tooling, and shared types"
```

---

## Task 2: EMA indicator

**Files:**
- Create: `core/src/indicators/ema.ts`
- Test: `core/test/indicators/ema.test.ts`

**Interfaces:**
- Consumes: nothing (pure math).
- Produces: `ema(values: number[], period: number): (number | null)[]`.
  - Returns an array the same length as `values`.
  - Positions `0 .. period-2` are `null`.
  - Position `period-1` is the SMA seed (mean of the first `period` values).
  - Each later position `i` = `values[i] * k + prev * (1 - k)` where `k = 2 / (period + 1)`.

- [ ] **Step 1: Write the failing test**

```ts
// core/test/indicators/ema.test.ts
import { describe, it, expect } from "vitest";
import { ema } from "../../src/indicators/ema.js";

describe("ema", () => {
  it("returns nulls until the seed index, then SMA seed", () => {
    // period 3 over [1,2,3,4,5,6], k = 2/4 = 0.5
    // seed at index 2 = mean(1,2,3) = 2
    // i3: 4*0.5 + 2*0.5 = 3 ; i4: 5*0.5 + 3*0.5 = 4 ; i5: 6*0.5 + 4*0.5 = 5
    expect(ema([1, 2, 3, 4, 5, 6], 3)).toEqual([null, null, 2, 3, 4, 5]);
  });

  it("returns all nulls when fewer values than period", () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });

  it("throws on period < 1", () => {
    expect(() => ema([1, 2, 3], 0)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run test/indicators/ema.test.ts`
Expected: FAIL — cannot resolve `../../src/indicators/ema.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/indicators/ema.ts
export function ema(values: number[], period: number): (number | null)[] {
  if (period < 1) throw new Error("ema: period must be >= 1");
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  seed /= period;
  out[period - 1] = seed;

  const k = 2 / (period + 1);
  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && npx vitest run test/indicators/ema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add core/src/indicators/ema.ts core/test/indicators/ema.test.ts
git commit -m "feat(core): add EMA indicator"
```

---

## Task 3: RSI indicator

**Files:**
- Create: `core/src/indicators/rsi.ts`
- Test: `core/test/indicators/rsi.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `rsi(values: number[], period: number): (number | null)[]`, aligned to input length. Uses Wilder's smoothing. First RSI value is at index `period` (needs `period` price changes). When average loss is 0, RSI is 100.

- [ ] **Step 1: Write the failing test**

```ts
// core/test/indicators/rsi.test.ts
import { describe, it, expect } from "vitest";
import { rsi } from "../../src/indicators/rsi.js";

describe("rsi", () => {
  it("computes Wilder RSI on a small hand-checked series", () => {
    // closes [1,2,3,2], period 2. changes: +1,+1,-1
    // seed (first 2 changes): avgGain=1, avgLoss=0 -> RS=inf -> RSI=100 at index 2
    // index 3: change -1 -> avgGain=(1*1+0)/2=0.5, avgLoss=(0*1+1)/2=0.5 -> RS=1 -> RSI=50
    const out = rsi([1, 2, 3, 2], 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(100, 6);
    expect(out[3]).toBeCloseTo(50, 6);
  });

  it("returns all nulls when not enough data", () => {
    expect(rsi([1, 2], 2)).toEqual([null, null]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run test/indicators/rsi.test.ts`
Expected: FAIL — cannot resolve `rsi.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/indicators/rsi.ts
export function rsi(values: number[], period: number): (number | null)[] {
  if (period < 1) throw new Error("rsi: period must be >= 1");
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  // Seed average gain/loss over the first `period` changes.
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i]! - values[i - 1]!;
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!;
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && npx vitest run test/indicators/rsi.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add core/src/indicators/rsi.ts core/test/indicators/rsi.test.ts
git commit -m "feat(core): add RSI indicator (Wilder smoothing)"
```

---

## Task 4: Bollinger Bands indicator

**Files:**
- Create: `core/src/indicators/bollinger.ts`
- Test: `core/test/indicators/bollinger.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `bollinger(values: number[], period: number, k: number): { middle: (number|null)[]; upper: (number|null)[]; lower: (number|null)[] }`. Middle = SMA(period). Band width = `k * populationStdDev` over the same window. Each array aligned to input length; positions before `period-1` are `null`.

- [ ] **Step 1: Write the failing test**

```ts
// core/test/indicators/bollinger.test.ts
import { describe, it, expect } from "vitest";
import { bollinger } from "../../src/indicators/bollinger.js";

describe("bollinger", () => {
  it("computes middle/upper/lower with population stddev", () => {
    // period 3, k 2 over [2,4,6]: SMA=4, popVariance=((−2)^2+0+2^2)/3=8/3
    // stddev=sqrt(8/3)=1.632993..., upper=4+2*sd=7.265986, lower=0.734014
    const out = bollinger([2, 4, 6], 3, 2);
    expect(out.middle[2]).toBeCloseTo(4, 6);
    expect(out.upper[2]).toBeCloseTo(7.265986, 5);
    expect(out.lower[2]).toBeCloseTo(0.734014, 5);
    expect(out.middle[0]).toBeNull();
    expect(out.middle[1]).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run test/indicators/bollinger.test.ts`
Expected: FAIL — cannot resolve `bollinger.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/indicators/bollinger.ts
export interface BollingerBands {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export function bollinger(
  values: number[],
  period: number,
  k: number,
): BollingerBands {
  if (period < 1) throw new Error("bollinger: period must be >= 1");
  const middle: (number | null)[] = new Array(values.length).fill(null);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j]!;
    const mean = sum / period;

    let sqDiff = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j]! - mean;
      sqDiff += d * d;
    }
    const sd = Math.sqrt(sqDiff / period); // population stddev

    middle[i] = mean;
    upper[i] = mean + k * sd;
    lower[i] = mean - k * sd;
  }
  return { middle, upper, lower };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && npx vitest run test/indicators/bollinger.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add core/src/indicators/bollinger.ts core/test/indicators/bollinger.test.ts
git commit -m "feat(core): add Bollinger Bands indicator"
```

---

## Task 5: MACD indicator

**Files:**
- Create: `core/src/indicators/macd.ts`
- Test: `core/test/indicators/macd.test.ts`

**Interfaces:**
- Consumes: `ema` from Task 2 (`core/src/indicators/ema.ts`).
- Produces: `macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): { macd: (number|null)[]; signal: (number|null)[]; histogram: (number|null)[] }`. `macd[i] = emaFast[i] - emaSlow[i]` when both defined, else `null`. `signal` = EMA(`signalPeriod`) of the non-null macd values, mapped back onto their original indices. `histogram[i] = macd[i] - signal[i]`.

- [ ] **Step 1: Write the failing test**

```ts
// core/test/indicators/macd.test.ts
import { describe, it, expect } from "vitest";
import { macd } from "../../src/indicators/macd.js";

describe("macd", () => {
  it("is positive on a steady uptrend", () => {
    const closes = Array.from({ length: 40 }, (_, i) => i + 1); // 1..40
    const out = macd(closes, 12, 26, 9);
    const last = out.macd[out.macd.length - 1];
    const lastHist = out.histogram[out.histogram.length - 1];
    expect(last).not.toBeNull();
    expect(last!).toBeGreaterThan(0); // fast EMA above slow EMA in an uptrend
    expect(lastHist).not.toBeNull();
    expect(lastHist!).toBeGreaterThan(0); // macd still above its signal line
  });

  it("leaves early indices null until slow EMA is defined", () => {
    const closes = Array.from({ length: 40 }, (_, i) => i + 1);
    const out = macd(closes, 12, 26, 9);
    expect(out.macd[24]).toBeNull(); // slow EMA seeds at index 25
    expect(out.macd[25]).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run test/indicators/macd.test.ts`
Expected: FAIL — cannot resolve `macd.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/indicators/macd.ts
import { ema } from "./ema.js";

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);

  const macdLine: (number | null)[] = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f !== null && s !== null ? f - s : null;
  });

  // Collect defined macd values, EMA them, map back to original indices.
  const definedIdx: number[] = [];
  const definedVals: number[] = [];
  macdLine.forEach((v, i) => {
    if (v !== null) {
      definedIdx.push(i);
      definedVals.push(v);
    }
  });

  const signalCompact = ema(definedVals, signalPeriod);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  signalCompact.forEach((v, j) => {
    if (v !== null) signal[definedIdx[j]!] = v;
  });

  const histogram: (number | null)[] = values.map((_, i) => {
    const m = macdLine[i];
    const s = signal[i];
    return m !== null && s !== null ? m - s : null;
  });

  return { macd: macdLine, signal, histogram };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && npx vitest run test/indicators/macd.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `core/src/indicators/index.ts`**

```ts
export { ema } from "./ema.js";
export { rsi } from "./rsi.js";
export { bollinger, type BollingerBands } from "./bollinger.js";
export { macd, type MacdResult } from "./macd.js";
```

- [ ] **Step 6: Commit**

```bash
git add core/src/indicators/macd.ts core/test/indicators/macd.test.ts core/src/indicators/index.ts
git commit -m "feat(core): add MACD indicator and indicators barrel"
```

---

## Task 6: Profit calculator

**Files:**
- Create: `core/src/profit.ts`
- Test: `core/test/profit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  function calculateProfit(input: {
    entryPrice: number;
    positionSize: number; // in quote currency (e.g. PHP)
    targetPrice: number;
    feePct: number;       // percent, e.g. 0.25 means 0.25%
  }): { grossProfit: number; feesPaid: number; netProfit: number; netProfitPct: number };
  ```
  - `units = positionSize / entryPrice`
  - `grossProceeds = units * targetPrice`
  - `grossProfit = grossProceeds - positionSize`
  - Fee charged on both buy and sell notional: `feesPaid = (positionSize + grossProceeds) * feePct / 100`
  - `netProfit = grossProfit - feesPaid`
  - `netProfitPct = netProfit / positionSize * 100`

- [ ] **Step 1: Write the failing test**

```ts
// core/test/profit.test.ts
import { describe, it, expect } from "vitest";
import { calculateProfit } from "../src/profit.js";

describe("calculateProfit", () => {
  it("computes a fee-free 10% gain", () => {
    const r = calculateProfit({
      entryPrice: 100,
      positionSize: 1000,
      targetPrice: 110,
      feePct: 0,
    });
    expect(r.grossProfit).toBeCloseTo(100, 6);
    expect(r.feesPaid).toBeCloseTo(0, 6);
    expect(r.netProfit).toBeCloseTo(100, 6);
    expect(r.netProfitPct).toBeCloseTo(10, 6);
  });

  it("subtracts fees on both buy and sell notional", () => {
    // buy notional 1000, sell notional 1100, feePct 1% -> fees = 21
    const r = calculateProfit({
      entryPrice: 100,
      positionSize: 1000,
      targetPrice: 110,
      feePct: 1,
    });
    expect(r.feesPaid).toBeCloseTo(21, 6);
    expect(r.netProfit).toBeCloseTo(79, 6);
    expect(r.netProfitPct).toBeCloseTo(7.9, 6);
  });

  it("throws on non-positive entry price", () => {
    expect(() =>
      calculateProfit({ entryPrice: 0, positionSize: 100, targetPrice: 1, feePct: 0 }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run test/profit.test.ts`
Expected: FAIL — cannot resolve `profit.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/profit.ts
export interface ProfitInput {
  entryPrice: number;
  positionSize: number;
  targetPrice: number;
  feePct: number;
}

export interface ProfitResult {
  grossProfit: number;
  feesPaid: number;
  netProfit: number;
  netProfitPct: number;
}

export function calculateProfit(input: ProfitInput): ProfitResult {
  const { entryPrice, positionSize, targetPrice, feePct } = input;
  if (entryPrice <= 0) throw new Error("calculateProfit: entryPrice must be > 0");
  if (positionSize <= 0)
    throw new Error("calculateProfit: positionSize must be > 0");

  const units = positionSize / entryPrice;
  const grossProceeds = units * targetPrice;
  const grossProfit = grossProceeds - positionSize;
  const feesPaid = ((positionSize + grossProceeds) * feePct) / 100;
  const netProfit = grossProfit - feesPaid;
  const netProfitPct = (netProfit / positionSize) * 100;

  return { grossProfit, feesPaid, netProfit, netProfitPct };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && npx vitest run test/profit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add core/src/profit.ts core/test/profit.test.ts
git commit -m "feat(core): add profit calculator"
```

---

## Task 7: Signal engine

**Files:**
- Create: `core/src/signal.ts`
- Test: `core/test/signal.test.ts`

**Interfaces:**
- Consumes: `rsi`, `macd`, `bollinger`, `ema` from `core/src/indicators/index.ts`; `Kline`, `Signal`, `Vote`, `Trend`, `IndicatorSnapshot`, `DISCLAIMER` from `core/src/types.ts`.
- Produces:
  ```ts
  function generateSignal(pair: string, candles: Kline[]): Signal | { pair: string; status: "insufficient_data" };
  ```
  Requires at least 35 candles (enough for MACD slow EMA + signal). Below that returns the `insufficient_data` shape. Voting rules:
  - **RSI(14)** on closes: last value `< 30` → bullish, `> 70` → bearish, else neutral.
  - **EMA crossover**: EMA(12) vs EMA(26) on last candle — `>` bullish, `<` bearish, equal → neutral (`emaCrossover` snapshot: bullish/bearish/none).
  - **MACD(12,26,9)** histogram last value: `> 0` bullish, `< 0` bearish, `== 0` neutral.
  - **Bollinger(20,2)**: last close `<= lower` bullish, `>= upper` bearish, else neutral (`bollinger` snapshot: lower/upper/mid).
  - `score = bullishVotes - bearishVotes` over the 4 votes.
    - `score >= 3` → `strong_buy`; `1..2` → `buy`; `0` → `hold`; `-2..-1` → `sell`; `<= -3` → `strong_sell`.
  - `confidence = max(bullishVotes, bearishVotes, neutralVotes) / 4`.
  - `reasoning`: comma-joined plain-English fragments from the non-neutral indicators (see impl).
  - `asOf`: ISO string of the last candle's `closeTime`.

- [ ] **Step 1: Write the failing test**

```ts
// core/test/signal.test.ts
import { describe, it, expect } from "vitest";
import { generateSignal } from "../src/signal.js";
import type { Kline } from "../src/types.js";
import { DISCLAIMER } from "../src/types.js";

function kline(close: number, t: number): Kline {
  return {
    openTime: t,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    closeTime: t + 1,
  };
}

describe("generateSignal", () => {
  it("reports insufficient data below the candle floor", () => {
    const candles = Array.from({ length: 10 }, (_, i) => kline(100 + i, i));
    const res = generateSignal("BTCPHP", candles);
    expect(res).toEqual({ pair: "BTCPHP", status: "insufficient_data" });
  });

  it("produces a bullish trend on a steady uptrend", () => {
    // Steady uptrend: EMA fast > slow, MACD hist > 0 -> at least buy.
    const candles = Array.from({ length: 60 }, (_, i) => kline(100 + i, i * 1000));
    const res = generateSignal("BTCPHP", candles);
    if ("status" in res) throw new Error("expected a Signal");
    expect(["buy", "strong_buy"]).toContain(res.trend);
    expect(res.confidence).toBeGreaterThan(0);
    expect(res.confidence).toBeLessThanOrEqual(1);
    expect(res.disclaimer).toBe(DISCLAIMER);
    expect(res.asOf).toBe(new Date(candles[candles.length - 1]!.closeTime).toISOString());
    expect(res.indicators.emaCrossover).toBe("bullish");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run test/signal.test.ts`
Expected: FAIL — cannot resolve `signal.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/signal.ts
import { rsi, macd, bollinger, ema } from "./indicators/index.js";
import {
  DISCLAIMER,
  type Kline,
  type Signal,
  type Trend,
  type Vote,
  type IndicatorSnapshot,
} from "./types.js";

const MIN_CANDLES = 35;

export function generateSignal(
  pair: string,
  candles: Kline[],
):
  | Signal
  | { pair: string; status: "insufficient_data" } {
  if (candles.length < MIN_CANDLES) {
    return { pair, status: "insufficient_data" };
  }

  const closes = candles.map((c) => c.close);
  const lastIdx = closes.length - 1;
  const lastClose = closes[lastIdx]!;

  const rsiSeries = rsi(closes, 14);
  const rsiVal = rsiSeries[lastIdx] ?? 50;

  const ema12 = ema(closes, 12)[lastIdx];
  const ema26 = ema(closes, 26)[lastIdx];
  const emaCrossover: IndicatorSnapshot["emaCrossover"] =
    ema12 !== null && ema26 !== null
      ? ema12 > ema26
        ? "bullish"
        : ema12 < ema26
          ? "bearish"
          : "none"
      : "none";

  const macdRes = macd(closes, 12, 26, 9);
  const hist = macdRes.histogram[lastIdx] ?? 0;

  const bb = bollinger(closes, 20, 2);
  const upper = bb.upper[lastIdx];
  const lower = bb.lower[lastIdx];
  const bollingerPos: IndicatorSnapshot["bollinger"] =
    lower !== null && lastClose <= lower
      ? "lower"
      : upper !== null && lastClose >= upper
        ? "upper"
        : "mid";

  // Votes
  const votes: { vote: Vote; reason: string }[] = [];
  votes.push(
    rsiVal < 30
      ? { vote: "bullish", reason: `RSI oversold at ${rsiVal.toFixed(1)}` }
      : rsiVal > 70
        ? { vote: "bearish", reason: `RSI overbought at ${rsiVal.toFixed(1)}` }
        : { vote: "neutral", reason: "" },
  );
  votes.push(
    emaCrossover === "bullish"
      ? { vote: "bullish", reason: "EMA(12) above EMA(26)" }
      : emaCrossover === "bearish"
        ? { vote: "bearish", reason: "EMA(12) below EMA(26)" }
        : { vote: "neutral", reason: "" },
  );
  votes.push(
    hist > 0
      ? { vote: "bullish", reason: "MACD histogram positive" }
      : hist < 0
        ? { vote: "bearish", reason: "MACD histogram negative" }
        : { vote: "neutral", reason: "" },
  );
  votes.push(
    bollingerPos === "lower"
      ? { vote: "bullish", reason: "price at lower Bollinger Band" }
      : bollingerPos === "upper"
        ? { vote: "bearish", reason: "price at upper Bollinger Band" }
        : { vote: "neutral", reason: "" },
  );

  const bullish = votes.filter((v) => v.vote === "bullish").length;
  const bearish = votes.filter((v) => v.vote === "bearish").length;
  const neutral = votes.filter((v) => v.vote === "neutral").length;
  const score = bullish - bearish;

  const trend: Trend =
    score >= 3
      ? "strong_buy"
      : score >= 1
        ? "buy"
        : score === 0
          ? "hold"
          : score <= -3
            ? "strong_sell"
            : "sell";

  const confidence = Math.max(bullish, bearish, neutral) / 4;

  const fragments = votes.map((v) => v.reason).filter((r) => r.length > 0);
  const reasoning =
    fragments.length > 0
      ? fragments.join(", ")
      : "No indicator extremes; mixed/neutral conditions";

  const indicators: IndicatorSnapshot = {
    rsi: rsiVal,
    emaCrossover,
    macd: hist,
    bollinger: bollingerPos,
  };

  return {
    pair,
    trend,
    confidence,
    reasoning,
    indicators,
    asOf: new Date(candles[lastIdx]!.closeTime).toISOString(),
    disclaimer: DISCLAIMER,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && npx vitest run test/signal.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add core/src/signal.ts core/test/signal.test.ts
git commit -m "feat(core): add signal engine combining indicator votes"
```

---

## Task 8: Coins.ph client

**Files:**
- Create: `core/src/coinsClient.ts`
- Test: `core/test/coinsClient.smoke.test.ts`

**Interfaces:**
- Consumes: `Kline` from `core/src/types.ts`.
- Produces:
  ```ts
  class CoinsClient {
    constructor(opts?: { baseUrl?: string; fetchImpl?: typeof fetch; maxRetries?: number });
    getKlines(pair: string, interval: string, limit?: number): Promise<Kline[]>;
    getPrice(pair: string): Promise<number>;
    getPairs(): Promise<string[]>;
  }
  ```
  - Default `baseUrl`: `https://api.pro.coins.ph`.
  - `getKlines` hits `/openapi/quote/v1/klines?symbol={pair}&interval={interval}&limit={limit}` and maps each raw array row `[openTime, open, high, low, close, volume, closeTime, ...]` to a `Kline` (numeric fields parsed via `Number`).
  - On HTTP 429, retry after `Retry-After` header seconds (default 2s) up to `maxRetries` (default 3), then throw.
  - Non-2xx (other than handled 429) throws `Error` with status + body snippet.

- [ ] **Step 1: Write the failing test (unit + skippable smoke)**

```ts
// core/test/coinsClient.smoke.test.ts
import { describe, it, expect, vi } from "vitest";
import { CoinsClient } from "../src/coinsClient.js";

describe("CoinsClient (mocked)", () => {
  it("maps raw kline rows to Kline objects", async () => {
    const raw = [
      [1000, "10.0", "12.0", "9.0", "11.0", "5.0", 1999, "0", 0, "0", "0", "0"],
    ];
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(raw), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new CoinsClient({ fetchImpl });
    const klines = await client.getKlines("BTCPHP", "1h", 1);
    expect(klines).toEqual([
      { openTime: 1000, open: 10, high: 12, low: 9, close: 11, volume: 5, closeTime: 1999 },
    ]);
  });

  it("retries once on 429 then succeeds", async () => {
    const raw: unknown[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1)
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      return new Response(JSON.stringify(raw), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new CoinsClient({ fetchImpl, maxRetries: 3 });
    const klines = await client.getKlines("BTCPHP", "1h", 1);
    expect(klines).toEqual([]);
    expect(calls).toBe(2);
  });
});

// Live smoke test — skipped unless RUN_SMOKE=1 (needs network).
describe.skipIf(process.env.RUN_SMOKE !== "1")("CoinsClient (live)", () => {
  it("fetches real BTCPHP klines", async () => {
    const client = new CoinsClient();
    const klines = await client.getKlines("BTCPHP", "1h", 5);
    expect(klines.length).toBeGreaterThan(0);
    expect(typeof klines[0]!.close).toBe("number");
  }, 15000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd core && npx vitest run test/coinsClient.smoke.test.ts`
Expected: FAIL — cannot resolve `coinsClient.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// core/src/coinsClient.ts
import type { Kline } from "./types.js";

const DEFAULT_BASE = "https://api.pro.coins.ph";

export interface CoinsClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

export class CoinsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(opts: CoinsClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async getKlines(pair: string, interval: string, limit = 200): Promise<Kline[]> {
    const path = `/openapi/quote/v1/klines?symbol=${encodeURIComponent(
      pair,
    )}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const rows = (await this.getJson(path)) as unknown[][];
    return rows.map((r) => ({
      openTime: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closeTime: Number(r[6]),
    }));
  }

  async getPrice(pair: string): Promise<number> {
    const path = `/openapi/quote/v1/ticker/price?symbol=${encodeURIComponent(pair)}`;
    const body = (await this.getJson(path)) as { price: string };
    return Number(body.price);
  }

  async getPairs(): Promise<string[]> {
    const body = (await this.getJson("/openapi/v1/pairs")) as
      | { symbol: string }[]
      | { data: { symbol: string }[] };
    const list = Array.isArray(body) ? body : body.data;
    return list.map((p) => p.symbol);
  }

  private async getJson(path: string): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(this.baseUrl + path);
      if (res.status === 429 && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "2");
        attempt++;
        await sleep(retryAfter * 1000);
        continue;
      }
      if (!res.ok) {
        const snippet = (await res.text()).slice(0, 200);
        throw new Error(`Coins.ph ${res.status} for ${path}: ${snippet}`);
      }
      return res.json();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd core && npx vitest run test/coinsClient.smoke.test.ts`
Expected: PASS (2 mocked tests; live suite skipped).

- [ ] **Step 5: Commit**

```bash
git add core/src/coinsClient.ts core/test/coinsClient.smoke.test.ts
git commit -m "feat(core): add Coins.ph public API client with 429 backoff"
```

---

## Task 9: Public exports and full build

**Files:**
- Create: `core/src/index.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the public package surface — indicators, `generateSignal`, `calculateProfit`, `CoinsClient`, and all shared types.

- [ ] **Step 1: Create `core/src/index.ts`**

```ts
export * from "./types.js";
export { ema, rsi, macd, bollinger } from "./indicators/index.js";
export type { BollingerBands, MacdResult } from "./indicators/index.js";
export { generateSignal } from "./signal.js";
export { calculateProfit, type ProfitInput, type ProfitResult } from "./profit.js";
export { CoinsClient, type CoinsClientOptions } from "./coinsClient.js";
```

- [ ] **Step 2: Run the whole test suite**

Run: `cd core && npm test`
Expected: PASS — all test files green (indicators, signal, profit, coinsClient mocked).

- [ ] **Step 3: Typecheck and build**

Run: `cd core && npm run typecheck && npm run build`
Expected: `tsc --noEmit` exits 0; `tsup` emits `dist/index.js` and `dist/index.d.ts`.

- [ ] **Step 4: Commit**

```bash
git add core/src/index.ts
git commit -m "feat(core): expose public library surface"
```

---

## Self-Review Notes

**Spec coverage (design → task):**
- RSI/EMA/MACD/Bollinger indicators → Tasks 2–5. ✅
- Vote combination → trend + confidence + reasoning → Task 7. ✅
- `Signal` shape (pair, trend, confidence, reasoning, indicators, asOf) + visible disclaimer → Task 1 types + Task 7 (`DISCLAIMER`). ✅
- Profit calculator with user-editable fee % → Task 6. ✅
- Coins.ph public endpoints (klines, price, pairs) + 429 backoff → Task 8. ✅
- "Insufficient data" instead of a fabricated signal → Task 7 (`insufficient_data`). ✅
- Unit tests per indicator + profit + combination logic; skippable live smoke test → each task's tests + Task 8. ✅
- Zero-I/O-framework, single indicator implementation reused by web + mcp-server → whole `core` design. ✅

**Out of this plan (separate follow-up plans, per scope check):** `web` PWA + backend + scheduler + web-push + Postgres; `mcp-server`. Both import this `core`.

**Not yet wired here:** watchlist config, notifications, hosting, DB — these belong to the `web` plan since `core` is stateless by design. The 24hr ticker endpoint is listed in the spec but only needed by `web`'s dashboard; `getPrice`/`getKlines`/`getPairs` cover `core`'s needs. Add a `get24hr` method in the `web` plan if the dashboard requires it.
