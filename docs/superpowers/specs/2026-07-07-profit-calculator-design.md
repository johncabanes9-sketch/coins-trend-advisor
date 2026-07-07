# Profit Calculator — Design

Date: 2026-07-07
Status: Approved

## Problem

A user who deposits money on the platform wants to know: "If I put in this
much, how much will I profit?" The app already produces a forecast (a predicted
future price) for a symbol, but there is no way to translate that into an
expected peso profit for a given deposit.

The backend already has everything needed for the math:

- `calculateProfit(input: ProfitInput): ProfitResult` in `core/src/profit.ts`
  computes gross profit, fees paid, net profit, and net profit %.
- `POST /api/profit` route (`web/src/routes/profit.ts`) and the frontend
  `postProfit()` client (`frontend/src/api.ts`) already wrap it.

What is missing is a **frontend UI** that lets the user enter their deposit and
see the projected profit, wired to the forecast they just looked up.

## Approach

Add a `ProfitCalculator` React component rendered **inline in the Lookup
result**, directly below the `SignalForecastCard`. It reuses the forecast that
`Lookup` already fetched (no extra network request) to prefill the target price.

Computation runs **client-side** by importing `calculateProfit` from
`@coins-trend-advisor/core` (the frontend already depends on this package for
types). This makes the result update live as the user types, with no server
round-trip per keystroke. The existing `/api/profit` route and `postProfit()`
client remain untouched for other consumers.

### Why client-side instead of the API

A profit calculator is a "type and see" interaction. Calling `/api/profit` on
every change would add latency and network-failure states to a pure arithmetic
operation. `calculateProfit` is a small deterministic function already exported
from core, so importing it directly is simpler and instant.

## Component

`frontend/src/components/ProfitCalculator.tsx`

### Props

```ts
interface ProfitCalculatorProps {
  symbol: string;            // e.g. "BTCPHP" — used to derive quote-currency label
  targetPrice?: number;      // forecast.predicted, if the lookup returned a forecast
}
```

### Inputs (local state)

| Field        | Initial value                          | Editable | Maps to           |
|--------------|----------------------------------------|----------|-------------------|
| Deposit      | empty                                  | yes      | `positionSize`    |
| Entry price  | empty                                  | yes      | `entryPrice`      |
| Target price | `targetPrice` prop if present, else "" | yes      | `targetPrice`     |
| Fee %        | `0.25`                                  | yes      | `feePct`          |

- Target is prefilled from the forecast but stays editable, so the user can try
  the optimistic/pessimistic band or supply a target when no forecast exists.
- When the `targetPrice` prop changes (a new lookup), the target field resets to
  the new predicted value.

### Computation & validation

- On any input change, parse the four fields as numbers.
- A result is computed only when `deposit`, `entryPrice`, and `targetPrice` are
  finite and `entryPrice > 0` and `deposit > 0`, and `feePct` is a finite number
  `>= 0`. Otherwise the output area shows nothing (no error text).
- Call `calculateProfit({ entryPrice, positionSize: deposit, targetPrice, feePct })`.
  Wrap in try/catch; on the (already-guarded) throw, render nothing.

### Output

- **Net profit**: amount + percentage, e.g. `+3,082 PHP (+30.8%)`.
  - Green when `netProfit >= 0`, red when negative.
- Secondary smaller lines: gross profit and fees paid.
- Quote-currency label derived from the symbol suffix (e.g. `BTCPHP` → `PHP`);
  fallback to no label if it cannot be derived.
- Numbers formatted with thousands separators (`Intl.NumberFormat`).

## Integration

`frontend/src/components/Lookup.tsx`:

- When `result` is set, render `<ProfitCalculator symbol={result.symbol}
  targetPrice={result.forecast?.forecast?.predicted} />` immediately after
  `<SignalForecastCard />`.
- No other changes to `Lookup`'s fetch logic.

## Styling

Follow the existing trading-terminal visual language (reuse card/section classes
already in the stylesheet; add minimal new classes for the calculator grid and
the positive/negative profit colors, consistent with how trend up/down is
already colored).

## Testing (TDD)

`frontend/src/test/ProfitCalculator.test.tsx`:

1. Given a known deposit, entry, target, and fee, renders the correct net
   profit amount and percentage (value checked against `calculateProfit`).
2. Target field is prefilled from the `targetPrice` prop.
3. Fee field defaults to `0.25`.
4. Negative projected profit (target below entry) is rendered with the
   negative/red styling.
5. Incomplete or invalid input (e.g. empty deposit, or entry = 0) renders no
   result and no error text.

## Out of scope (YAGNI)

- No saving, history, or persistence of calculations.
- No live current-price fetch (entry price stays a manual input).
- No multi-currency conversion — only a derived label on the quote currency.
- No changes to the backend, the `/api/profit` route, or `postProfit()`.
