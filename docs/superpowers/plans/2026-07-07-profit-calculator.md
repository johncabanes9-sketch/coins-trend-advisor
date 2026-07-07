# Profit Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline profit calculator to the symbol lookup so a user can enter a deposit and see the projected profit if the price reaches the forecast target.

**Architecture:** A new `ProfitCalculator` React component renders inside `Lookup` below the `SignalForecastCard`. It computes results live, client-side, by importing the existing `calculateProfit` from `@coins-trend-advisor/core` (no server round-trip). The forecast's `predicted` price prefills the target field.

**Tech Stack:** React 18, TypeScript, Vitest + @testing-library/react, existing CSS in `frontend/src/styles.css`.

## Global Constraints

- All commands run from the `frontend/` directory unless noted.
- Test runner: `npm test` (`vitest run`). Watch: `npm run test:watch`.
- Component files use `.js` import specifiers for local modules (e.g. `import { X } from "./X.js"`) — this is the established ESM convention in this codebase.
- Do NOT modify the backend, the `/api/profit` route, or `postProfit()`.
- Reuse existing CSS color variables: `--buy` (positive/green), `--sell` (negative/red), `--muted`, `--border`, `--text`, `--accent`.

---

### Task 1: ProfitCalculator component

**Files:**
- Create: `frontend/src/components/ProfitCalculator.tsx`
- Test: `frontend/src/test/ProfitCalculator.test.tsx`

**Interfaces:**
- Consumes: `calculateProfit` from `@coins-trend-advisor/core` with signature
  `calculateProfit(input: { entryPrice: number; positionSize: number; targetPrice: number; feePct: number }): { grossProfit: number; feesPaid: number; netProfit: number; netProfitPct: number }`.
- Produces: `ProfitCalculator({ symbol: string; targetPrice?: number })` — a named React component export.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/test/ProfitCalculator.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfitCalculator } from "../components/ProfitCalculator.js";

it("prefills target from the forecast and defaults fee to 0.25", () => {
  render(<ProfitCalculator symbol="BTCPHP" targetPrice={110} />);
  expect(screen.getByLabelText(/target price/i)).toHaveValue("110");
  expect(screen.getByLabelText(/fee/i)).toHaveValue("0.25");
});

it("computes net profit live from deposit + entry against the target", async () => {
  const { container } = render(<ProfitCalculator symbol="BTCPHP" targetPrice={110} />);
  await userEvent.type(screen.getByLabelText(/deposit/i), "10000");
  await userEvent.type(screen.getByLabelText(/entry price/i), "100");
  // units=100, proceeds=11000, gross=1000, fees=21000*0.0025=52.5, net=947.5, pct=9.475
  expect(screen.getByText(/\+947\.5 PHP \(\+9\.5%\)/)).toBeInTheDocument();
  expect(container.querySelector(".profit-result")).toHaveAttribute("data-sign", "positive");
});

it("marks a loss as negative", async () => {
  const { container } = render(<ProfitCalculator symbol="BTCPHP" targetPrice={100} />);
  await userEvent.type(screen.getByLabelText(/deposit/i), "10000");
  await userEvent.type(screen.getByLabelText(/entry price/i), "110");
  expect(container.querySelector(".profit-result")).toHaveAttribute("data-sign", "negative");
});

it("shows no result until inputs are valid positive numbers", () => {
  const { container } = render(<ProfitCalculator symbol="BTCPHP" targetPrice={110} />);
  expect(container.querySelector(".profit-result")).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- ProfitCalculator`
Expected: FAIL — cannot resolve `../components/ProfitCalculator.js` / component not defined.

- [ ] **Step 3: Write the component**

Create `frontend/src/components/ProfitCalculator.tsx`:

```tsx
import { useEffect, useState } from "react";
import { calculateProfit } from "@coins-trend-advisor/core";

const QUOTES = ["USDT", "USDC", "PHP", "USD", "BTC", "ETH"];

function quoteCurrency(symbol: string): string {
  const upper = symbol.toUpperCase();
  return QUOTES.find((q) => upper.endsWith(q) && upper.length > q.length) ?? "";
}

export function ProfitCalculator({
  symbol,
  targetPrice,
}: {
  symbol: string;
  targetPrice?: number;
}) {
  const [deposit, setDeposit] = useState("");
  const [entry, setEntry] = useState("");
  const [target, setTarget] = useState(targetPrice != null ? String(targetPrice) : "");
  const [fee, setFee] = useState("0.25");

  useEffect(() => {
    setTarget(targetPrice != null ? String(targetPrice) : "");
  }, [targetPrice]);

  const depositN = Number(deposit);
  const entryN = Number(entry);
  const targetN = Number(target);
  const feeN = Number(fee);

  const valid =
    deposit !== "" && entry !== "" && target !== "" && fee !== "" &&
    Number.isFinite(depositN) && depositN > 0 &&
    Number.isFinite(entryN) && entryN > 0 &&
    Number.isFinite(targetN) &&
    Number.isFinite(feeN) && feeN >= 0;

  let result: ReturnType<typeof calculateProfit> | null = null;
  if (valid) {
    try {
      result = calculateProfit({
        entryPrice: entryN,
        positionSize: depositN,
        targetPrice: targetN,
        feePct: feeN,
      });
    } catch {
      result = null;
    }
  }

  const quote = quoteCurrency(symbol);
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const signed = (n: number) => (n >= 0 ? "+" : "") + fmt(n);

  return (
    <section className="profit-calc">
      <h4 className="profit-calc-title">Profit calculator</h4>
      <div className="profit-calc-grid">
        <label>Deposit
          <input inputMode="decimal" value={deposit} placeholder="0"
            onChange={(e) => setDeposit(e.target.value)} />
        </label>
        <label>Entry price
          <input inputMode="decimal" value={entry} placeholder="0"
            onChange={(e) => setEntry(e.target.value)} />
        </label>
        <label>Target price
          <input inputMode="decimal" value={target} placeholder="0"
            onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label>Fee %
          <input inputMode="decimal" value={fee}
            onChange={(e) => setFee(e.target.value)} />
        </label>
      </div>
      {result && (
        <div className="profit-result" data-sign={result.netProfit >= 0 ? "positive" : "negative"}>
          <div className="profit-net">
            {signed(result.netProfit)} {quote} ({result.netProfitPct >= 0 ? "+" : ""}
            {result.netProfitPct.toFixed(1)}%)
          </div>
          <div className="profit-detail">
            <span>Gross {fmt(result.grossProfit)} {quote}</span>
            <span>Fees {fmt(result.feesPaid)} {quote}</span>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- ProfitCalculator`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ProfitCalculator.tsx frontend/src/test/ProfitCalculator.test.tsx
git commit -m "feat(frontend): ProfitCalculator component with live client-side calc"
```

---

### Task 2: Wire into Lookup and style

**Files:**
- Modify: `frontend/src/components/Lookup.tsx`
- Modify: `frontend/src/test/Lookup.test.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `ProfitCalculator({ symbol, targetPrice })` from Task 1; `result.forecast?.forecast?.predicted` (a `number | undefined`) from `Lookup`'s existing `result` state.

- [ ] **Step 1: Write the failing integration test**

Add to `frontend/src/test/Lookup.test.tsx` (new `it` block, keep existing imports):

```tsx
it("shows the profit calculator after a lookup, target prefilled from the forecast", async () => {
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
  await waitFor(() => expect(screen.getByText(/profit calculator/i)).toBeInTheDocument());
  expect(screen.getByLabelText(/target price/i)).toHaveValue("100");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- Lookup`
Expected: FAIL — "profit calculator" text not found (component not yet rendered).

- [ ] **Step 3: Wire ProfitCalculator into Lookup**

In `frontend/src/components/Lookup.tsx`, add the import near the other component import:

```tsx
import { SignalForecastCard } from "./SignalForecastCard.js";
import { ProfitCalculator } from "./ProfitCalculator.js";
```

Replace the final result render line:

```tsx
      {result && <SignalForecastCard symbol={result.symbol} signal={result.signal} forecast={result.forecast} />}
```

with:

```tsx
      {result && (
        <>
          <SignalForecastCard symbol={result.symbol} signal={result.signal} forecast={result.forecast} />
          <ProfitCalculator
            symbol={result.symbol}
            targetPrice={result.forecast?.forecast?.predicted}
          />
        </>
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- Lookup`
Expected: PASS (both the existing test and the new one).

- [ ] **Step 5: Add styling**

Append to `frontend/src/styles.css`:

```css
.profit-calc {
  margin-top: 0.75rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.profit-calc-title {
  margin: 0 0 0.6rem;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.profit-calc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.6rem;
}
.profit-calc-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--muted);
}
.profit-calc-grid input {
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 0.9rem;
}
.profit-calc-grid input:focus {
  outline: 2px solid var(--accent);
}
.profit-result {
  margin-top: 0.8rem;
}
.profit-net {
  font-size: 1.15rem;
  font-weight: 700;
}
.profit-result[data-sign="positive"] .profit-net { color: var(--buy); }
.profit-result[data-sign="negative"] .profit-net { color: var(--sell); }
.profit-detail {
  display: flex;
  gap: 1rem;
  margin-top: 0.2rem;
  font-size: 0.78rem;
  color: var(--muted);
}
```

- [ ] **Step 6: Run the full frontend suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new ProfitCalculator and Lookup tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Lookup.tsx frontend/src/test/Lookup.test.tsx frontend/src/styles.css
git commit -m "feat(frontend): show ProfitCalculator inline in Lookup result"
```

---

## Self-Review

**Spec coverage:**
- Inline placement below SignalForecastCard — Task 2 Step 3. ✓
- Target prefilled from forecast, editable — Task 1 (state + useEffect), Task 2 test asserts prefill. ✓
- Deposit / entry / fee (default 0.25) inputs — Task 1 component + tests. ✓
- Client-side `calculateProfit`, no per-keystroke server call — Task 1 Step 3. ✓
- Net profit amount + % with green/red coloring; gross + fees secondary — Task 1 render + CSS in Task 2. ✓
- Invalid/incomplete input shows nothing, no error text — Task 1 `valid` guard + test. ✓
- Quote-currency label derived from symbol suffix — `quoteCurrency()` in Task 1. ✓
- No backend / `/api/profit` / `postProfit` changes — respected (Global Constraints). ✓

**Placeholder scan:** No TBD/TODO; all code and commands are concrete. ✓

**Type consistency:** `ProfitCalculator({ symbol, targetPrice })` prop shape matches between Task 1 definition and Task 2 usage; `calculateProfit` input keys (`entryPrice`, `positionSize`, `targetPrice`, `feePct`) match `core/src/profit.ts`. ✓
