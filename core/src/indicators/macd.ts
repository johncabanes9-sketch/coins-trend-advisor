import { ema } from "./ema.js";

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);

  const macdLine: (number | null)[] = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f != null && s != null ? f - s : null;
  });

  // Collect defined macd values, EMA them, map back to original indices.
  const definedIdx: number[] = [];
  const definedVals: number[] = [];
  macdLine.forEach((v, i) => {
    if (v !== null) {
      definedIdx.push(i);
      definedVals.push(v);
    }
  });

  const signalCompact = ema(definedVals, signalPeriod);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  signalCompact.forEach((v, j) => {
    if (v !== null) signal[definedIdx[j]!] = v;
  });

  const histogram: (number | null)[] = values.map((_, i) => {
    const m = macdLine[i];
    const s = signal[i];
    return m != null && s != null ? m - s : null;
  });

  return { macd: macdLine, signal, histogram };
}
