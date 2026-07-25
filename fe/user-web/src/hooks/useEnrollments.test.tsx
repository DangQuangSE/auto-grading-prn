import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as classService from "../services/classService";
import * as enrollmentService from "../services/enrollmentService";
import * as subjectService from "../services/subjectService";
import {
  useMyEnrollments,
  useOpenSubjects,
  useSaveMyEnrollment,
  useSubjectClasses,
} from "./useEnrollments";

vi.mock("../services/classService");
vi.mock("../services/enrollmentService");
vi.mock("../services/subjectService");

const mockedClassService = vi.mocked(classService);
const mockedEnrollmentService = vi.mocked(enrollmentService);
const mockedSubjectService = vi.mocked(subjectService);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return {
    Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
    queryClient,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useOpenSubjects", () => {
  it("loads open subjects", async () => {
    mockedSubjectService.listOpenSubjects.mockResolvedValue([
      { id: "s1", code: "SE100", name: "Intro", createdAt: "2024-01-01", registrationStatus: "open" },
    ]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useOpenSubjects(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});

describe("useSubjectClasses", () => {
  it("does not fetch for an empty subjectId", () => {
    mockedClassService.getClassesBySubject.mockResolvedValue([]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useSubjectClasses(""), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedClassService.getClassesBySubject).not.toHaveBeenCalled();
  });

  it("fetches classes for a given subjectId", async () => {
    mockedClassService.getClassesBySubject.mockResolvedValue([{ id: "c1", name: "SE1801" }]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useSubjectClasses("s1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedClassService.getClassesBySubject).toHaveBeenCalledWith("s1");
    expect(result.current.data).toEqual([{ id: "c1", name: "SE1801" }]);
  });
});

describe("useMyEnrollments", () => {
  it("loads current enrollments", async () => {
    mockedEnrollmentService.listMyEnrollments.mockResolvedValue([]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useMyEnrollments(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedEnrollmentService.listMyEnrollments).toHaveBeenCalledTimes(1);
  });

  it("surfaces errors", async () => {
    mockedEnrollmentService.listMyEnrollments.mockRejectedValue(new Error("enroll failed"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useMyEnrollments(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("enroll failed");
  });
});

describe("useSaveMyEnrollment", () => {
  it("calls saveMyEnrollment and invalidates enrollments/me on settle", async () => {
    mockedEnrollmentService.saveMyEnrollment.mockResolvedValue({} as any);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSaveMyEnrollment(), { wrapper: Wrapper });

    result.current.mutate({ subjectId: "s1", classId: "c1", rowVersion: null });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedEnrollmentService.saveMyEnrollment).toHaveBeenCalledWith(
      { subjectId: "s1", classId: "c1", rowVersion: null },
      expect.anything(),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["enrollments", "me"] });
  });

  it("still invalidates enrollments/me when the mutation fails", async () => {
    mockedEnrollmentService.saveMyEnrollment.mockRejectedValue(new Error("conflict"));
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSaveMyEnrollment(), { wrapper: Wrapper });

    result.current.mutate({ subjectId: "s1", classId: "c1", rowVersion: null });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["enrollments", "me"] });
  });
});
