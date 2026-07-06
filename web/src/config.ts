export interface AppConfig {
  port: number;
  coinsBaseUrl: string;
  watchlist: string[];
  signalTtlMs: number;
  klineInterval: string;
  klineLimit: number;
  apiToken?: string;
  allowedIntervals: string[];
}

const DEFAULT_WATCHLIST = ["BTCPHP", "ETHPHP", "XRPPHP", "SOLPHP", "USDTPHP"];
const ALLOWED_INTERVALS = ["1h", "4h"];

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`config: ${key} must be a number, got "${raw}"`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsedWatchlist = env.WATCHLIST?.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    port: num(env, "PORT", 3001),
    coinsBaseUrl: env.COINS_BASE_URL ?? "https://api.pro.coins.ph",
    watchlist:
      parsedWatchlist && parsedWatchlist.length > 0
        ? parsedWatchlist
        : DEFAULT_WATCHLIST,
    signalTtlMs: num(env, "SIGNAL_TTL_MS", 300000),
    klineInterval: env.KLINE_INTERVAL ?? "1h",
    klineLimit: num(env, "KLINE_LIMIT", 200),
    apiToken: env.API_TOKEN || undefined,
    allowedIntervals: ALLOWED_INTERVALS,
  };
}
