export function StocksDisabled() {
  return (
    <div className="panel">
      <p>Stocks aren't configured on this server.</p>
      <p className="muted">Set a <code>FINNHUB_API_KEY</code> to enable stock signals and forecasts.</p>
    </div>
  );
}
