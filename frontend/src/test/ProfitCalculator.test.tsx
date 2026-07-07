import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfitCalculator } from "../components/ProfitCalculator.js";

it("prefills target from the forecast and defaults fee to 0.25", () => {
  render(<ProfitCalculator symbol="BTCPHP" targetPrice={110} />);
  expect(screen.getByLabelText(/target price/i)).toHaveValue("110");
  expect(screen.getByLabelText(/fee/i)).toHaveValue("0.25");
});

it("computes net profit live from deposit + entry against the target", async () => {
  const { container } = render(<ProfitCalculator symbol="BTCPHP" targetPrice={110} />);
  await userEvent.type(screen.getByLabelText(/deposit/i), "10000");
  await userEvent.type(screen.getByLabelText(/entry price/i), "100");
  // units=100, proceeds=11000, gross=1000, fees=21000*0.0025=52.5, net=947.5, pct=9.475
  expect(screen.getByText(/\+947\.5 PHP \(\+9\.5%\)/)).toBeInTheDocument();
  expect(container.querySelector(".profit-result")).toHaveAttribute("data-sign", "positive");
});

it("marks a loss as negative", async () => {
  const { container } = render(<ProfitCalculator symbol="BTCPHP" targetPrice={100} />);
  await userEvent.type(screen.getByLabelText(/deposit/i), "10000");
  await userEvent.type(screen.getByLabelText(/entry price/i), "110");
  expect(container.querySelector(".profit-result")).toHaveAttribute("data-sign", "negative");
});

it("shows no result until inputs are valid positive numbers", () => {
  const { container } = render(<ProfitCalculator symbol="BTCPHP" targetPrice={110} />);
  expect(container.querySelector(".profit-result")).toBeNull();
});
