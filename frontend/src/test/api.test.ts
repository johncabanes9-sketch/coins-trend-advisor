import { describe, it, expect, beforeEach, vi } from "vitest";
import * as api from "../api.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  api.setApiToken(null);
  vi.restoreAllMocks();
});

describe("api client", () => {
  it("getSignals returns ok data on 200", async () => {
    const body = { assetClass: "crypto", interval: "1h", results: [{ assetClass: "crypto", symbol: "BTCPHP", status: "ok" }] };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(body)));
    const r = await api.getSignals("crypto", "1h");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.results[0]!.symbol).toBe("BTCPHP");
  });

  it("normalizes a 503 stocks_disabled into an error result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { code: "stocks_disabled", message: "off" } }, 503)));
    const r = await api.getSignals("stock", "D");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected error");
    expect(r.error.code).toBe("stocks_disabled");
  });

  it("normalizes a network throw into an error result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    const r = await api.getWatchlist();
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected error");
    expect(r.error.code).toBe("network_error");
  });

  it("attaches a bearer token when set", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ entries: [] }));
    vi.stubGlobal("fetch", fetchMock);
    api.setApiToken("secret");
    await api.getWatchlist();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret");
  });

  it("builds the forecast list URL with interval and horizon", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ assetClass: "crypto", interval: "4h", horizon: 8, results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await api.getForecasts("crypto", "4h", 8);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/forecast/crypto?interval=4h&horizon=8");
  });

  it("posts profit as JSON", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ netProfit: 10 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await api.postProfit({ entryPrice: 1, targetPrice: 2, positionSize: 3, feePct: 0.1 });
    expect(r.ok).toBe(true);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)).entryPrice).toBe(1);
  });
});
