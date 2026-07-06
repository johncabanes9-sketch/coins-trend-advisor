import type { SignalItem, ForecastItem } from "../types.js";
import { TrendBadge } from "./TrendBadge.js";
import { BandBar } from "./BandBar.js";

export function SignalForecastCard({
  symbol,
  signal,
  forecast,
}: {
  symbol: string;
  signal?: SignalItem;
  forecast?: ForecastItem;
}) {
  const stale = signal?.stale || forecast?.stale;
  const insufficient =
    signal?.status === "insufficient_data" || forecast?.status === "insufficient_data";
  return (
    <article className="card">
      <header className="card-head">
        <h3>{symbol}</h3>
        {signal?.status === "ok" && signal.signal && <TrendBadge trend={signal.signal.trend} />}
        {stale && <span className="stale-tag">stale</span>}
      </header>

      {signal?.status === "ok" && signal.signal && (
        <dl className="indicators">
          <div><dt>Confidence</dt><dd>{Math.round(signal.signal.confidence * 100)}%</dd></div>
          <div><dt>RSI</dt><dd>{signal.signal.indicators.rsi.toFixed(1)}</dd></div>
          <div><dt>EMA</dt><dd>{signal.signal.indicators.emaCrossover}</dd></div>
          <div><dt>Bollinger</dt><dd>{signal.signal.indicators.bollinger}</dd></div>
        </dl>
      )}

      {forecast?.status === "ok" && forecast.forecast && (
        <div className="forecast">
          <div className="forecast-value">
            → {forecast.forecast.predicted.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            <span className="forecast-h"> (h={forecast.forecast.horizon})</span>
          </div>
          <BandBar
            lower={forecast.forecast.lower}
            predicted={forecast.forecast.predicted}
            upper={forecast.forecast.upper}
          />
        </div>
      )}

      {insufficient && <p className="note">Not enough data yet for a reading.</p>}
      {(signal?.status === "error" || forecast?.status === "error") && (
        <p className="note error">Upstream data is currently unavailable.</p>
      )}
    </article>
  );
}
