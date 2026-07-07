import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Modal from "./Modal";

describe("Modal", () => {
  it("renders children when open", () => {
    render(
      <Modal onClose={() => {}}>
        <p>Hello content</p>
      </Modal>
    );
    expect(screen.getByText("Hello content")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders nothing when isOpen is false", () => {
    render(
      <Modal isOpen={false} onClose={() => {}}>
        <p>Hidden</p>
      </Modal>
    );
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("calls onClose when the overlay is clicked", () => {
    const onClose = jest.fn();
    render(
      <Modal onClose={onClose}>
        <p>Content</p>
      </Modal>
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the card", () => {
    const onClose = jest.fn();
    render(
      <Modal onClose={onClose}>
        <p>Inside</p>
      </Modal>
    );
    fireEvent.click(screen.getByText("Inside"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose on Escape", () => {
    const onClose = jest.fn();
    render(
      <Modal onClose={onClose}>
        <p>Content</p>
      </Modal>
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose from the close button", () => {
    const onClose = jest.fn();
    render(
      <Modal onClose={onClose}>
        <p>Content</p>
      </Modal>
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("panel variant renders a header row with the title", () => {
    render(
      <Modal variant="panel" title="Generate Video" onClose={() => {}}>
        <p>Form</p>
      </Modal>
    );
    expect(screen.getByText("Generate Video")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Generate Video");
  });
});
