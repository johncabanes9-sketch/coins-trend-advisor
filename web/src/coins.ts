import { CoinsClient, CoinsProvider } from "@coins-trend-advisor/core";
import type { AppConfig } from "./config.js";

export function makeCoinsProvider(config: AppConfig): CoinsProvider {
  return new CoinsProvider(new CoinsClient({ baseUrl: config.coinsBaseUrl }));
}
