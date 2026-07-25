import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as gradeExportService from "../services/gradeExportService";
import * as rosterService from "../services/rosterService";
import * as submissionService from "../services/submissionService";
import { useAssignmentsForExport, useGradeTable } from "./useGradeTable";

vi.mock("../services/gradeExportService");
vi.mock("../services/rosterService");
vi.mock("../services/submissionService");

const mockedGradeExportService = vi.mocked(gradeExportService);
const mockedRosterService = vi.mocked(rosterService);
const mockedSubmissionService = vi.mocked(submissionService);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const assignment = { id: "assignment-1", subjectId: "subject-1", title: "Assignment 1", createdAt: "2026-01-01" };

const submissions = [
  {
    id: "sub-1",
    assignmentId: "assignment-1",
    studentId: "user-a",
    reportObjectKey: "",
    diagramObjectKey: "",
    state: "graded" as const,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
  {
    id: "sub-2",
    assignmentId: "assignment-1",
    studentId: "user-b",
    reportObjectKey: "",
    diagramObjectKey: "",
    state: "uploaded" as const,
    createdAt: "2026-01-02",
    updatedAt: "2026-01-02",
  },
];

const users = [
  { id: "user-a", email: "a@b.com", fullName: "Alice Nguyen", role: "student", studentCode: "SE100001", classId: "class-1", className: "SE1801" },
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useAssignmentsForExport", () => {
  it("loads assignments", async () => {
    mockedGradeExportService.getAssignments.mockResolvedValue([assignment]);
    const { result } = renderHook(() => useAssignmentsForExport(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([assignment]);
  });
});

describe("useGradeTable", () => {
  it("joins submissions, grades and users into grade table rows", async () => {
    mockedSubmissionService.listAssignmentSubmissions.mockResolvedValue(submissions);
    mockedGradeExportService.batchGetGrades.mockResolvedValue([
      { submissionId: "sub-1", finalGradeId: "grade-1", finalScore: 9.5, createdAt: "2026-01-02" },
    ]);
    mockedRosterService.getUsersByIds.mockResolvedValue(users);

    const { result } = renderHook(() => useGradeTable("assignment-1"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedSubmissionService.listAssignmentSubmissions).toHaveBeenCalledWith("assignment-1");
    expect(mockedRosterService.getUsersByIds).toHaveBeenCalledWith(["user-a", "user-b"]);
    expect(result.current.data).toEqual([
      {
        submissionId: "sub-1",
        studentName: "Alice Nguyen",
        mssv: "SE100001",
        className: "SE1801",
        finalScore: 9.5,
        state: "graded",
        submittedAt: "2026-01-01",
      },
      {
        submissionId: "sub-2",
        studentName: "Unknown student",
        mssv: null,
        className: null,
        finalScore: null,
        state: "uploaded",
        submittedAt: "2026-01-02",
      },
    ]);
  });

  it("does not query when assignmentId is undefined", () => {
    const { result } = renderHook(() => useGradeTable(undefined), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedSubmissionService.listAssignmentSubmissions).not.toHaveBeenCalled();
  });

  it("surfaces errors from the submissions call", async () => {
    mockedSubmissionService.listAssignmentSubmissions.mockRejectedValue(new ApiError(500, "Server error"));

    const { result } = renderHook(() => useGradeTable("assignment-1"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Server error");
  });
});
