import { describe, it, expect } from "vitest";
import { buildRegistry } from "../src/providers.js";
import { loadConfig } from "../src/config.js";

describe("buildRegistry", () => {
  it("always resolves crypto", () => {
    const reg = buildRegistry(loadConfig({}));
    const p = reg.resolve("crypto");
    expect(p).not.toBeNull();
    expect(p!.assetClass).toBe("crypto");
  });

  it("returns null for stock when no finnhub key is set", () => {
    const reg = buildRegistry(loadConfig({}));
    expect(reg.resolve("stock")).toBeNull();
  });

  it("resolves stock when a finnhub key is set", () => {
    const reg = buildRegistry(loadConfig({ FINNHUB_API_KEY: "fk" }));
    const p = reg.resolve("stock");
    expect(p).not.toBeNull();
    expect(p!.assetClass).toBe("stock");
    expect(p!.allowedIntervals).toEqual(["D", "W"]);
  });
});
