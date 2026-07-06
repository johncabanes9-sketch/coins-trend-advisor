import {
  CoinsClient,
  CoinsProvider,
  FinnhubProvider,
  type AssetClass,
  type MarketDataProvider,
} from "@coins-trend-advisor/core";
import type { AppConfig } from "./config.js";
import { makeCoinsProvider } from "./coins.js";

export interface ProviderRegistry {
  resolve(ac: AssetClass): MarketDataProvider | null;
}

export function buildRegistry(
  config: AppConfig,
  deps: { coins?: MarketDataProvider; finnhub?: MarketDataProvider } = {},
): ProviderRegistry {
  const crypto = deps.coins ?? makeCoinsProvider(config);
  const stock =
    deps.finnhub ??
    (config.finnhubApiKey
      ? new FinnhubProvider({
          apiKey: config.finnhubApiKey,
          baseUrl: config.finnhubBaseUrl,
        })
      : null);

  return {
    resolve(ac: AssetClass): MarketDataProvider | null {
      if (ac === "crypto") return crypto;
      if (ac === "stock") return stock;
      return null;
    },
  };
}

// Re-export so callers have a single import site for construction.
export { CoinsClient, CoinsProvider };
