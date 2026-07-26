import React from "react";
import { render, act } from "@testing-library/react";
import AuthExpiryNotice from "./AuthExpiryNotice";

const mockNotify = jest.fn();
let mockIsAuthenticated = true;

jest.mock("./NotificationStack", () => ({
  useNotify: () => mockNotify,
}));
jest.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

const fireExpired = () => {
  act(() => {
    window.dispatchEvent(new CustomEvent("whisk:auth:expired"));
  });
};

describe("AuthExpiryNotice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAuthenticated = true;
  });

  it("toasts when the session expires while authenticated", () => {
    render(<AuthExpiryNotice />);
    fireExpired();
    expect(mockNotify).toHaveBeenCalledWith(
      "Your session expired — please sign in again.",
      "error"
    );
  });

  it("debounces a burst of expiry events into one toast", () => {
    render(<AuthExpiryNotice />);
    fireExpired();
    fireExpired();
    fireExpired();
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it("does not toast for anonymous visitors", () => {
    mockIsAuthenticated = false;
    render(<AuthExpiryNotice />);
    fireExpired();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
