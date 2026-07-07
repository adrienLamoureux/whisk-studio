import React from "react";
import { render, screen } from "@testing-library/react";
import Spinner from "./Spinner";

describe("Spinner", () => {
  it("renders a status role with the default label", () => {
    render(<Spinner />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("skr-spinner--md");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders bare ring when label is null", () => {
    render(<Spinner label={null} size="sm" />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("skr-spinner--sm");
    expect(el.textContent).toBe("");
  });
});
