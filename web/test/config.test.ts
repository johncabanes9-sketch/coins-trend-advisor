import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults on an empty env", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3001);
    expect(c.coinsBaseUrl).toBe("https://api.pro.coins.ph");
    expect(c.finnhubBaseUrl).toBe("https://finnhub.io/api/v1");
    expect(c.finnhubApiKey).toBeUndefined();
    expect(c.signalTtlMs).toBe(300000);
    expect(c.cryptoInterval).toBe("1h");
    expect(c.stockInterval).toBe("D");
    expect(c.klineLimit).toBe(200);
    expect(c.watchlist).toEqual([
      { assetClass: "crypto", symbol: "BTCPHP" },
      { assetClass: "crypto", symbol: "ETHPHP" },
      { assetClass: "crypto", symbol: "XRPPHP" },
      { assetClass: "crypto", symbol: "SOLPHP" },
      { assetClass: "crypto", symbol: "USDTPHP" },
    ]);
    expect(c.apiToken).toBeUndefined();
  });

  it("parses a class-tagged watchlist and finnhub key", () => {
    const c = loadConfig({
      WATCHLIST: "crypto:BTCPHP, stock:AAPL ,stock:MSFT",
      FINNHUB_API_KEY: "fk",
    });
    expect(c.watchlist).toEqual([
      { assetClass: "crypto", symbol: "BTCPHP" },
      { assetClass: "stock", symbol: "AAPL" },
      { assetClass: "stock", symbol: "MSFT" },
    ]);
    expect(c.finnhubApiKey).toBe("fk");
  });

  it("throws on a watchlist entry with no class prefix", () => {
    expect(() => loadConfig({ WATCHLIST: "BTCPHP" })).toThrow(/class:symbol/);
  });

  it("throws on an unknown asset class", () => {
    expect(() => loadConfig({ WATCHLIST: "forex:EURUSD" })).toThrow(/asset class/);
  });

  it("throws on a non-numeric numeric env var", () => {
    expect(() => loadConfig({ SIGNAL_TTL_MS: "abc" })).toThrow();
  });
});
