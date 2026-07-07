# Swing Analyzer — Frontend Wiring Design

Date: 2026-07-08
Status: Approved (brainstorming)

## Context

The swing-signal backend is merged (PR #3): `core` analysis/risk/decision modules →
`web/src/analyzeService.ts` → `POST /api/analyze/:assetClass`. The frontend does not
yet consume it — `frontend/src/api.ts` wires signals, forecasts, profit, and watchlist,
but nothing calls `/api/analyze` and there is no analyzer UI. This spec covers wiring
the endpoint end-to-end into the React frontend. No backend changes.

## Endpoint recap

`POST /api/analyze/:assetClass` with a flat JSON body:

- `symbol: string` (required, non-empty)
- `interval?: string` (optional; server falls back to the asset-class default; must be an
  allowed interval for the provider)
- Account fields (parsed by `parseAccount`):
  - `equity: number` (required, finite)
  - `position?: { size: number; entryPrice: number } | null` (optional)
  - `lossToDate: { dayPct: number; weekPct: number }` (both required, finite)
  - `marketStatus?: "open" | "closed"` (optional)

Response: `SwingSignal`:

```ts
interface SwingSignal {
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;          // 0–100
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  position_size_pct: number;
  reasoning: string;
  risk_flags: string[];
}
```

Error envelopes (via the existing `request()` helper): `stocks_disabled` (503),
`invalid_interval` / `invalid_input` (400), plus network errors.

## Design

### 1. API + types layer

- **`types.ts`** — re-export `SwingSignal`, `SwingAction`, `AccountState` from
  `@coins-trend-advisor/core`, matching the existing `Signal`/`Forecast` re-export
  pattern. No hand-written duplicate interfaces.
- **`api.ts`** — add:

  ```ts
  export function postAnalyze(
    assetClass: AssetClass,
    body: { symbol: string; interval: string; account: AccountState },
  ): Promise<ApiResult<SwingSignal>>
  ```

  It POSTs a flat body `{ symbol, interval, ...account }` to
  `/api/analyze/${assetClass}` with `Content-Type: application/json`, reusing the shared
  `request()` helper so it inherits auth-token injection, the error-envelope unwrap, and
  network-error handling. This maps `stocks_disabled`/`invalid_interval`/`invalid_input`
  into the same `ApiResult` error shape the rest of the app already handles.

### 2. Components

Mirrors the existing `Lookup` (stateful section) + `SignalForecastCard` (pure render)
split.

- **`SwingAnalyzer.tsx`** — the section component. Props: `{ assetClass, interval }`.
  - Symbol input with `getPairs(assetClass)` datalist autocomplete (same as `Lookup`).
  - Account form: `equity`, `dayPct`, `weekPct` (required numbers); a collapsible
    optional "Open position" group (`size`, `entryPrice`); a market open/closed toggle
    defaulting to `open`.
  - Owns `loading` / `error` / `result` state.
  - On submit: builds the `AccountState` (empty position fields → `position: null`),
    calls `postAnalyze`, renders the result card.
  - Client-side guard mirroring the backend `finite` check: equity, dayPct, weekPct must
    parse to finite numbers before submit, else an inline validation message (no
    round-trip 400). If a position group is partially filled, both size and entryPrice
    must be finite; otherwise treat the position as unset.
- **`SwingDecisionCard.tsx`** — pure render of one `SwingSignal`. Props:
  `{ symbol, signal }`.
  - Action badge: BUY (positive), SELL (negative), HOLD (neutral).
  - Confidence percentage.
  - When `action !== "HOLD"`: an entry / stop-loss / take-profit / position-size grid
    (each value formatted; nulls shown as "—").
  - Always: the `reasoning` line, and `risk_flags` rendered as chips when present.
  - Reuses `.card` styling for visual parity with `SignalForecastCard`.

### 3. Wiring + styles

- **`App.tsx`** — new `<section className="section">` titled "Swing analysis" placed
  between "Look up a symbol" and "Watchlist", passing the existing `assetClass` and
  `interval` state. (No `horizon` — the analyzer does not forecast.)
- **`styles.css`** — additions for action-badge colors and the decision grid, following
  existing class-naming conventions.

### 4. Tests (Vitest + Testing Library, matching existing `frontend/src/test/`)

- `api.test.ts` — add a case: `postAnalyze` issues a POST to the correct URL with the
  flattened body and unwraps a success envelope; error envelope maps to `ok: false`.
- `SwingDecisionCard.test.tsx` — a BUY decision renders the entry/stop/TP grid; a HOLD
  decision hides the grid and shows reasoning + risk-flag chips.
- `SwingAnalyzer.test.tsx` — a valid submit calls the API and renders the card; invalid
  equity shows an inline error without calling the API; a `stocks_disabled` error renders
  the friendly "Stocks aren't configured" message (same wording as `Lookup`).

## Out of scope (YAGNI)

- No watchlist/batch swing analysis.
- No persistence of account inputs across reloads.
- No backend changes — the endpoint is complete.

## Success criteria

- A user can enter a symbol + account details in the Swing analysis section and see a
  BUY/SELL/HOLD decision card with reasoning and risk flags.
- Errors (stocks disabled, invalid interval/input, network) render friendly inline
  messages, not crashes.
- `npm test` and `npm run typecheck` pass across the workspace.
