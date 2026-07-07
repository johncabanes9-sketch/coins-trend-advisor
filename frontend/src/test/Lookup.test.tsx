import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { Lookup } from "../components/Lookup.js";
import * as api from "../api.js";

it("looks up a symbol and shows its card", async () => {
  vi.spyOn(api, "getPairs").mockResolvedValue({ ok: true, data: { assetClass: "crypto", symbols: ["BTCPHP"] } });
  vi.spyOn(api, "getSignal").mockResolvedValue({
    ok: true,
    data: { assetClass: "crypto", symbol: "BTCPHP", status: "ok",
      signal: { pair: "BTCPHP", trend: "hold", confidence: 0.5, reasoning: "", indicators: { rsi: 50, emaCrossover: "bullish", macd: 1, bollinger: "mid" }, asOf: "", disclaimer: "" } as any },
  });
  vi.spyOn(api, "getForecast").mockResolvedValue({
    ok: true,
    data: { assetClass: "crypto", symbol: "BTCPHP", status: "ok",
      forecast: { symbol: "BTCPHP", horizon: 5, predicted: 100, lower: 90, upper: 110, method: "holt-linear", asOf: "", disclaimer: "" } },
  });
  render(<Lookup assetClass="crypto" interval="1h" horizon={5} />);
  await userEvent.type(screen.getByLabelText(/symbol/i), "BTCPHP");
  await userEvent.click(screen.getByRole("button", { name: /look up/i }));
  await waitFor(() => expect(screen.getByText("BTCPHP")).toBeInTheDocument());
  expect(screen.getByText(/hold/i)).toHaveAttribute("data-trend", "hold");
});
