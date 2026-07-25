import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as AuthProviderModule from "../providers/AuthProvider";
import * as classService from "../services/classService";
import * as gradeExportService from "../services/gradeExportService";
import * as gradingService from "../services/gradingService";
import * as reviewService from "../services/reviewService";
import * as rosterService from "../services/rosterService";
import * as subjectService from "../services/subjectService";
import * as submissionService from "../services/submissionService";
import { SubmissionReviewPage } from "./SubmissionReviewPage";

vi.mock("../services/classService");
vi.mock("../services/gradeExportService");
vi.mock("../services/gradingService");
vi.mock("../services/reviewService");
vi.mock("../services/rosterService");
vi.mock("../services/subjectService");
vi.mock("../services/submissionService");

vi.mock("../providers/AuthProvider", async () => {
  const actual = await vi.importActual<typeof import("../providers/AuthProvider")>("../providers/AuthProvider");
  return { ...actual, useAuth: vi.fn() };
});

const mockedClassService = vi.mocked(classService);
const mockedGradeExportService = vi.mocked(gradeExportService);
const mockedGradingService = vi.mocked(gradingService);
const mockedReviewService = vi.mocked(reviewService);
const mockedRosterService = vi.mocked(rosterService);
const mockedSubjectService = vi.mocked(subjectService);
const mockedSubmissionService = vi.mocked(submissionService);
const mockedUseAuth = vi.mocked(AuthProviderModule.useAuth);

function renderPage(initialPath = "/review") {
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
      <Route path="/review" element={<SubmissionReviewPage />} />
      <Route path="/review/:submissionId" element={<SubmissionReviewPage />} />
    </Routes>,
    { wrapper: Wrapper },
  );
}

const emptySubjects = { items: [], page: 1, pageSize: 1000, totalCount: 0, totalPages: 1 };
const emptyAssignments = { items: [], page: 1, pageSize: 1000, totalCount: 0, totalPages: 1 };

const recentRows = [
  { id: "sub-1", assignment_id: "assignment-1", student_id: "student-1", state: "graded" as const, submitted_at: "2026-01-01T00:00:00Z" },
];

const reviewScore = {
  id: "score-1",
  rubric_criterion_id: "criterion-1",
  suggested_score: 8,
  max_score: 10,
  comment: "Good work",
  evidence: [{ reference: "p.1" }],
  rubric_criteria: { criterion_code: "C1", title: "Design quality", description: "desc" },
};

const reviewData = {
  submission: { id: "sub-1", state: "graded" },
  artifacts: [
    { artifact_type: "document" as const, content: { text: "doc" }, warnings: null },
    { artifact_type: "diagram" as const, content: { nodes: [] }, warnings: null },
  ],
  aiScores: [reviewScore],
};

beforeEach(() => {
  vi.resetAllMocks();
  mockedUseAuth.mockReturnValue({
    session: { token: "t", user: { id: "lecturer-1", email: "lecturer@school.edu", role: "lecturer" } },
    setSession: vi.fn(),
    signOut: vi.fn(),
  });
  mockedSubjectService.listSubjects.mockResolvedValue(emptySubjects);
  mockedSubjectService.listAssignments.mockResolvedValue(emptyAssignments);
  mockedClassService.getClasses.mockResolvedValue([]);
  mockedGradingService.listRecentSubmissions.mockResolvedValue(recentRows);
  mockedGradeExportService.getAssignments.mockResolvedValue([]);
  mockedSubmissionService.listAssignmentSubmissions.mockResolvedValue([]);
  mockedGradeExportService.batchGetGrades.mockResolvedValue([]);
  mockedRosterService.getUsersByIds.mockResolvedValue([]);
});

describe("SubmissionReviewPage list view", () => {
  it("renders recent submissions with a link to review each one", async () => {
    renderPage();

    expect(await screen.findByText("Select a submission")).toBeInTheDocument();
    expect(await screen.findByText("sub-1".slice(0, 8))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review/i })).toHaveAttribute("href", "/review/sub-1");
  });

  it("shows an empty state when there are no recent submissions", async () => {
    mockedGradingService.listRecentSubmissions.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No submissions to review")).toBeInTheDocument();
  });

  it("shows the publish-all button and result only for an admin", async () => {
    mockedUseAuth.mockReturnValue({
      session: { token: "t", user: { id: "admin-1", email: "admin@school.edu", role: "admin" } },
      setSession: vi.fn(),
      signOut: vi.fn(),
    });
    mockedReviewService.publishAllGrades.mockResolvedValue({ published: 3, skipped: 1, failed: 0 });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Select a submission");
    await user.click(screen.getByRole("button", { name: /publish all ready grades/i }));

    expect(await screen.findByText("Published 3; skipped 1; failed 0.")).toBeInTheDocument();
  });

  it("does not show the publish-all button for a lecturer", async () => {
    renderPage();

    await screen.findByText("Select a submission");
    expect(screen.queryByRole("button", { name: /publish all ready grades/i })).not.toBeInTheDocument();
  });
});

describe("SubmissionReviewPage detail view", () => {
  it("shows a loading state while the review data loads", () => {
    mockedGradingService.getSubmissionReviewData.mockReturnValue(new Promise(() => {}));

    renderPage("/review/sub-1");

    expect(screen.getByText("Loading review")).toBeInTheDocument();
  });

  it("shows an error state when the review data fails to load", async () => {
    mockedGradingService.getSubmissionReviewData.mockRejectedValue(new ApiError(500, "Server error"));

    renderPage("/review/sub-1");

    expect(await screen.findByText("Unable to load review")).toBeInTheDocument();
    expect(screen.getByText("Server error")).toBeInTheDocument();
  });

  it("renders criterion scores pre-filled with the AI-suggested score", async () => {
    mockedGradingService.getSubmissionReviewData.mockResolvedValue(reviewData as any);

    renderPage("/review/sub-1");

    expect(await screen.findByText("Design quality")).toBeInTheDocument();
    expect(screen.getByText("p.1")).toBeInTheDocument();
    expect(screen.getByText("Good work")).toBeInTheDocument();
    expect(screen.getByText("AI: 8 / 10")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(8);
  });

  it("lets the lecturer edit the final score for a criterion", async () => {
    mockedGradingService.getSubmissionReviewData.mockResolvedValue(reviewData as any);

    const user = userEvent.setup();
    renderPage("/review/sub-1");

    const scoreInput = await screen.findByRole("spinbutton");
    await user.clear(scoreInput);
    await user.type(scoreInput, "9.5");

    expect(scoreInput).toHaveValue(9.5);
  });

  it("saves the final score using the edited value", async () => {
    mockedGradingService.getSubmissionReviewData.mockResolvedValue(reviewData as any);
    mockedReviewService.saveFinalCriterionScore.mockResolvedValue({} as any);

    const user = userEvent.setup();
    renderPage("/review/sub-1");

    const scoreInput = await screen.findByRole("spinbutton");
    await user.clear(scoreInput);
    await user.type(scoreInput, "9.5");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockedReviewService.saveFinalCriterionScore).toHaveBeenCalledWith(
        {
          submissionId: "sub-1",
          criterionId: "criterion-1",
          aiCriterionScoreId: "score-1",
          finalScore: 9.5,
          finalComment: "Good work",
          maxScore: 10,
          lecturerId: "lecturer-1",
        },
        expect.anything(),
      );
    });
    expect(await screen.findByText("Final scores saved.")).toBeInTheDocument();
  });

  it("publishes the grade for the submission", async () => {
    mockedGradingService.getSubmissionReviewData.mockResolvedValue(reviewData as any);
    mockedReviewService.publishSubmissionGrade.mockResolvedValue({} as any);

    const user = userEvent.setup();
    renderPage("/review/sub-1");

    await screen.findByText("Design quality");
    await user.click(screen.getByRole("button", { name: /^publish$/i }));

    await waitFor(() => {
      expect(mockedReviewService.publishSubmissionGrade).toHaveBeenCalledWith(
        { submissionId: "sub-1", lecturerId: "lecturer-1" },
        expect.anything(),
      );
    });
    expect(await screen.findByText("Grade published.")).toBeInTheDocument();
  });

  it("triggers a regrade with the entered assignment description", async () => {
    mockedGradingService.getSubmissionReviewData.mockResolvedValue(reviewData as any);
    mockedReviewService.triggerRegrade.mockResolvedValue(null as any);

    const user = userEvent.setup();
    renderPage("/review/sub-1");

    await screen.findByText("Design quality");
    await user.type(
      screen.getByPlaceholderText(/paste assignment brief/i),
      "Mã đề 123",
    );
    await user.click(screen.getByRole("button", { name: /^regrade$/i }));

    await waitFor(() => {
      expect(mockedReviewService.triggerRegrade).toHaveBeenCalledWith(
        { submissionId: "sub-1", assignmentDescription: "Mã đề 123" },
        expect.anything(),
      );
    });
    expect(await screen.findByText(/regrade queued/i)).toBeInTheDocument();
  });

  it("shows a message when there are no AI scores yet", async () => {
    mockedGradingService.getSubmissionReviewData.mockResolvedValue({
      ...reviewData,
      aiScores: [],
    } as any);

    renderPage("/review/sub-1");

    expect(await screen.findByText("No AI scores yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  // Note: SubmissionReviewPage's handleSave/handlePublish/handleRegrade call their
  // mutateAsync without a try/catch, so driving a rejection through the real Save/Publish/
  // Regrade button here would leave an unhandled promise rejection (a pre-existing source
  // bug, not something this suite should paper over). The mutation error-rendering path is
  // covered at the hook level instead (see useSubmissions.test.tsx).
});
