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

  // A position needs both fields; if only one is filled it's silently treated as
  // unset, so hint the user to complete it (non-blocking — analysis still runs).
  const partialPosition = (posSize.trim() !== "") !== (posEntry.trim() !== "");

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
      setError("Enter valid numbers for the account fields above.");
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
          {partialPosition && (
            <p className="note swing-position-hint">Enter both size and entry price to include your open position.</p>
          )}
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
