import React from "react";
import { render, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeContext";

function setup() {
  const captured = {};
  function Probe() {
    Object.assign(captured, useTheme());
    return null;
  }
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
  return captured;
}

describe("ThemeContext aesthetic axis", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-aesthetic");
    document.documentElement.classList.remove("skr-aesthetic-transition");
  });

  it("defaults the aesthetic and always sets data-aesthetic explicitly", () => {
    const ctx = setup();
    expect(["sakura", "obscura"]).toContain(ctx.aesthetic);
    expect(document.documentElement.getAttribute("data-aesthetic")).toBe(ctx.aesthetic);
  });

  it("falls back to the default for invalid stored values", () => {
    localStorage.setItem("skr-aesthetic", "vaporwave");
    const ctx = setup();
    expect(["sakura", "obscura"]).toContain(ctx.aesthetic);
    expect(ctx.aesthetic).not.toBe("vaporwave");
  });

  it("persists setAesthetic and ignores invalid ids (enum-validated write)", () => {
    const ctx = setup();
    act(() => ctx.setAesthetic("obscura"));
    expect(localStorage.getItem("skr-aesthetic")).toBe("obscura");
    expect(document.documentElement.getAttribute("data-aesthetic")).toBe("obscura");
    act(() => ctx.setAesthetic("not-a-real-aesthetic"));
    expect(localStorage.getItem("skr-aesthetic")).toBe("obscura");
    expect(document.documentElement.getAttribute("data-aesthetic")).toBe("obscura");
  });

  it("removes data-theme while obscura is active and restores it on switch-back", () => {
    localStorage.setItem("skr-theme", "ember");
    const ctx = setup();
    act(() => ctx.setAesthetic("sakura"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("ember");
    act(() => ctx.setAesthetic("obscura"));
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    // stored palette survives for switch-back
    expect(localStorage.getItem("skr-theme")).toBe("ember");
    act(() => ctx.setAesthetic("sakura"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("ember");
  });

  it("adds the transient transition class on aesthetic changes", () => {
    jest.useFakeTimers();
    try {
      const ctx = setup();
      const before = ctx.aesthetic;
      const next = before === "obscura" ? "sakura" : "obscura";
      act(() => ctx.setAesthetic(next));
      expect(document.documentElement.classList.contains("skr-aesthetic-transition")).toBe(true);
      act(() => jest.advanceTimersByTime(1000));
      expect(document.documentElement.classList.contains("skr-aesthetic-transition")).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps brightness independent of the aesthetic", () => {
    const ctx = setup();
    act(() => ctx.setAesthetic("obscura"));
    act(() => ctx.setBrightness("dark"));
    expect(document.documentElement.getAttribute("data-brightness")).toBeNull();
    act(() => ctx.setBrightness("light"));
    expect(document.documentElement.getAttribute("data-brightness")).toBe("light");
    expect(document.documentElement.getAttribute("data-aesthetic")).toBe("obscura");
  });

  it("toggleAesthetic flips between the two aesthetics", () => {
    const ctx = setup();
    const start = ctx.aesthetic;
    act(() => ctx.toggleAesthetic());
    expect(ctx.aesthetic).not.toBe(start);
    act(() => ctx.toggleAesthetic());
    expect(ctx.aesthetic).toBe(start);
  });
});
