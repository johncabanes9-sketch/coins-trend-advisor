import { fileURLToPath } from "node:url";
import type { AssetClass, RiskConfig } from "@coins-trend-advisor/core";
import { DEFAULT_RISK_CONFIG } from "@coins-trend-advisor/core";

export interface WatchlistEntry {
  assetClass: AssetClass;
  symbol: string;
}

export interface AppConfig {
  port: number;
  coinsBaseUrl: string;
  finnhubApiKey?: string;
  finnhubBaseUrl: string;
  watchlist: WatchlistEntry[];
  signalTtlMs: number;
  cryptoInterval: string;
  stockInterval: string;
  klineLimit: number;
  forecastHorizon: number;
  apiToken?: string;
  staticDir?: string;
  risk: RiskConfig;
}

const DEFAULT_WATCHLIST: WatchlistEntry[] = [
  { assetClass: "crypto", symbol: "BTCPHP" },
  { assetClass: "crypto", symbol: "ETHPHP" },
  { assetClass: "crypto", symbol: "XRPPHP" },
  { assetClass: "crypto", symbol: "SOLPHP" },
  { assetClass: "crypto", symbol: "USDTPHP" },
];

const ASSET_CLASSES: AssetClass[] = ["crypto", "stock"];

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`config: ${key} must be a number, got "${raw}"`);
  }
  return n;
}

function parseWatchlist(raw: string | undefined): WatchlistEntry[] {
  if (raw === undefined) return [...DEFAULT_WATCHLIST];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return [...DEFAULT_WATCHLIST];
  return parts.map((entry) => {
    const idx = entry.indexOf(":");
    if (idx <= 0) {
      throw new Error(`config: WATCHLIST entry "${entry}" must be class:symbol`);
    }
    const assetClass = entry.slice(0, idx).trim();
    const symbol = entry.slice(idx + 1).trim();
    if (!ASSET_CLASSES.includes(assetClass as AssetClass)) {
      throw new Error(`config: WATCHLIST entry "${entry}" has unknown asset class`);
    }
    if (symbol.length === 0) {
      throw new Error(`config: WATCHLIST entry "${entry}" must be class:symbol`);
    }
    return { assetClass: assetClass as AssetClass, symbol };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: num(env, "PORT", 3001),
    coinsBaseUrl: env.COINS_BASE_URL ?? "https://api.pro.coins.ph",
    finnhubApiKey: env.FINNHUB_API_KEY || undefined,
    finnhubBaseUrl: env.FINNHUB_BASE_URL ?? "https://finnhub.io/api/v1",
    watchlist: parseWatchlist(env.WATCHLIST),
    signalTtlMs: num(env, "SIGNAL_TTL_MS", 300000),
    cryptoInterval: env.CRYPTO_INTERVAL ?? "1h",
    stockInterval: env.STOCK_INTERVAL ?? "D",
    klineLimit: num(env, "KLINE_LIMIT", 250),
    forecastHorizon: num(env, "FORECAST_HORIZON", 5),
    apiToken: env.API_TOKEN || undefined,
    staticDir:
      env.STATIC_DIR ||
      fileURLToPath(new URL("../../frontend/dist", import.meta.url)),
    risk: {
      riskPct: num(env, "RISK_PCT", DEFAULT_RISK_CONFIG.riskPct),
      rewardRisk: num(env, "REWARD_RISK", DEFAULT_RISK_CONFIG.rewardRisk),
      atrBufferStock: num(env, "ATR_BUFFER_STOCK", DEFAULT_RISK_CONFIG.atrBufferStock),
      atrBufferCrypto: num(env, "ATR_BUFFER_CRYPTO", DEFAULT_RISK_CONFIG.atrBufferCrypto),
      cryptoSizeFactor: num(env, "CRYPTO_SIZE_FACTOR", DEFAULT_RISK_CONFIG.cryptoSizeFactor),
      volatilitySizeFactor: num(env, "VOLATILITY_SIZE_FACTOR", DEFAULT_RISK_CONFIG.volatilitySizeFactor),
    },
  };
}
