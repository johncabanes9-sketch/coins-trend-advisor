import { useCallback } from "react";
import type { AssetClass, SignalItem, ForecastItem } from "../types.js";
import { getSignals, getForecasts } from "../api.js";
import { useAsync } from "../useAsync.js";
import { SignalForecastCard } from "./SignalForecastCard.js";
import { StocksDisabled } from "./StocksDisabled.js";

interface Row { symbol: string; signal?: SignalItem; forecast?: ForecastItem }

export function Dashboard({
  assetClass,
  interval,
  horizon,
}: {
  assetClass: AssetClass;
  interval: string;
  horizon: number;
}) {
  const load = useCallback(async () => {
    const [s, f] = await Promise.all([
      getSignals(assetClass, interval),
      getForecasts(assetClass, interval, horizon),
    ]);
    if (!s.ok) return { disabled: s.error.code === "stocks_disabled", error: s.error.message, rows: [] as Row[] };
    const bySymbol = new Map<string, Row>();
    for (const item of s.data.results) bySymbol.set(item.symbol, { symbol: item.symbol, signal: item });
    if (f.ok) {
      for (const item of f.data.results) {
        const row = bySymbol.get(item.symbol) ?? { symbol: item.symbol };
        row.forecast = item;
        bySymbol.set(item.symbol, row);
      }
    }
    return { disabled: false, error: null as string | null, rows: [...bySymbol.values()] };
  }, [assetClass, interval, horizon]);

  const { loading, data, error } = useAsync(load, [assetClass, interval, horizon]);

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="note error">{error}</p>;
  if (!data) return null;
  if (data.disabled) return <StocksDisabled />;
  if (data.error) return <p className="note error">{data.error}</p>;

  return (
    <section className="grid">
      {data.rows.map((row) => (
        <SignalForecastCard key={row.symbol} symbol={row.symbol} signal={row.signal} forecast={row.forecast} />
      ))}
    </section>
  );
}
