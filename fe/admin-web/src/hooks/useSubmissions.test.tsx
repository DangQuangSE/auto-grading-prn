import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as gradingService from "../services/gradingService";
import * as reviewService from "../services/reviewService";
import {
  usePublishAllGrades,
  usePublishGrade,
  useRecentSubmissions,
  useRegrade,
  useSaveFinalScore,
  useSubmissionReview,
} from "./useSubmissions";

vi.mock("../services/gradingService");
vi.mock("../services/reviewService");

const mockedGradingService = vi.mocked(gradingService);
const mockedReviewService = vi.mocked(reviewService);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

const recentSubmissions = [
  { id: "sub-1", assignment_id: "assignment-1", student_id: "user-a", state: "graded", submitted_at: "2026-01-01" },
];

const reviewData = { submission: { id: "sub-1" }, artifacts: [], aiScores: [] };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useRecentSubmissions", () => {
  it("loads recent submissions", async () => {
    mockedGradingService.listRecentSubmissions.mockResolvedValue(recentSubmissions as any);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useRecentSubmissions(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(recentSubmissions);
  });

  it("surfaces errors", async () => {
    mockedGradingService.listRecentSubmissions.mockRejectedValue(new ApiError(500, "Server error"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useRecentSubmissions(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Server error");
  });
});

describe("useSubmissionReview", () => {
  it("loads review data when a submissionId is given", async () => {
    mockedGradingService.getSubmissionReviewData.mockResolvedValue(reviewData as any);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useSubmissionReview("sub-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGradingService.getSubmissionReviewData).toHaveBeenCalledWith("sub-1");
    expect(result.current.data).toEqual(reviewData);
  });

  it("does not query when submissionId is undefined", () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useSubmissionReview(undefined), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedGradingService.getSubmissionReviewData).not.toHaveBeenCalled();
  });
});

describe("useSaveFinalScore", () => {
  it("saves the final score and invalidates review and submissions queries", async () => {
    const input = {
      submissionId: "sub-1",
      criterionId: "criterion-1",
      finalScore: 9,
      finalComment: "Good",
      maxScore: 10,
      lecturerId: "lecturer-1",
    };
    mockedReviewService.saveFinalCriterionScore.mockResolvedValue(input as any);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSaveFinalScore(), { wrapper: Wrapper });

    result.current.mutate(input);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["submission-review", "sub-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["submissions"] });
  });

  it("surfaces errors", async () => {
    mockedReviewService.saveFinalCriterionScore.mockRejectedValue(new ApiError(500, "Server error"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useSaveFinalScore(), { wrapper: Wrapper });

    result.current.mutate({
      submissionId: "sub-1",
      criterionId: "criterion-1",
      finalScore: 9,
      finalComment: "Good",
      maxScore: 10,
      lecturerId: "lecturer-1",
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Server error");
  });
});

describe("usePublishGrade", () => {
  it("publishes a grade and invalidates review and submissions queries", async () => {
    mockedReviewService.publishSubmissionGrade.mockResolvedValue({} as any);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => usePublishGrade(), { wrapper: Wrapper });

    result.current.mutate({ submissionId: "sub-1", lecturerId: "lecturer-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["submission-review", "sub-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["submissions"] });
  });

  it("surfaces errors", async () => {
    mockedReviewService.publishSubmissionGrade.mockRejectedValue(new Error("Cannot publish without AI criterion scores."));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => usePublishGrade(), { wrapper: Wrapper });

    result.current.mutate({ submissionId: "sub-1", lecturerId: "lecturer-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Cannot publish without AI criterion scores.");
  });
});

describe("usePublishAllGrades", () => {
  it("publishes all grades and invalidates submissions and review queries", async () => {
    mockedReviewService.publishAllGrades.mockResolvedValue({ published: 2, skipped: 1, failed: 0 });
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => usePublishAllGrades(), { wrapper: Wrapper });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ published: 2, skipped: 1, failed: 0 });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["submissions"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["submission-review"] });
  });
});

describe("useRegrade", () => {
  it("schedules a submission-review invalidation 3s after a successful regrade trigger", async () => {
    mockedReviewService.triggerRegrade.mockResolvedValue(null as any);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { result } = renderHook(() => useRegrade(), { wrapper: Wrapper });

    result.current.mutate({ submissionId: "sub-1", assignmentDescription: "desc" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedReviewService.triggerRegrade).toHaveBeenCalledWith(
      { submissionId: "sub-1", assignmentDescription: "desc" },
      expect.anything(),
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3000);

    const scheduledCall = setTimeoutSpy.mock.calls.find((call) => call[1] === 3000)!;
    const scheduledCallback = scheduledCall[0] as () => void;
    scheduledCallback();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["submission-review", "sub-1"] });
  });
});
