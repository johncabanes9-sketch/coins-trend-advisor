import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { Controls } from "../components/Controls.js";

function setup(overrides: Partial<Parameters<typeof Controls>[0]> = {}) {
  const props = {
    assetClass: "crypto" as const,
    interval: "1h",
    horizon: 5,
    token: "",
    onAssetClass: vi.fn(),
    onInterval: vi.fn(),
    onHorizon: vi.fn(),
    onToken: vi.fn(),
    ...overrides,
  };
  render(<Controls {...props} />);
  return props;
}

it("switches asset class when the stocks toggle is clicked", async () => {
  const props = setup();
  await userEvent.click(screen.getByRole("button", { name: /stocks/i }));
  expect(props.onAssetClass).toHaveBeenCalledWith("stock");
});

it("emits the chosen interval", () => {
  const props = setup();
  fireEvent.change(screen.getByLabelText(/interval/i), { target: { value: "4h" } });
  expect(props.onInterval).toHaveBeenCalledWith("4h");
});

it("offers stock intervals when asset class is stock", () => {
  setup({ assetClass: "stock", interval: "D" });
  expect(screen.getByRole("option", { name: "D" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "1h" })).not.toBeInTheDocument();
});

it("emits a numeric horizon", () => {
  const props = setup();
  fireEvent.change(screen.getByLabelText(/horizon/i), { target: { value: "7" } });
  expect(props.onHorizon).toHaveBeenCalledWith(7);
});

it("emits the api token", () => {
  const props = setup();
  fireEvent.change(screen.getByLabelText(/api token/i), { target: { value: "abc" } });
  expect(props.onToken).toHaveBeenCalledWith("abc");
});
