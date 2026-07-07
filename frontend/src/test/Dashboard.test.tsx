import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { Dashboard } from "../components/Dashboard.js";
import * as api from "../api.js";

const sig = (symbol: string) => ({
  assetClass: "crypto" as const, symbol, status: "ok" as const,
  signal: { pair: symbol, trend: "buy", confidence: 0.6, reasoning: "", indicators: { rsi: 50, emaCrossover: "bullish", macd: 1, bollinger: "mid" }, asOf: "", disclaimer: "" } as any,
});
const fc = (symbol: string) => ({
  assetClass: "crypto" as const, symbol, status: "ok" as const,
  forecast: { symbol, horizon: 5, predicted: 100, lower: 90, upper: 110, method: "holt-linear" as const, asOf: "", disclaimer: "" },
});

it("renders a card per watchlist symbol, merged by symbol", async () => {
  vi.spyOn(api, "getSignals").mockResolvedValue({ ok: true, data: { assetClass: "crypto", interval: "1h", results: [sig("BTCPHP"), sig("ETHPHP")] } });
  vi.spyOn(api, "getForecasts").mockResolvedValue({ ok: true, data: { assetClass: "crypto", interval: "1h", horizon: 5, results: [fc("BTCPHP"), fc("ETHPHP")] } });
  render(<Dashboard assetClass="crypto" interval="1h" horizon={5} />);
  await waitFor(() => expect(screen.getByText("BTCPHP")).toBeInTheDocument());
  expect(screen.getByText("ETHPHP")).toBeInTheDocument();
});

it("shows the stocks-disabled panel on a 503", async () => {
  vi.spyOn(api, "getSignals").mockResolvedValue({ ok: false, error: { code: "stocks_disabled", message: "off" } });
  vi.spyOn(api, "getForecasts").mockResolvedValue({ ok: false, error: { code: "stocks_disabled", message: "off" } });
  render(<Dashboard assetClass="stock" interval="D" horizon={5} />);
  await waitFor(() => expect(screen.getByText(/stocks aren't configured/i)).toBeInTheDocument());
});
