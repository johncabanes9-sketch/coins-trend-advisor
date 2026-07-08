import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { App } from "../App.js";
import * as api from "../api.js";

beforeEach(() => {
  vi.spyOn(api, "getPairs").mockResolvedValue({ ok: true, data: { assetClass: "crypto", symbols: [] } });
  vi.spyOn(api, "getSignals").mockResolvedValue({ ok: true, data: { assetClass: "crypto", interval: "1h", results: [] } as any });
  vi.spyOn(api, "getForecasts").mockResolvedValue({ ok: true, data: { assetClass: "crypto", interval: "1h", horizon: 5, results: [] } as any });
});

// App mounts Lookup + Dashboard, which fetch on mount; wait for those to
// settle so their state updates land inside act() and the output stays clean.
async function settle() {
  await waitFor(() => expect(api.getPairs).toHaveBeenCalled());
  await waitFor(() => expect(api.getForecasts).toHaveBeenCalled());
}

it("renders the app title", async () => {
  render(<App />);
  expect(screen.getByText("Coins Trend Advisor")).toBeInTheDocument();
  await settle();
});

it("renders both the lookup form and the dashboard", async () => {
  render(<App />);
  expect(screen.getByRole("button", { name: /look up/i })).toBeInTheDocument();
  await waitFor(() => expect(api.getSignals).toHaveBeenCalledWith("crypto", "1h"));
  await settle();
});

it("resets the interval to the stock default when switching to stocks", async () => {
  render(<App />);
  expect(screen.getByLabelText(/interval/i)).toHaveValue("1h");
  await userEvent.click(screen.getByRole("button", { name: /stocks/i }));
  expect(screen.getByLabelText(/interval/i)).toHaveValue("D");
  await settle();
});

it("wires the token field into the api client", async () => {
  const setToken = vi.spyOn(api, "setApiToken");
  render(<App />);
  await userEvent.type(screen.getByLabelText(/api token/i), "s3cret");
  await waitFor(() => expect(setToken).toHaveBeenLastCalledWith("s3cret"));
  await settle();
});

it("renders the Swing analysis section", async () => {
  render(<App />);
  expect(await screen.findByText(/swing analysis/i)).toBeInTheDocument();
  await settle();
});
