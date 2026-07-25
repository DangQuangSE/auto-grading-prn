import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as apiClient from "../lib/apiClient";
import * as AuthProviderModule from "../providers/AuthProvider";
import * as gradingService from "../services/gradingService";
import * as subjectService from "../services/subjectService";
import * as submissionService from "../services/submissionService";
import { StudentResultPage } from "./StudentResultPage";

const fakeConnection = {
  on: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@microsoft/signalr", () => {
  class HubConnectionBuilder {
    withUrl() {
      return this;
    }
    withAutomaticReconnect() {
      return this;
    }
    build() {
      return fakeConnection;
    }
  }
  return { HubConnectionBuilder };
});

vi.mock("../providers/AuthProvider", async () => {
  const actual = await vi.importActual<typeof import("../providers/AuthProvider")>("../providers/AuthProvider");
  return { ...actual, useAuth: vi.fn() };
});

vi.mock("../services/gradingService");
vi.mock("../services/submissionService");
vi.mock("../services/subjectService");

vi.mock("../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../lib/apiClient")>("../lib/apiClient");
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});

const mockedUseAuth = vi.mocked(AuthProviderModule.useAuth);
const mockedGradingService = vi.mocked(gradingService);
const mockedSubmissionService = vi.mocked(submissionService);
const mockedSubjectService = vi.mocked(subjectService);
const mockedApiClient = vi.mocked(apiClient);

const session = { token: "t", user: { id: "student-1", email: "alice@school.edu", role: "student" as const } };

const submission = {
  id: "sub-1",
  assignmentId: "assign-1",
  studentId: "student-1",
  reportObjectKey: "uuid-1234-abcd-0000-000000000000-report.docx",
  state: "extracted",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  attemptNumber: 1,
};

function renderPage(initialPath = "/result/sub-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(
    <Routes>
      <Route path="/result/:submissionId" element={<StudentResultPage />} />
      <Route path="/result" element={<StudentResultPage />} />
    </Routes>,
    { wrapper: Wrapper },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  fakeConnection.on.mockReset();
  fakeConnection.start.mockResolvedValue(undefined);
  fakeConnection.stop.mockResolvedValue(undefined);

  mockedUseAuth.mockReturnValue({
    session,
    isLoadingSession: false,
    authNotice: null,
    refreshSession: vi.fn(),
    signOutUser: vi.fn(),
  });
  mockedSubmissionService.listMySubmissions.mockResolvedValue([submission]);
  mockedSubjectService.listSubjects.mockResolvedValue([]);
  mockedSubjectService.listAssignments.mockResolvedValue([]);
  mockedGradingService.getFinalGrade.mockResolvedValue(null);
  mockedApiClient.apiGet.mockResolvedValue([]);
});

describe("StudentResultPage", () => {
  it("shows an empty state when there is no submission selected", async () => {
    mockedSubmissionService.listMySubmissions.mockResolvedValue([]);
    mockedGradingService.getGradingResult.mockResolvedValue({
      gradingRun: null,
      isPublished: false,
      gradingDone: false,
    });

    renderPage("/result");

    expect(await screen.findByText("No submission selected")).toBeInTheDocument();
  });

  it("populates the submission dropdown and auto-selects the latest submission", async () => {
    mockedGradingService.getGradingResult.mockResolvedValue({
      gradingRun: null,
      isPublished: false,
      gradingDone: false,
    });

    renderPage("/result");

    const select = await screen.findByLabelText("Submission");
    await waitFor(() => expect(select).toHaveValue("sub-1"));
  });

  it("shows 'Grading not started' when there is no run and grading isn't done", async () => {
    mockedGradingService.getGradingResult.mockResolvedValue({
      gradingRun: null,
      isPublished: false,
      gradingDone: false,
    });

    renderPage();

    expect(await screen.findByText("Grading not started")).toBeInTheDocument();
  });

  it("shows a pending banner while grading is done but not yet published", async () => {
    mockedGradingService.getGradingResult.mockResolvedValue({
      gradingRun: null,
      isPublished: false,
      gradingDone: true,
    });

    renderPage();

    expect(await screen.findByText(/đang chờ giảng viên xem xét/i)).toBeInTheDocument();
  });

  it("renders the published grading breakdown with scores", async () => {
    mockedGradingService.getGradingResult.mockResolvedValue({
      gradingRun: {
        id: "run-1",
        submissionId: "sub-1",
        model: "gpt-test",
        status: "completed",
        createdAt: "2024-01-01T00:00:00.000Z",
        completedAt: "2024-01-02T00:00:00.000Z",
        scores: [
          {
            id: "score-1",
            rubricCriterionId: "crit-1",
            maxScore: 10,
            suggestedScore: 8,
            evidence: "Good structure",
            comment: "Well done",
          },
        ],
      },
      isPublished: true,
      gradingDone: true,
    });
    mockedGradingService.getFinalGrade.mockResolvedValue({
      id: "grade-1",
      submissionId: "sub-1",
      finalScore: 8,
      notes: "Nice work",
      createdAt: "2024-01-02T00:00:00.000Z",
    });
    mockedApiClient.apiGet.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("8.0 / 10")).toBeInTheDocument();
    expect(screen.getByText(/nice work/i)).toBeInTheDocument();
    expect(screen.getByText("Good structure")).toBeInTheDocument();
    expect(screen.getByText(/điểm đã được công bố: 8/i)).toBeInTheDocument();
  });

  it("shows a retry button and calls the retry endpoint when extraction failed", async () => {
    mockedSubmissionService.listMySubmissions.mockResolvedValue([{ ...submission, state: "failed" }]);
    mockedGradingService.getGradingResult.mockResolvedValue({
      gradingRun: null,
      isPublished: false,
      gradingDone: false,
    });
    mockedApiClient.apiPost.mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage();

    const retryButton = await screen.findByRole("button", { name: /thử chấm lại/i });
    await user.click(retryButton);

    await waitFor(() =>
      expect(mockedApiClient.apiPost).toHaveBeenCalledWith("/submissions/submissions/sub-1/retry"),
    );
  });

  it("surfaces the grading-result query error", async () => {
    mockedGradingService.getGradingResult.mockRejectedValue(new Error("network down"));

    renderPage();

    expect(await screen.findByText("network down")).toBeInTheDocument();
  });

  it("shows Grading failed with no score summary when the run failed but is published", async () => {
    mockedGradingService.getGradingResult.mockResolvedValue({
      gradingRun: {
        id: "run-1",
        submissionId: "sub-1",
        model: "gpt-test",
        status: "failed",
        createdAt: "2024-01-01T00:00:00.000Z",
        completedAt: null,
        scores: [],
      },
      isPublished: true,
      gradingDone: true,
    });

    renderPage();

    expect(await screen.findByText("Grading failed")).toBeInTheDocument();
    expect(screen.getByText(/the grading job failed/i)).toBeInTheDocument();
  });
});
