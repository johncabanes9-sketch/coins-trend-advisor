const KNOWN = new Set(["buy", "sell", "hold"]);

export function TrendBadge({ trend }: { trend: string }) {
  const t = KNOWN.has(trend) ? trend : "hold";
  const label = t === "buy" ? "Buy" : t === "sell" ? "Sell" : "Hold";
  return (
    <span className="trend-badge" data-trend={t}>
      {label}
    </span>
  );
}
