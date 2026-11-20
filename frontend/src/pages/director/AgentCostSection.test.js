import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { fetchAgentCost } from "../../services/operations";
import AgentCostSection from "./AgentCostSection";
import { NotificationProvider } from "../../components/sakura/NotificationStack";

jest.mock("../../services/operations", () => ({
  fetchAgentCost: jest.fn(),
}));

const ITEMS = [{ userId: "alice", inputTokens: 1_000_000, outputTokens: 1_000_000, turnCount: 3 }];

function renderSection() {
  return render(
    <NotificationProvider>
      <AgentCostSection apiBaseUrl="https://api.example.com" />
    </NotificationProvider>
  );
}

describe("AgentCostSection", () => {
  beforeEach(() => jest.clearAllMocks());

  it("computes cost from the returned rates", async () => {
    fetchAgentCost.mockResolvedValue({
      items: ITEMS,
      rates: { llm: { inputUsdPerMTok: 2, outputUsdPerMTok: 10, placeholder: true } },
    });
    renderSection();
    await waitFor(() => expect(screen.getAllByText("$12.00").length).toBeGreaterThan(0));
    expect(screen.getByText(/placeholder/)).toBeInTheDocument();
  });

  it("shows Rates unavailable when the response has no rates", async () => {
    fetchAgentCost.mockResolvedValue({ items: ITEMS });
    renderSection();
    expect(await screen.findByText("Rates unavailable")).toBeInTheDocument();
  });
});
