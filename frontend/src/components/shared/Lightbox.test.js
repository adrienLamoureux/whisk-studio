import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Lightbox from "./Lightbox";

describe("Lightbox", () => {
  const image = { url: "https://cdn.example.com/a.jpg", prompt: "a misty valley" };

  it("renders nothing without an image", () => {
    const { container } = render(<Lightbox image={null} onClose={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses the prompt as alt text and focuses the close button", () => {
    render(<Lightbox image={image} onClose={jest.fn()} />);
    expect(screen.getByAltText("a misty valley")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toHaveFocus();
  });

  it("closes on Escape and backdrop click, but not on image click", () => {
    const onClose = jest.fn();
    render(<Lightbox image={image} onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByAltText("a misty valley"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
