import { render, screen } from "@testing-library/react";
import { BandBar } from "../components/BandBar.js";

it("describes the band range for screen readers", () => {
  render(<BandBar lower={90} predicted={100} upper={110} />);
  const el = screen.getByRole("img");
  expect(el.getAttribute("aria-label")).toContain("90");
  expect(el.getAttribute("aria-label")).toContain("110");
});
