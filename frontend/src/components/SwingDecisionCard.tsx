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
