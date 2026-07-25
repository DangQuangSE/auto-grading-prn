import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as subjectService from "../services/subjectService";
import { useAllAssignments, useAssignments, useSubjects } from "./useSubjects";

vi.mock("../services/subjectService");

const mockedSubjectService = vi.mocked(subjectService);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useSubjects", () => {
  it("loads subjects", async () => {
    mockedSubjectService.listSubjects.mockResolvedValue([
      { id: "s1", code: "SE100", name: "Intro", createdAt: "2024-01-01", registrationStatus: "open" },
    ]);

    const { result } = renderHook(() => useSubjects(), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(mockedSubjectService.listSubjects).toHaveBeenCalledTimes(1);
  });

  it("surfaces subject loading errors", async () => {
    mockedSubjectService.listSubjects.mockRejectedValue(new Error("subjects failed"));

    const { result } = renderHook(() => useSubjects(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("subjects failed");
  });
});

describe("useAssignments", () => {
  it("does not fetch when subjectId is undefined", () => {
    mockedSubjectService.listAssignments.mockResolvedValue([]);

    const { result } = renderHook(() => useAssignments(undefined), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedSubjectService.listAssignments).not.toHaveBeenCalled();
  });

  it("fetches assignments for the given subjectId", async () => {
    mockedSubjectService.listAssignments.mockResolvedValue([
      {
        id: "a1",
        subjectId: "s1",
        title: "Assignment 1",
        maxAttempts: 3,
        createdAt: "2024-01-01",
      },
    ]);

    const { result } = renderHook(() => useAssignments("s1"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedSubjectService.listAssignments).toHaveBeenCalledWith("s1");
    expect(result.current.data).toHaveLength(1);
  });
});

describe("useAllAssignments", () => {
  it("fetches all assignments with no subjectId", async () => {
    mockedSubjectService.listAssignments.mockResolvedValue([]);

    const { result } = renderHook(() => useAllAssignments(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedSubjectService.listAssignments).toHaveBeenCalledWith();
  });
});
