import { render, screen } from "@testing-library/react";
import { TrendBadge } from "../components/TrendBadge.js";

it("labels a buy trend and tags it for styling", () => {
  render(<TrendBadge trend="buy" />);
  const el = screen.getByText(/buy/i);
  expect(el).toHaveAttribute("data-trend", "buy");
});

it("renders an unknown trend as hold", () => {
  render(<TrendBadge trend="whatever" />);
  expect(screen.getByText(/hold/i)).toHaveAttribute("data-trend", "hold");
});
