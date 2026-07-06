import { CoinsClient } from "@coins-trend-advisor/core";
import type { AppConfig } from "./config.js";

export function makeClient(config: AppConfig): CoinsClient {
  return new CoinsClient({ baseUrl: config.coinsBaseUrl });
}
