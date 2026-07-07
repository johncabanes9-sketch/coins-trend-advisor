import { useEffect, useState } from "react";
import { calculateProfit } from "@coins-trend-advisor/core";

const QUOTES = ["USDT", "USDC", "PHP", "USD", "BTC", "ETH"];

function quoteCurrency(symbol: string): string {
  const upper = symbol.toUpperCase();
  return QUOTES.find((q) => upper.endsWith(q) && upper.length > q.length) ?? "";
}

export function ProfitCalculator({
  symbol,
  targetPrice,
}: {
  symbol: string;
  targetPrice?: number;
}) {
  const [deposit, setDeposit] = useState("");
  const [entry, setEntry] = useState("");
  const [target, setTarget] = useState(targetPrice != null ? String(targetPrice) : "");
  const [fee, setFee] = useState("0.25");

  useEffect(() => {
    setTarget(targetPrice != null ? String(targetPrice) : "");
  }, [targetPrice]);

  const depositN = Number(deposit);
  const entryN = Number(entry);
  const targetN = Number(target);
  const feeN = Number(fee);

  const valid =
    deposit !== "" && entry !== "" && target !== "" && fee !== "" &&
    Number.isFinite(depositN) && depositN > 0 &&
    Number.isFinite(entryN) && entryN > 0 &&
    Number.isFinite(targetN) &&
    Number.isFinite(feeN) && feeN >= 0;

  let result: ReturnType<typeof calculateProfit> | null = null;
  if (valid) {
    try {
      result = calculateProfit({
        entryPrice: entryN,
        positionSize: depositN,
        targetPrice: targetN,
        feePct: feeN,
      });
    } catch {
      result = null;
    }
  }

  const quote = quoteCurrency(symbol);
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const signed = (n: number) => (n >= 0 ? "+" : "") + fmt(n);

  return (
    <section className="profit-calc">
      <h4 className="profit-calc-title">Profit calculator</h4>
      <div className="profit-calc-grid">
        <label>Deposit
          <input inputMode="decimal" value={deposit} placeholder="0"
            onChange={(e) => setDeposit(e.target.value)} />
        </label>
        <label>Entry price
          <input inputMode="decimal" value={entry} placeholder="0"
            onChange={(e) => setEntry(e.target.value)} />
        </label>
        <label>Target price
          <input inputMode="decimal" value={target} placeholder="0"
            onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label>Fee %
          <input inputMode="decimal" value={fee}
            onChange={(e) => setFee(e.target.value)} />
        </label>
      </div>
      {result && (
        <div className="profit-result" data-sign={result.netProfit >= 0 ? "positive" : "negative"}>
          <div className="profit-net">
            {signed(result.netProfit)} {quote} ({result.netProfitPct >= 0 ? "+" : ""}
            {result.netProfitPct.toFixed(1)}%)
          </div>
          <div className="profit-detail">
            <span>Gross {fmt(result.grossProfit)} {quote}</span>
            <span>Fees {fmt(result.feesPaid)} {quote}</span>
          </div>
        </div>
      )}
    </section>
  );
}
