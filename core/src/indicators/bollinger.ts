export interface BollingerBands {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export function bollinger(
  values: number[],
  period: number,
  k: number,
): BollingerBands {
  if (period < 1) throw new Error("bollinger: period must be >= 1");
  const middle: (number | null)[] = new Array(values.length).fill(null);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j]!;
    const mean = sum / period;

    let sqDiff = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j]! - mean;
      sqDiff += d * d;
    }
    const sd = Math.sqrt(sqDiff / period); // population stddev

    middle[i] = mean;
    upper[i] = mean + k * sd;
    lower[i] = mean - k * sd;
  }
  return { middle, upper, lower };
}
