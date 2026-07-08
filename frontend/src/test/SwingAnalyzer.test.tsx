import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { SwingAnalyzer } from "../components/SwingAnalyzer.js";
import * as api from "../api.js";

const okSignal = {
  ok: true as const,
  data: {
    action: "BUY" as const, confidence: 70, entry_price: 100, stop_loss: 95,
    take_profit: 110, position_size_pct: 0.1, reasoning: "Uptrend.", risk_flags: [],
  },
};

beforeEach(() => {
  vi.spyOn(api, "getPairs").mockResolvedValue({ ok: true, data: { assetClass: "crypto", symbols: ["BTCPHP"] } });
});

it("submits symbol + account and renders the decision card", async () => {
  const spy = vi.spyOn(api, "postAnalyze").mockResolvedValue(okSignal);
  render(<SwingAnalyzer assetClass="crypto" interval="1h" />);
  await userEvent.type(screen.getByLabelText(/symbol/i), "BTCPHP");
  await userEvent.clear(screen.getByLabelText(/equity/i));
  await userEvent.type(screen.getByLabelText(/equity/i), "10000");
  await userEvent.click(screen.getByRole("button", { name: /analy/i }));
  await waitFor(() => expect(screen.getByText("BUY")).toBeInTheDocument());
  expect(spy).toHaveBeenCalledOnce();
  const [, body] = spy.mock.calls[0]!;
  expect(body.symbol).toBe("BTCPHP");
  expect(body.account.equity).toBe(10000);
  expect(body.account.position).toBeNull();
});

it("sends a non-null position when both size and entry price are filled", async () => {
  const spy = vi.spyOn(api, "postAnalyze").mockResolvedValue(okSignal);
  render(<SwingAnalyzer assetClass="crypto" interval="1h" />);
  await userEvent.type(screen.getByLabelText(/symbol/i), "BTCPHP");
  await userEvent.clear(screen.getByLabelText(/equity/i));
  await userEvent.type(screen.getByLabelText(/equity/i), "10000");
  await userEvent.type(screen.getByLabelText(/size/i), "0.5");
  await userEvent.type(screen.getByLabelText(/entry price/i), "98");
  await userEvent.click(screen.getByRole("button", { name: /analy/i }));
  await waitFor(() => expect(screen.getByText("BUY")).toBeInTheDocument());
  const [, body] = spy.mock.calls[0]!;
  expect(body.account.position).toEqual({ size: 0.5, entryPrice: 98 });
});

it("hints to fill both fields when the open position is partially filled, then clears it", async () => {
  render(<SwingAnalyzer assetClass="crypto" interval="1h" />);
  const hint = /enter both size and entry price/i;
  expect(screen.queryByText(hint)).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(/size/i), "0.5");
  expect(screen.getByText(hint)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(/entry price/i), "98");
  expect(screen.queryByText(hint)).not.toBeInTheDocument();
});

it("blocks submit with an inline error when equity is not finite", async () => {
  const spy = vi.spyOn(api, "postAnalyze").mockResolvedValue(okSignal);
  render(<SwingAnalyzer assetClass="crypto" interval="1h" />);
  await userEvent.type(screen.getByLabelText(/symbol/i), "BTCPHP");
  await userEvent.clear(screen.getByLabelText(/equity/i));
  await userEvent.click(screen.getByRole("button", { name: /analy/i }));
  expect(await screen.findByText("Enter valid numbers for the account fields above.")).toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});

it("shows the friendly message when stocks are disabled", async () => {
  vi.spyOn(api, "postAnalyze").mockResolvedValue({ ok: false, error: { code: "stocks_disabled", message: "off" } });
  render(<SwingAnalyzer assetClass="stock" interval="D" />);
  await userEvent.type(screen.getByLabelText(/symbol/i), "AAPL");
  await userEvent.clear(screen.getByLabelText(/equity/i));
  await userEvent.type(screen.getByLabelText(/equity/i), "10000");
  await userEvent.click(screen.getByRole("button", { name: /analy/i }));
  await waitFor(() => expect(screen.getByText(/stocks aren't configured/i)).toBeInTheDocument());
});
