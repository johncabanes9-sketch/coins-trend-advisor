# Swing Analyzer Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the merged `POST /api/analyze/:assetClass` swing-signal endpoint into the React frontend as a dedicated "Swing analysis" section.

**Architecture:** Add a `postAnalyze` call to the shared API layer, a pure `SwingDecisionCard` renderer, and a stateful `SwingAnalyzer` section (symbol + account form), then mount it in `App.tsx`. Mirrors the existing `Lookup` (stateful) + `SignalForecastCard` (pure) split. No backend changes.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + @testing-library/react, existing `@coins-trend-advisor/core` type barrel.

## Global Constraints

- Language: TypeScript, ESM (`.js` import specifiers for local modules, matching the codebase).
- Types come from `@coins-trend-advisor/core` — re-export, do not duplicate.
- All network calls go through the existing `request()` helper in `frontend/src/api.ts` (auth token, error envelope, network-error handling).
- Tests: Vitest globals via `vi`, render with `@testing-library/react`, interact with `@testing-library/user-event`. Match the style in `frontend/src/test/`.
- Reuse existing CSS: `.card`, `.card-head`, `.note`, `.note.error`, `.muted`, and the `--buy` / `--sell` / `--hold` tone variables (see `.trend-badge`).
- Not financial advice — no persistence, no batch analysis, no backend edits.

---

### Task 1: API layer — `postAnalyze` + type re-exports

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Test: `frontend/src/test/api.test.ts`

**Interfaces:**
- Consumes: `request<T>()`, `ApiResult<T>`, `AssetClass` (existing in `api.ts` / `types.ts`); `SwingSignal`, `SwingAction`, `AccountState` from `@coins-trend-advisor/core`.
- Produces:
  - `types.ts` re-exports `SwingSignal`, `SwingAction`, `AccountState`.
  - `postAnalyze(assetClass: AssetClass, body: { symbol: string; interval: string; account: AccountState }): Promise<ApiResult<SwingSignal>>` — POSTs the flat body `{ symbol, interval, ...account }` to `/api/analyze/${assetClass}`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/test/api.test.ts` inside the `describe("api client", ...)` block:

```ts
it("posts analyze as a flat body with symbol, interval and account fields", async () => {
  const signal = {
    action: "BUY", confidence: 72, entry_price: 100, stop_loss: 95,
    take_profit: 110, position_size_pct: 0.1, reasoning: "uptrend", risk_flags: [],
  };
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(signal));
  vi.stubGlobal("fetch", fetchMock);
  const r = await api.postAnalyze("crypto", {
    symbol: "BTCPHP",
    interval: "1h",
    account: { equity: 10000, position: null, lossToDate: { dayPct: 0, weekPct: 0 }, marketStatus: "open" },
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok");
  expect(r.data.action).toBe("BUY");
  expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/analyze/crypto");
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  expect(init.method).toBe("POST");
  const sent = JSON.parse(String(init.body));
  expect(sent.symbol).toBe("BTCPHP");
  expect(sent.interval).toBe("1h");
  expect(sent.equity).toBe(10000);
  expect(sent.lossToDate.dayPct).toBe(0);
  expect(sent.marketStatus).toBe("open");
});

it("maps an invalid_interval 400 from analyze into an error result", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { code: "invalid_interval", message: "bad" } }, 400)));
  const r = await api.postAnalyze("crypto", {
    symbol: "BTCPHP", interval: "9z",
    account: { equity: 1, position: null, lossToDate: { dayPct: 0, weekPct: 0 } },
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected error");
  expect(r.error.code).toBe("invalid_interval");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w frontend -- api.test.ts`
Expected: FAIL — `api.postAnalyze is not a function`.

- [ ] **Step 3: Add the type re-exports**

In `frontend/src/types.ts`, extend the first import + re-export line:

```ts
import type { AssetClass, Signal, Forecast, SwingSignal, SwingAction, AccountState } from "@coins-trend-advisor/core";

export type { AssetClass, Signal, Forecast, SwingSignal, SwingAction, AccountState };
```

- [ ] **Step 4: Implement `postAnalyze`**

In `frontend/src/api.ts`, add `SwingSignal` and `AccountState` to the type import from `./types.js`, then add at the end of the file:

```ts
export function postAnalyze(
  assetClass: AssetClass,
  body: { symbol: string; interval: string; account: AccountState },
): Promise<ApiResult<SwingSignal>> {
  return request(`/api/analyze/${assetClass}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: body.symbol, interval: body.interval, ...body.account }),
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w frontend -- api.test.ts`
Expected: PASS (all cases, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/test/api.test.ts
git commit -m "feat(frontend): postAnalyze API client for swing-signal endpoint"
```

---

### Task 2: `SwingDecisionCard` — pure decision renderer

**Files:**
- Create: `frontend/src/components/SwingDecisionCard.tsx`
- Test: `frontend/src/test/SwingDecisionCard.test.tsx`

**Interfaces:**
- Consumes: `SwingSignal` from `../types.js`.
- Produces: `SwingDecisionCard({ symbol, signal }: { symbol: string; signal: SwingSignal }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/SwingDecisionCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { SwingDecisionCard } from "../components/SwingDecisionCard.js";
import type { SwingSignal } from "../types.js";

const buy: SwingSignal = {
  action: "BUY", confidence: 72, entry_price: 100, stop_loss: 95,
  take_profit: 110, position_size_pct: 0.1, reasoning: "Uptrend aligned.", risk_flags: [],
};

const hold: SwingSignal = {
  action: "HOLD", confidence: 0, entry_price: null, stop_loss: null,
  take_profit: null, position_size_pct: 0, reasoning: "Sideways structure.",
  risk_flags: ["divergence risk"],
};

it("renders a BUY decision with the entry/stop/take-profit grid", () => {
  render(<SwingDecisionCard symbol="BTCPHP" signal={buy} />);
  expect(screen.getByText("BUY")).toHaveAttribute("data-trend", "buy");
  expect(screen.getByText(/72%/)).toBeInTheDocument();
  expect(screen.getByText(/Uptrend aligned/)).toBeInTheDocument();
  expect(screen.getByText(/Entry/i)).toBeInTheDocument();
  expect(screen.getByText("100")).toBeInTheDocument();
  expect(screen.getByText("110")).toBeInTheDocument();
});

it("renders a HOLD decision without the grid, showing reasoning and risk flags", () => {
  render(<SwingDecisionCard symbol="BTCPHP" signal={hold} />);
  expect(screen.getByText("HOLD")).toHaveAttribute("data-trend", "hold");
  expect(screen.queryByText(/Entry/i)).not.toBeInTheDocument();
  expect(screen.getByText(/Sideways structure/)).toBeInTheDocument();
  expect(screen.getByText(/divergence risk/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w frontend -- SwingDecisionCard`
Expected: FAIL — cannot find module `../components/SwingDecisionCard.js`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/SwingDecisionCard.tsx`:

```tsx
import type { SwingSignal } from "../types.js";

function fmt(value: number | null): string {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function SwingDecisionCard({ symbol, signal }: { symbol: string; signal: SwingSignal }) {
  const tone = signal.action.toLowerCase(); // "buy" | "sell" | "hold"
  const actionable = signal.action !== "HOLD";
  return (
    <article className="card swing-card">
      <header className="card-head">
        <h3>{symbol}</h3>
        <span className="trend-badge" data-trend={tone}>{signal.action}</span>
        <span className="swing-confidence">{Math.round(signal.confidence)}%</span>
      </header>

      {actionable && (
        <dl className="indicators swing-levels">
          <div><dt>Entry</dt><dd>{fmt(signal.entry_price)}</dd></div>
          <div><dt>Stop loss</dt><dd>{fmt(signal.stop_loss)}</dd></div>
          <div><dt>Take profit</dt><dd>{fmt(signal.take_profit)}</dd></div>
          <div><dt>Size</dt><dd>{Math.round(signal.position_size_pct * 100)}%</dd></div>
        </dl>
      )}

      <p className="note">{signal.reasoning}</p>

      {signal.risk_flags.length > 0 && (
        <ul className="risk-flags">
          {signal.risk_flags.map((f) => <li key={f} className="risk-flag">{f}</li>)}
        </ul>
      )}
    </article>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w frontend -- SwingDecisionCard`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SwingDecisionCard.tsx frontend/src/test/SwingDecisionCard.test.tsx
git commit -m "feat(frontend): SwingDecisionCard renders BUY/SELL/HOLD decisions"
```

---

### Task 3: `SwingAnalyzer` — symbol + account form section

**Files:**
- Create: `frontend/src/components/SwingAnalyzer.tsx`
- Test: `frontend/src/test/SwingAnalyzer.test.tsx`

**Interfaces:**
- Consumes: `getPairs`, `postAnalyze` from `../api.js`; `SwingDecisionCard` from `./SwingDecisionCard.js`; `AssetClass`, `AccountState`, `SwingSignal` from `../types.js`.
- Produces: `SwingAnalyzer({ assetClass, interval }: { assetClass: AssetClass; interval: string }): JSX.Element`.

**Behavior notes:**
- Equity, day loss %, week loss % are required and must parse to finite numbers; otherwise show an inline validation message and do NOT call the API (mirrors backend `finite`).
- The "Open position" group is optional: if BOTH size and entry price are finite, send `position: { size, entryPrice }`; otherwise send `position: null`.
- Market status toggle defaults to `"open"`.
- On `stocks_disabled` error, show "Stocks aren't configured on this server." (same wording as `Lookup`); otherwise show `error.message`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/SwingAnalyzer.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { SwingAnalyzer } from "../components/SwingAnalyzer.js";
import * as api from "../api.js";

const okSignal = {
  ok: true as const,
  data: {
    action: "BUY" as const, confidence: 70, entry_price: 100, stop_loss: 95,
    take_profit: 110, position_size_pct: 0.1, reasoning: "Uptrend.", risk_flags: [],
  },
};

beforeEach(() => {
  vi.spyOn(api, "getPairs").mockResolvedValue({ ok: true, data: { assetClass: "crypto", symbols: ["BTCPHP"] } });
});

it("submits symbol + account and renders the decision card", async () => {
  const spy = vi.spyOn(api, "postAnalyze").mockResolvedValue(okSignal);
  render(<SwingAnalyzer assetClass="crypto" interval="1h" />);
  await userEvent.type(screen.getByLabelText(/symbol/i), "BTCPHP");
  await userEvent.clear(screen.getByLabelText(/equity/i));
  await userEvent.type(screen.getByLabelText(/equity/i), "10000");
  await userEvent.click(screen.getByRole("button", { name: /analy/i }));
  await waitFor(() => expect(screen.getByText("BUY")).toBeInTheDocument());
  expect(spy).toHaveBeenCalledOnce();
  const [, body] = spy.mock.calls[0]!;
  expect(body.symbol).toBe("BTCPHP");
  expect(body.account.equity).toBe(10000);
  expect(body.account.position).toBeNull();
});

it("blocks submit with an inline error when equity is not finite", async () => {
  const spy = vi.spyOn(api, "postAnalyze").mockResolvedValue(okSignal);
  render(<SwingAnalyzer assetClass="crypto" interval="1h" />);
  await userEvent.type(screen.getByLabelText(/symbol/i), "BTCPHP");
  await userEvent.clear(screen.getByLabelText(/equity/i));
  await userEvent.click(screen.getByRole("button", { name: /analy/i }));
  expect(await screen.findByText(/equity/i)).toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});

it("shows the friendly message when stocks are disabled", async () => {
  vi.spyOn(api, "postAnalyze").mockResolvedValue({ ok: false, error: { code: "stocks_disabled", message: "off" } });
  render(<SwingAnalyzer assetClass="stock" interval="D" />);
  await userEvent.type(screen.getByLabelText(/symbol/i), "AAPL");
  await userEvent.clear(screen.getByLabelText(/equity/i));
  await userEvent.type(screen.getByLabelText(/equity/i), "10000");
  await userEvent.click(screen.getByRole("button", { name: /analy/i }));
  await waitFor(() => expect(screen.getByText(/stocks aren't configured/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w frontend -- SwingAnalyzer`
Expected: FAIL — cannot find module `../components/SwingAnalyzer.js`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/SwingAnalyzer.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { AssetClass, AccountState, SwingSignal } from "../types.js";
import { getPairs, postAnalyze } from "../api.js";
import { SwingDecisionCard } from "./SwingDecisionCard.js";

function num(s: string): number {
  return s.trim() === "" ? NaN : Number(s);
}

export function SwingAnalyzer({ assetClass, interval }: { assetClass: AssetClass; interval: string }) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [equity, setEquity] = useState("10000");
  const [dayPct, setDayPct] = useState("0");
  const [weekPct, setWeekPct] = useState("0");
  const [posSize, setPosSize] = useState("");
  const [posEntry, setPosEntry] = useState("");
  const [market, setMarket] = useState<"open" | "closed">("open");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ symbol: string; signal: SwingSignal } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPairs(assetClass).then((r) => { if (!cancelled && r.ok) setSymbols(r.data.symbols); });
    return () => { cancelled = true; };
  }, [assetClass]);

  async function onAnalyze(e: React.FormEvent) {
    e.preventDefault();
    const symbol = query.trim().toUpperCase();
    if (!symbol) return;

    const eq = num(equity), day = num(dayPct), week = num(weekPct);
    if (!Number.isFinite(eq) || !Number.isFinite(day) || !Number.isFinite(week)) {
      setError("Equity, day loss % and week loss % must all be numbers.");
      setResult(null);
      return;
    }

    const size = num(posSize), entry = num(posEntry);
    const position: AccountState["position"] =
      Number.isFinite(size) && Number.isFinite(entry) ? { size, entryPrice: entry } : null;

    const account: AccountState = {
      equity: eq, position, lossToDate: { dayPct: day, weekPct: week }, marketStatus: market,
    };

    setLoading(true);
    setError(null);
    setResult(null);
    const r = await postAnalyze(assetClass, { symbol, interval, account });
    setLoading(false);
    if (!r.ok) {
      setError(r.error.code === "stocks_disabled" ? "Stocks aren't configured on this server." : r.error.message);
      return;
    }
    setResult({ symbol, signal: r.data });
  }

  return (
    <section className="lookup swing-analyzer">
      <form className="lookup-form swing-form" onSubmit={onAnalyze}>
        <label htmlFor="swing-symbol">Symbol</label>
        <input
          id="swing-symbol" list="swing-symbols" value={query}
          onChange={(e) => setQuery(e.target.value)} placeholder="e.g. BTCPHP" autoComplete="off"
        />
        <datalist id="swing-symbols">
          {symbols.slice(0, 50).map((s) => <option key={s} value={s} />)}
        </datalist>

        <label htmlFor="swing-equity">Equity</label>
        <input id="swing-equity" inputMode="decimal" value={equity} onChange={(e) => setEquity(e.target.value)} />

        <label htmlFor="swing-day">Day loss %</label>
        <input id="swing-day" inputMode="decimal" value={dayPct} onChange={(e) => setDayPct(e.target.value)} />

        <label htmlFor="swing-week">Week loss %</label>
        <input id="swing-week" inputMode="decimal" value={weekPct} onChange={(e) => setWeekPct(e.target.value)} />

        <details className="swing-position">
          <summary>Open position (optional)</summary>
          <label htmlFor="swing-size">Size</label>
          <input id="swing-size" inputMode="decimal" value={posSize} onChange={(e) => setPosSize(e.target.value)} />
          <label htmlFor="swing-entry">Entry price</label>
          <input id="swing-entry" inputMode="decimal" value={posEntry} onChange={(e) => setPosEntry(e.target.value)} />
        </details>

        <label htmlFor="swing-market">Market</label>
        <select id="swing-market" value={market} onChange={(e) => setMarket(e.target.value as "open" | "closed")}>
          <option value="open">open</option>
          <option value="closed">closed</option>
        </select>

        <button type="submit">Analyze</button>
      </form>
      {loading && <p className="muted">Analyzing…</p>}
      {error && <p className="note error">{error}</p>}
      {result && <SwingDecisionCard symbol={result.symbol} signal={result.signal} />}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w frontend -- SwingAnalyzer`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SwingAnalyzer.tsx frontend/src/test/SwingAnalyzer.test.tsx
git commit -m "feat(frontend): SwingAnalyzer section with account form"
```

---

### Task 4: Mount the section in `App.tsx` + styles

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/test/App.test.tsx`

**Interfaces:**
- Consumes: `SwingAnalyzer` from `./components/SwingAnalyzer.js`; existing `assetClass` / `interval` state in `App`.
- Produces: a "Swing analysis" `<section>` in the app between "Look up a symbol" and "Watchlist".

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/test/App.test.tsx` (place near the other section assertions; keep existing mocks intact):

```tsx
it("renders the Swing analysis section", async () => {
  render(<App />);
  expect(await screen.findByText(/swing analysis/i)).toBeInTheDocument();
});
```

Note: if `App.test.tsx` does not already stub `getPairs`, add `vi.spyOn(api, "getPairs").mockResolvedValue({ ok: true, data: { assetClass: "crypto", symbols: [] } });` in its `beforeEach` so the new section's mount effect does not hit the network. (Check the file first — it likely already mocks the API module.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w frontend -- App.test`
Expected: FAIL — "Swing analysis" text not found.

- [ ] **Step 3: Wire the section into `App.tsx`**

Add the import alongside the other component imports:

```tsx
import { SwingAnalyzer } from "./components/SwingAnalyzer.js";
```

Insert this `<section>` between the "Look up a symbol" section and the "Watchlist" section:

```tsx
      <section className="section">
        <h2 className="section-title">Swing analysis</h2>
        <SwingAnalyzer assetClass={assetClass} interval={interval} />
      </section>
```

- [ ] **Step 4: Add styles**

Append to `frontend/src/styles.css`:

```css
/* ---- swing analyzer ---- */
.swing-form { flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
.swing-form label { font-size: 0.85rem; color: var(--muted); }
.swing-form input, .swing-form select { max-width: 8rem; }
.swing-position { width: 100%; }
.swing-position summary { cursor: pointer; font-size: 0.85rem; color: var(--muted); }
.swing-confidence { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--muted); }
.swing-levels { margin-top: 0.5rem; }
.risk-flags { display: flex; flex-wrap: wrap; gap: 0.35rem; list-style: none; padding: 0; margin: 0.5rem 0 0; }
.risk-flag {
  font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 999px;
  background: color-mix(in srgb, var(--sell) 15%, transparent); color: var(--sell);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w frontend -- App.test`
Expected: PASS.

- [ ] **Step 6: Full workspace verification**

Run: `npm test -w frontend`
Expected: PASS (all frontend suites).

Run: `npm run typecheck -w frontend`
Expected: no type errors.

Run: `npm run build -w frontend`
Expected: successful production build.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/styles.css frontend/src/test/App.test.tsx
git commit -m "feat(frontend): mount Swing analysis section and styles"
```

---

## Self-Review

**Spec coverage:**
- API layer (`postAnalyze` + type re-exports) → Task 1. ✓
- `SwingDecisionCard` pure renderer → Task 2. ✓
- `SwingAnalyzer` section with full account form (equity/loss%, optional position, market toggle), client-side finite guard, stocks-disabled message → Task 3. ✓
- `App.tsx` wiring + styles → Task 4. ✓
- Tests for api / card / analyzer / app → Tasks 1–4. ✓
- Out-of-scope items (no batch, no persistence, no backend edits) respected. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `postAnalyze(assetClass, { symbol, interval, account })` signature identical in Task 1 (definition), Task 3 (call), and tests. `AccountState` fields (`equity`, `position`, `lossToDate.{dayPct,weekPct}`, `marketStatus`) match `core/src/risk.ts`. `SwingSignal` fields (`action`, `confidence`, `entry_price`, `stop_loss`, `take_profit`, `position_size_pct`, `reasoning`, `risk_flags`) match `core/src/decision.ts`. `SwingDecisionCard({ symbol, signal })` props identical in Task 2 and Task 3. ✓
