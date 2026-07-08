import { render, screen } from "@testing-library/react";
import { SwingDecisionCard } from "../components/SwingDecisionCard.js";
import type { SwingSignal } from "../types.js";

const buy: SwingSignal = {
  action: "BUY", confidence: 72, entry_price: 100, stop_loss: 95,
  take_profit: 110, position_size_pct: 0.1, reasoning: "Uptrend aligned.", risk_flags: [],
};

const hold: SwingSignal = {
  action: "HOLD", confidence: 0, entry_price: null, stop_loss: null,
  take_profit: null, position_size_pct: 0, reasoning: "Sideways structure.",
  risk_flags: ["divergence risk"],
};

it("renders a BUY decision with the entry/stop/take-profit grid", () => {
  render(<SwingDecisionCard symbol="BTCPHP" signal={buy} />);
  expect(screen.getByText("BUY")).toHaveAttribute("data-trend", "buy");
  expect(screen.getByText(/72%/)).toBeInTheDocument();
  expect(screen.getByText(/Uptrend aligned/)).toBeInTheDocument();
  expect(screen.getByText(/Entry/i)).toBeInTheDocument();
  expect(screen.getByText("100")).toBeInTheDocument();
  expect(screen.getByText("110")).toBeInTheDocument();
});

it("renders a HOLD decision without the grid, showing reasoning and risk flags", () => {
  render(<SwingDecisionCard symbol="BTCPHP" signal={hold} />);
  expect(screen.getByText("HOLD")).toHaveAttribute("data-trend", "hold");
  expect(screen.queryByText(/Entry/i)).not.toBeInTheDocument();
  expect(screen.getByText(/Sideways structure/)).toBeInTheDocument();
  expect(screen.getByText(/divergence risk/)).toBeInTheDocument();
});
