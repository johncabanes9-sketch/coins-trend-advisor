// core/src/profit.ts
export interface ProfitInput {
  entryPrice: number;
  positionSize: number;
  targetPrice: number;
  feePct: number;
}

export interface ProfitResult {
  grossProfit: number;
  feesPaid: number;
  netProfit: number;
  netProfitPct: number;
}

export function calculateProfit(input: ProfitInput): ProfitResult {
  const { entryPrice, positionSize, targetPrice, feePct } = input;
  if (entryPrice <= 0) throw new Error("calculateProfit: entryPrice must be > 0");
  if (positionSize <= 0)
    throw new Error("calculateProfit: positionSize must be > 0");

  const units = positionSize / entryPrice;
  const grossProceeds = units * targetPrice;
  const grossProfit = grossProceeds - positionSize;
  const feesPaid = ((positionSize + grossProceeds) * feePct) / 100;
  const netProfit = grossProfit - feesPaid;
  const netProfitPct = (netProfit / positionSize) * 100;

  return { grossProfit, feesPaid, netProfit, netProfitPct };
}
