import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as classService from "../services/classService";
import { useClasses, useCreateClass, useLecturers, useUpdateClass } from "./useClasses";

vi.mock("../services/classService");

const mockedClassService = vi.mocked(classService);

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

const classA = { id: "class-1", name: "SE1801", lecturerId: "lecturer-a" };
const lecturerA = { id: "lecturer-a", email: "a@school.edu", fullName: "Lecturer A" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useClasses", () => {
  it("loads classes", async () => {
    mockedClassService.getClasses.mockResolvedValue([classA]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useClasses(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([classA]);
  });

  it("surfaces errors", async () => {
    mockedClassService.getClasses.mockRejectedValue(new ApiError(500, "Server error"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useClasses(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Server error");
  });
});

describe("useLecturers", () => {
  it("loads lecturers", async () => {
    mockedClassService.fetchLecturers.mockResolvedValue([lecturerA]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useLecturers(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([lecturerA]);
  });
});

describe("useCreateClass", () => {
  it("creates a class and invalidates the classes query", async () => {
    mockedClassService.createClass.mockResolvedValue(classA);
    mockedClassService.getClasses.mockResolvedValue([classA]);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateClass(), { wrapper: Wrapper });

    result.current.mutate({ name: "SE1801", lecturerId: "lecturer-a", subjectId: "subject-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedClassService.createClass).toHaveBeenCalledWith(
      { name: "SE1801", lecturerId: "lecturer-a", subjectId: "subject-1" },
      expect.anything(),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["classes"] });
  });
});

describe("useUpdateClass", () => {
  it("updates a class and invalidates the classes query", async () => {
    mockedClassService.updateClass.mockResolvedValue({ ...classA, lecturerId: "lecturer-b" });
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateClass(), { wrapper: Wrapper });

    result.current.mutate({ classId: "class-1", changes: { lecturerId: "lecturer-b" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedClassService.updateClass).toHaveBeenCalledWith("class-1", { lecturerId: "lecturer-b" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["classes"] });
  });
});
