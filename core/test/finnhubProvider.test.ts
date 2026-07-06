import { describe, it, expect, vi } from "vitest";
import { FinnhubProvider } from "../src/providers/finnhubProvider.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

describe("FinnhubProvider", () => {
  it("advertises stock metadata", () => {
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl: vi.fn() });
    expect(p.assetClass).toBe("stock");
    expect(p.allowedIntervals).toEqual(["D", "W"]);
    expect(p.defaultInterval).toBe("D");
  });

  it("normalizes candle arrays into Kline rows and keeps the newest `limit`", async () => {
    const body = {
      s: "ok",
      t: [1000, 2000, 3000],
      o: [10, 11, 12],
      h: [11, 12, 13],
      l: [9, 10, 11],
      c: [10.5, 11.5, 12.5],
      v: [100, 200, 300],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 4_000_000 });
    const out = await p.getKlines("AAPL", "D", 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      openTime: 2_000_000,
      open: 11,
      high: 12,
      low: 10,
      close: 11.5,
      volume: 200,
      closeTime: 2_000_000 + 86_400_000,
    });
    expect(out[1]!.close).toBe(12.5);
    // @ts-expect-error noUncheckedIndexedAccess with vi.fn mock
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain("/stock/candle");
    expect(url).toContain("symbol=AAPL");
    expect(url).toContain("resolution=D");
    expect(url).toContain("token=k");
  });

  it("returns an empty series on s:no_data", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ s: "no_data" }));
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await p.getKlines("AAPL", "D")).toEqual([]);
  });

  it("rejects a malformed ok response whose price arrays are shorter than t", async () => {
    const body = {
      s: "ok",
      t: [1000, 2000, 3000],
      o: [10, 11, 12],
      h: [11, 12, 13],
      l: [9, 10, 11],
      c: [10.5, 11.5], // one short — would otherwise yield a NaN candle
      v: [100, 200, 300],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(p.getKlines("AAPL", "D")).rejects.toThrow(/malformed|mismatch/i);
  });

  it("throws with a sanitized message on a non-ok HTTP response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "bad" }, false, 401));
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(p.getKlines("AAPL", "D")).rejects.toThrow(/Finnhub 401/);
  });

  it("rejects an unsupported interval", async () => {
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl: vi.fn() });
    await expect(p.getKlines("AAPL", "1h")).rejects.toThrow(/interval/);
  });

  it("reads the current price from the quote endpoint", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ c: 123.45 }));
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await p.getPrice("AAPL")).toBe(123.45);
  });

  it("lists US symbols", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ symbol: "AAPL" }, { symbol: "MSFT" }]),
    );
    const p = new FinnhubProvider({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await p.listSymbols()).toEqual(["AAPL", "MSFT"]);
  });
});
