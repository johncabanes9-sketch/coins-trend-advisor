import type { CoinsClient } from "../coinsClient.js";
import type { AssetClass, Kline, MarketDataProvider } from "../types.js";

type CoinsClientLike = Pick<CoinsClient, "getKlines" | "getPrice" | "getPairs">;

export class CoinsProvider implements MarketDataProvider {
  readonly assetClass: AssetClass = "crypto";
  readonly allowedIntervals = ["1h", "4h"];
  readonly defaultInterval = "1h";

  constructor(private readonly client: CoinsClientLike) {}

  getKlines(symbol: string, interval: string, limit?: number): Promise<Kline[]> {
    return this.client.getKlines(symbol, interval, limit);
  }

  getPrice(symbol: string): Promise<number> {
    return this.client.getPrice(symbol);
  }

  listSymbols(): Promise<string[]> {
    return this.client.getPairs();
  }
}
