import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet } from "../lib/apiClient";
import {
  getSubmissionReviewData,
  listRecentSubmissions,
  retrySubmission,
  triggerAiGrading,
  triggerExtraction,
} from "./gradingService";

vi.mock("../lib/apiClient");

const mockedApiGet = vi.mocked(apiGet);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("triggerExtraction / triggerAiGrading", () => {
  it("are no-ops that resolve to null without calling the API", async () => {
    await expect(triggerExtraction("sub-1")).resolves.toBeNull();
    await expect(triggerAiGrading("sub-1")).resolves.toBeNull();
    expect(mockedApiGet).not.toHaveBeenCalled();
  });
});

describe("retrySubmission", () => {
  it("calls both no-op triggers and resolves to null", async () => {
    await expect(retrySubmission("sub-1", "actor-1")).resolves.toBeNull();
  });
});

describe("listRecentSubmissions", () => {
  it("fetches submissions, sorts newest-first, caps at 20, and maps to snake_case shape", async () => {
    const submissions = [
      { id: "s1", assignmentId: "a1", studentId: "st1", reportObjectKey: "r1", diagramObjectKey: "d1", state: "uploaded", createdAt: "2024-01-01", updatedAt: "2024-01-01" },
      { id: "s2", assignmentId: "a2", studentId: "st2", reportObjectKey: "r2", diagramObjectKey: "d2", state: "graded", createdAt: "2024-03-01", updatedAt: "2024-03-01" },
      { id: "s3", assignmentId: "a3", studentId: "st3", reportObjectKey: "r3", diagramObjectKey: "d3", state: "failed", createdAt: "2024-02-01", updatedAt: "2024-02-01" },
    ];
    mockedApiGet.mockResolvedValueOnce(submissions);

    const result = await listRecentSubmissions();

    expect(mockedApiGet).toHaveBeenCalledWith("/submissions/submissions");
    expect(result.map((r) => r.id)).toEqual(["s2", "s3", "s1"]);
    expect(result[0]).toEqual({
      id: "s2",
      assignment_id: "a2",
      student_id: "st2",
      state: "graded",
      submitted_at: "2024-03-01",
    });
  });

  it("caps the result at 20 items", async () => {
    const submissions = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      assignmentId: "a1",
      studentId: "st1",
      reportObjectKey: "r",
      diagramObjectKey: "d",
      state: "uploaded",
      createdAt: `2024-01-${String(i + 1).padStart(2, "0")}`,
      updatedAt: "2024-01-01",
    }));
    mockedApiGet.mockResolvedValueOnce(submissions);

    const result = await listRecentSubmissions();

    expect(result).toHaveLength(20);
  });
});

describe("getSubmissionReviewData", () => {
  const submission = {
    id: "sub-1",
    assignmentId: "assignment-1",
    studentId: "student-1",
    reportObjectKey: "r",
    diagramObjectKey: "d",
    state: "graded",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    artifacts: [
      { id: "art-1", submissionId: "sub-1", kind: "report", content: "extracted text", warnings: null, createdAt: "2024-01-01" },
      { id: "art-2", submissionId: "sub-1", kind: "diagram", content: null, warnings: "some warning", createdAt: "2024-01-01" },
    ],
  };

  const runs = [
    {
      id: "run-1",
      submissionId: "sub-1",
      model: "gpt",
      status: "completed",
      createdAt: "2024-01-02",
      completedAt: "2024-01-02",
      scores: [
        {
          id: "score-1",
          gradingRunId: "run-1",
          submissionId: "sub-1",
          rubricCriterionId: "criterion-1",
          maxScore: 10,
          suggestedScore: 8,
          deductions: null,
          evidence: null,
          comment: "Good job",
          confidence: 1,
        },
      ],
    },
    {
      id: "run-0",
      submissionId: "sub-1",
      model: "gpt",
      status: "completed",
      createdAt: "2024-01-01",
      completedAt: "2024-01-01",
      scores: [],
    },
  ];

  const rubrics = [
    {
      id: "rubric-1",
      subjectId: "subject-1",
      assignmentId: "assignment-1",
      name: "Rubric",
      createdAt: "2024-01-01",
      status: "confirmed" as const,
      scope: "lecturer" as const,
      criteria: [
        { id: "criterion-1", rubricId: "rubric-1", code: "C1", name: "Correctness", description: "desc", maxScore: 10, orderIndex: 0 },
      ],
    },
  ];

  it("requests the submission and grading runs concurrently by path", async () => {
    mockedApiGet.mockImplementation((path: string) => {
      if (path === "/submissions/submissions/sub-1") return Promise.resolve(submission);
      if (path === "/grading/grades/sub-1/runs") return Promise.resolve(runs);
      if (path === "/catalog/rubrics?assignmentId=assignment-1") return Promise.resolve(rubrics);
      throw new Error(`Unexpected path: ${path}`);
    });

    const result = await getSubmissionReviewData("sub-1");

    expect(mockedApiGet).toHaveBeenCalledWith("/submissions/submissions/sub-1");
    expect(mockedApiGet).toHaveBeenCalledWith("/grading/grades/sub-1/runs");
    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/rubrics?assignmentId=assignment-1");

    expect(result.submission).toBe(submission);
    expect(result.artifacts).toEqual([
      { id: "art-1", artifact_type: "document", content: "extracted text", warnings: null },
      { id: "art-2", artifact_type: "diagram", content: null, warnings: "some warning" },
    ]);
    // Should use the latest run (run-1, createdAt 2024-01-02) and enrich with rubric criterion.
    expect(result.aiScores).toEqual([
      {
        id: "score-1",
        rubric_criterion_id: "criterion-1",
        suggested_score: 8,
        max_score: 10,
        comment: "Good job",
        evidence: null,
        rubric_criteria: { criterion_code: "C1", title: "Correctness", description: "desc" },
      },
    ]);
  });

  it("does not enrich scores with rubric_criteria when the rubric lookup fails", async () => {
    mockedApiGet.mockImplementation((path: string) => {
      if (path === "/submissions/submissions/sub-1") return Promise.resolve(submission);
      if (path === "/grading/grades/sub-1/runs") return Promise.resolve(runs);
      if (path === "/catalog/rubrics?assignmentId=assignment-1") return Promise.reject(new Error("not found"));
      throw new Error(`Unexpected path: ${path}`);
    });

    const result = await getSubmissionReviewData("sub-1");

    expect(result.aiScores[0].rubric_criteria).toBeNull();
  });

  it("returns an empty aiScores array when there are no grading runs", async () => {
    mockedApiGet.mockImplementation((path: string) => {
      if (path === "/submissions/submissions/sub-1") return Promise.resolve({ ...submission, artifacts: [] });
      if (path === "/grading/grades/sub-1/runs") return Promise.resolve([]);
      throw new Error(`Unexpected path: ${path}`);
    });

    const result = await getSubmissionReviewData("sub-1");

    expect(result.aiScores).toEqual([]);
    expect(result.artifacts).toEqual([]);
  });
});
