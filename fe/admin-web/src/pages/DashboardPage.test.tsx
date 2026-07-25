import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as gradingService from "../services/gradingService";
import { DashboardPage } from "./DashboardPage";

vi.mock("../services/gradingService");

const mockedGradingService = vi.mocked(gradingService);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return render(<DashboardPage />, { wrapper: Wrapper });
}

const rows = [
  { id: "sub-1", assignment_id: "assignment-1", student_id: "student-1", state: "graded" as const, submitted_at: "2026-01-01T00:00:00Z" },
  { id: "sub-2", assignment_id: "assignment-2", student_id: "student-2", state: "reviewed" as const, submitted_at: "2026-01-02T00:00:00Z" },
  { id: "sub-3", assignment_id: "assignment-3", student_id: "student-3", state: "extracting" as const, submitted_at: "2026-01-03T00:00:00Z" },
  { id: "sub-4", assignment_id: "assignment-4", student_id: "student-4", state: "failed" as const, submitted_at: "2026-01-04T00:00:00Z" },
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe("DashboardPage", () => {
  it("shows a loading state while submissions load", () => {
    mockedGradingService.listRecentSubmissions.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText("Loading submissions")).toBeInTheDocument();
  });

  it("shows an empty state when there are no submissions", async () => {
    mockedGradingService.listRecentSubmissions.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No submissions yet")).toBeInTheDocument();
  });

  it("renders submission rows with the right status counts", async () => {
    mockedGradingService.listRecentSubmissions.mockResolvedValue(rows);

    renderPage();

    expect(await screen.findByText("AI graded")).toBeInTheDocument();
    expect(screen.getAllByText("student-", { exact: false })).toHaveLength(rows.length);

    const metricPanels = document.querySelectorAll(".metric-panel strong");
    expect(metricPanels[0]).toHaveTextContent("2"); // graded + reviewed
    expect(metricPanels[1]).toHaveTextContent("1"); // extracting + grading
    expect(metricPanels[2]).toHaveTextContent("1"); // failed

    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1); // + header row
  });

  it("shows an error state when the submissions request fails", async () => {
    mockedGradingService.listRecentSubmissions.mockRejectedValue(new ApiError(500, "Server error"));

    renderPage();

    expect(await screen.findByText("Unable to load submissions")).toBeInTheDocument();
    expect(screen.getByText("Server error")).toBeInTheDocument();
  });
});
