import { useEffect, useState } from "react";
import type { AssetClass, SignalItem, ForecastItem } from "../types.js";
import { getSignal, getForecast, getPairs } from "../api.js";
import { SignalForecastCard } from "./SignalForecastCard.js";
import { ProfitCalculator } from "./ProfitCalculator.js";

export function Lookup({
  assetClass,
  interval,
  horizon,
}: {
  assetClass: AssetClass;
  interval: string;
  horizon: number;
}) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ symbol: string; signal?: SignalItem; forecast?: ForecastItem } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPairs(assetClass).then((r) => { if (!cancelled && r.ok) setSymbols(r.data.symbols); });
    return () => { cancelled = true; };
  }, [assetClass]);

  async function onLookup(e: React.FormEvent) {
    e.preventDefault();
    const symbol = query.trim().toUpperCase();
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const [s, f] = await Promise.all([
      getSignal(assetClass, symbol, interval),
      getForecast(assetClass, symbol, interval, horizon),
    ]);
    setLoading(false);
    if (!s.ok) { setError(s.error.code === "stocks_disabled" ? "Stocks aren't configured on this server." : s.error.message); return; }
    setResult({ symbol, signal: s.data, forecast: f.ok ? f.data : undefined });
  }

  return (
    <section className="lookup">
      <form className="lookup-form" onSubmit={onLookup}>
        <label htmlFor="lookup-symbol">Symbol</label>
        <input
          id="lookup-symbol" list="lookup-symbols" value={query}
          onChange={(e) => setQuery(e.target.value)} placeholder="e.g. BTCPHP" autoComplete="off"
        />
        <datalist id="lookup-symbols">
          {symbols.slice(0, 50).map((s) => <option key={s} value={s} />)}
        </datalist>
        <button type="submit">Look up</button>
      </form>
      {loading && <p className="muted">Looking up…</p>}
      {error && <p className="note error">{error}</p>}
      {result && (
        <>
          <SignalForecastCard symbol={result.symbol} signal={result.signal} forecast={result.forecast} />
          <ProfitCalculator
            symbol={result.symbol}
            targetPrice={result.forecast?.forecast?.predicted}
          />
        </>
      )}
    </section>
  );
}
