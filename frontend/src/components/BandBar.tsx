export function BandBar({ lower, predicted, upper }: { lower: number; predicted: number; upper: number }) {
  const span = upper - lower || 1;
  const mid = ((predicted - lower) / span) * 100;
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div
      className="band-bar"
      role="img"
      aria-label={`Forecast ${fmt(predicted)}, range ${fmt(lower)} to ${fmt(upper)}`}
    >
      <div className="band-bar-track">
        <div className="band-bar-marker" style={{ left: `${Math.max(0, Math.min(100, mid))}%` }} />
      </div>
      <div className="band-bar-ends">
        <span>{fmt(lower)}</span>
        <span>{fmt(upper)}</span>
      </div>
    </div>
  );
}
