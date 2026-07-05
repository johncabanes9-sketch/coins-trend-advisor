export function ema(values: number[], period: number): (number | null)[] {
  if (period < 1) throw new Error("ema: period must be >= 1");
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  seed /= period;
  out[period - 1] = seed;

  const k = 2 / (period + 1);
  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
