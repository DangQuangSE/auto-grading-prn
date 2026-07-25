import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPost } from "../lib/apiClient";
import {
  publishAllGrades,
  publishSubmissionGrade,
  saveFinalCriterionScore,
  triggerRegrade,
} from "./reviewService";

vi.mock("../lib/apiClient");

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("triggerRegrade", () => {
  it("posts to the regrade endpoint with the assignment description", async () => {
    mockedApiPost.mockResolvedValueOnce({ ok: true });

    await triggerRegrade({ submissionId: "sub-1", assignmentDescription: "Assignment 1" });

    expect(mockedApiPost).toHaveBeenCalledWith("/grading/grades/sub-1/regrade", {
      assignmentDescription: "Assignment 1",
    });
  });

  it("defaults the assignment description to null when omitted", async () => {
    mockedApiPost.mockResolvedValueOnce({ ok: true });

    await triggerRegrade({ submissionId: "sub-1" });

    expect(mockedApiPost).toHaveBeenCalledWith("/grading/grades/sub-1/regrade", {
      assignmentDescription: null,
    });
  });
});

describe("saveFinalCriterionScore", () => {
  const validInput = {
    submissionId: "sub-1",
    criterionId: "00000000-0000-4000-8000-000000000000",
    finalScore: 8,
    finalComment: "Good",
    maxScore: 10,
    lecturerId: "lecturer-1",
  };

  it("validates input and resolves with the given input unchanged (no API call)", async () => {
    const result = await saveFinalCriterionScore(validInput);

    expect(result).toBe(validInput);
    expect(mockedApiPost).not.toHaveBeenCalled();
    expect(mockedApiGet).not.toHaveBeenCalled();
  });

  it("throws when finalScore exceeds maxScore", async () => {
    await expect(saveFinalCriterionScore({ ...validInput, finalScore: 11 })).rejects.toThrow();
  });

  it("throws when criterionId is not a uuid", async () => {
    await expect(saveFinalCriterionScore({ ...validInput, criterionId: "not-a-uuid" })).rejects.toThrow();
  });
});

describe("publishSubmissionGrade", () => {
  it("fetches runs, picks the latest, sums scores, and posts the publish payload", async () => {
    mockedApiGet.mockResolvedValueOnce([
      { id: "run-old", createdAt: "2024-01-01", scores: [{ suggestedScore: 1, maxScore: 5 }] },
      {
        id: "run-new",
        createdAt: "2024-02-01",
        scores: [
          { suggestedScore: 8, maxScore: 10 },
          { suggestedScore: 4, maxScore: 5 },
        ],
      },
    ]);
    mockedApiPost.mockResolvedValueOnce({ published: true });

    await publishSubmissionGrade({ submissionId: "sub-1", lecturerId: "lecturer-1" });

    expect(mockedApiGet).toHaveBeenCalledWith("/grading/grades/sub-1/runs");
    expect(mockedApiPost).toHaveBeenCalledWith("/grading/grades/sub-1/publish", {
      gradingRunId: "run-new",
      finalScore: 12,
      notes: null,
    });
  });

  it("throws when there are no grading runs", async () => {
    mockedApiGet.mockResolvedValueOnce([]);

    await expect(publishSubmissionGrade({ submissionId: "sub-1", lecturerId: "lecturer-1" })).rejects.toThrow(
      "Cannot publish without AI criterion scores.",
    );
    expect(mockedApiPost).not.toHaveBeenCalled();
  });

  it("throws when the latest run has no scores", async () => {
    mockedApiGet.mockResolvedValueOnce([{ id: "run-1", createdAt: "2024-01-01", scores: [] }]);

    await expect(publishSubmissionGrade({ submissionId: "sub-1", lecturerId: "lecturer-1" })).rejects.toThrow(
      "Cannot publish without AI criterion scores.",
    );
  });
});

describe("publishAllGrades", () => {
  it("posts to the publish-all endpoint and returns the result", async () => {
    const result = { published: 3, skipped: 1, failed: 0 };
    mockedApiPost.mockResolvedValueOnce(result);

    const returned = await publishAllGrades();

    expect(mockedApiPost).toHaveBeenCalledWith("/grading/grades/publish-all");
    expect(returned).toBe(result);
  });
});
