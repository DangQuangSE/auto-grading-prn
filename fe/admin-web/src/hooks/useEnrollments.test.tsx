import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as enrollmentService from "../services/enrollmentService";
import { useAdminEnrollments, useCorrectEnrollment } from "./useEnrollments";

vi.mock("../services/enrollmentService");

const mockedEnrollmentService = vi.mocked(enrollmentService);

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

const enrollmentsPage = {
  items: [
    {
      id: "enrollment-1",
      studentId: "student-1",
      subjectId: "subject-1",
      subjectCode: "SWD392",
      subjectName: "Software Development",
      registrationStatus: "open" as const,
      classId: "class-1",
      className: "SE1801",
      rowVersion: "v1",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ],
  page: 1,
  pageSize: 100,
  totalCount: 1,
  totalPages: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useAdminEnrollments", () => {
  it("loads enrollments for a student", async () => {
    mockedEnrollmentService.listEnrollments.mockResolvedValue(enrollmentsPage);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useAdminEnrollments("student-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(enrollmentsPage);
    expect(mockedEnrollmentService.listEnrollments).toHaveBeenCalledWith("student-1");
  });

  it("does not query when studentId is empty", () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useAdminEnrollments(""), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedEnrollmentService.listEnrollments).not.toHaveBeenCalled();
  });

  it("surfaces errors", async () => {
    mockedEnrollmentService.listEnrollments.mockRejectedValue(new ApiError(500, "Server error"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useAdminEnrollments("student-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Server error");
  });
});

describe("useCorrectEnrollment", () => {
  it("corrects an enrollment and invalidates the student's enrollment query", async () => {
    const updated = { ...enrollmentsPage.items[0], classId: "class-2", className: "SE1802" };
    mockedEnrollmentService.correctEnrollment.mockResolvedValue(updated);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const variables = { studentId: "student-1", subjectId: "subject-1", classId: "class-2", rowVersion: "v1" };
    const { result } = renderHook(() => useCorrectEnrollment(), { wrapper: Wrapper });

    result.current.mutate(variables);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedEnrollmentService.correctEnrollment).toHaveBeenCalledWith(variables, expect.anything());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["admin-enrollments", "student-1"] });
  });

  it("invalidates the enrollment query even when the mutation fails", async () => {
    mockedEnrollmentService.correctEnrollment.mockRejectedValue(new ApiError(409, "Stale version"));
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const variables = { studentId: "student-1", subjectId: "subject-1", classId: "class-2", rowVersion: "v1" };
    const { result } = renderHook(() => useCorrectEnrollment(), { wrapper: Wrapper });

    result.current.mutate(variables);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["admin-enrollments", "student-1"] });
  });
});
