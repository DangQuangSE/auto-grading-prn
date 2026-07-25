import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as subjectService from "../services/subjectService";
import {
  useAllAssignments,
  useAllSubjects,
  useAssignments,
  useCreateAssignment,
  useCreateSubject,
  useSubjects,
  useUpdateSubjectRegistration,
} from "./useSubjects";

vi.mock("../services/subjectService");

const mockedSubjectService = vi.mocked(subjectService);

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

const subjectsPage = {
  items: [{ id: "subject-1", code: "SWD392", name: "Software Development", registrationStatus: "open" as const, createdAt: "2026-01-01" }],
  page: 1,
  pageSize: 5,
  totalCount: 1,
  totalPages: 1,
};

const assignmentsPage = {
  items: [{ id: "assignment-1", subjectId: "subject-1", title: "Assignment 1", createdAt: "2026-01-01" }],
  page: 1,
  pageSize: 5,
  totalCount: 1,
  totalPages: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useSubjects", () => {
  it("loads subjects with default page and pageSize", async () => {
    mockedSubjectService.listSubjects.mockResolvedValue(subjectsPage);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useSubjects(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedSubjectService.listSubjects).toHaveBeenCalledWith({ page: 1, pageSize: 5, search: "" });
    expect(result.current.data).toEqual(subjectsPage);
  });

  it("passes through custom page, pageSize and search", async () => {
    mockedSubjectService.listSubjects.mockResolvedValue(subjectsPage);
    const { Wrapper } = createWrapper();

    renderHook(() => useSubjects({ page: 2, pageSize: 10, search: "swd" }), { wrapper: Wrapper });

    await waitFor(() =>
      expect(mockedSubjectService.listSubjects).toHaveBeenCalledWith({ page: 2, pageSize: 10, search: "swd" }),
    );
  });

  it("surfaces errors", async () => {
    mockedSubjectService.listSubjects.mockRejectedValue(new ApiError(500, "Server error"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useSubjects(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Server error");
  });
});

describe("useAllSubjects", () => {
  it("loads all subjects", async () => {
    mockedSubjectService.listAllSubjects.mockResolvedValue(subjectsPage.items);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useAllSubjects(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(subjectsPage.items);
  });
});

describe("useUpdateSubjectRegistration", () => {
  it("updates registration and invalidates the subjects query", async () => {
    mockedSubjectService.updateSubjectRegistration.mockResolvedValue(subjectsPage.items[0]);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateSubjectRegistration(), { wrapper: Wrapper });

    result.current.mutate({ subjectId: "subject-1", status: "closed" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedSubjectService.updateSubjectRegistration).toHaveBeenCalledWith("subject-1", "closed");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["subjects"] });
  });
});

describe("useCreateSubject", () => {
  it("creates a subject and invalidates the subjects query", async () => {
    mockedSubjectService.createSubject.mockResolvedValue(subjectsPage.items[0]);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateSubject(), { wrapper: Wrapper });

    result.current.mutate({ code: "SWD392", name: "Software Development", createdBy: "admin-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["subjects"] });
  });

  it("surfaces errors", async () => {
    mockedSubjectService.createSubject.mockRejectedValue(new ApiError(400, "Subject code already exists"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useCreateSubject(), { wrapper: Wrapper });

    result.current.mutate({ code: "SWD392", name: "Software Development", createdBy: "admin-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Subject code already exists");
  });
});

describe("useAssignments", () => {
  it("loads assignments scoped to a subject", async () => {
    mockedSubjectService.listAssignments.mockResolvedValue(assignmentsPage);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useAssignments("subject-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedSubjectService.listAssignments).toHaveBeenCalledWith({
      subjectId: "subject-1",
      page: 1,
      pageSize: 5,
    });
    expect(result.current.data).toEqual(assignmentsPage);
  });
});

describe("useCreateAssignment", () => {
  it("creates an assignment and invalidates related queries", async () => {
    mockedSubjectService.createAssignment.mockResolvedValue(assignmentsPage.items[0]);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateAssignment(), { wrapper: Wrapper });

    result.current.mutate({
      subjectId: "subject-1",
      title: "Assignment 1",
      createdBy: "admin-1",
      maxAttempts: 1,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["assignments", "subject-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["all-assignments"] });
  });
});

describe("useAllAssignments", () => {
  it("loads all assignments", async () => {
    mockedSubjectService.listAssignments.mockResolvedValue(assignmentsPage);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useAllAssignments(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedSubjectService.listAssignments).toHaveBeenCalledWith({});
    expect(result.current.data).toEqual(assignmentsPage);
  });
});
