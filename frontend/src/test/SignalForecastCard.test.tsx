import { render, screen } from "@testing-library/react";
import { SignalForecastCard } from "../components/SignalForecastCard.js";
import type { SignalItem, ForecastItem } from "../types.js";

const okSignal: SignalItem = {
  assetClass: "crypto", symbol: "BTCPHP", status: "ok",
  signal: {
    pair: "BTCPHP", trend: "buy", confidence: 0.7,
    reasoning: "EMA up", indicators: { rsi: 55, emaCrossover: "bullish", macd: 1, bollinger: "mid" },
    asOf: "2026-07-06T00:00:00.000Z", disclaimer: "d",
  } as unknown as SignalItem["signal"],
};

const okForecast: ForecastItem = {
  assetClass: "crypto", symbol: "BTCPHP", status: "ok",
  forecast: {
    symbol: "BTCPHP", horizon: 5, predicted: 100, lower: 90, upper: 110,
    method: "holt-linear", asOf: "2026-07-06T00:00:00.000Z", disclaimer: "d",
  },
};

it("renders symbol, trend, and forecast band", () => {
  render(<SignalForecastCard symbol="BTCPHP" signal={okSignal} forecast={okForecast} />);
  expect(screen.getByText("BTCPHP")).toBeInTheDocument();
  expect(screen.getByText(/buy/i)).toHaveAttribute("data-trend", "buy");
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain("110");
});

it("shows an insufficient-data note when the signal is short", () => {
  render(<SignalForecastCard symbol="XRPPHP" signal={{ assetClass: "crypto", symbol: "XRPPHP", status: "insufficient_data" }} />);
  expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
});

it("shows a stale marker", () => {
  render(<SignalForecastCard symbol="BTCPHP" signal={{ ...okSignal, stale: true, staleAsOf: "2026-07-06T00:00:00.000Z" }} forecast={okForecast} />);
  expect(screen.getByText(/stale/i)).toBeInTheDocument();
});
