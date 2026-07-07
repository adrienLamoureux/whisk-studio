import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Button from "./Button";

describe("Button", () => {
  it("renders a primary button by default and fires onClick", () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Go</Button>);
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn.className).toContain("skr-btn-primary");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("maps variants to skr-btn classes", () => {
    render(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole("button", { name: "Ghost" }).className).toContain("skr-btn-ghost");
  });

  it("disables the button and shows a spinner while loading", () => {
    const onClick = jest.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>
    );
    const btn = screen.getByRole("button", { name: /Save/ });
    expect(btn).toBeDisabled();
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("appends extra classNames", () => {
    render(<Button className="skr-modal-action">Act</Button>);
    const btn = screen.getByRole("button", { name: "Act" });
    expect(btn.className).toBe("skr-btn-primary skr-modal-action");
  });
});
