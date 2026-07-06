import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults on an empty env", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3001);
    expect(c.coinsBaseUrl).toBe("https://api.pro.coins.ph");
    expect(c.signalTtlMs).toBe(300000);
    expect(c.klineInterval).toBe("1h");
    expect(c.klineLimit).toBe(200);
    expect(c.watchlist).toEqual(["BTCPHP", "ETHPHP", "XRPPHP", "SOLPHP", "USDTPHP"]);
    expect(c.allowedIntervals).toEqual(["1h", "4h"]);
    expect(c.apiToken).toBeUndefined();
  });

  it("parses provided values and a custom watchlist", () => {
    const c = loadConfig({
      PORT: "4000",
      SIGNAL_TTL_MS: "1000",
      WATCHLIST: "BTCPHP, ETHPHP ,",
      API_TOKEN: "secret",
    });
    expect(c.port).toBe(4000);
    expect(c.signalTtlMs).toBe(1000);
    expect(c.watchlist).toEqual(["BTCPHP", "ETHPHP"]);
    expect(c.apiToken).toBe("secret");
  });

  it("throws on a non-numeric numeric env var", () => {
    expect(() => loadConfig({ SIGNAL_TTL_MS: "abc" })).toThrow();
  });
});
