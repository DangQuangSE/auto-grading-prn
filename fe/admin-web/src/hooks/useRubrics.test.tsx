import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as rubricService from "../services/rubricService";
import {
  useConfirmRubric,
  useRubrics,
  useUnlockRubric,
  useUpdateRubricCriteria,
  useUploadRubric,
} from "./useRubrics";

vi.mock("../services/rubricService");

const mockedRubricService = vi.mocked(rubricService);

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

const draftRubric = {
  id: "rubric-1",
  subjectId: "subject-1",
  assignmentId: "assignment-1",
  name: "Rubric 1",
  createdAt: "2026-01-01",
  status: "draft" as const,
  scope: "lecturer" as const,
  criteria: [],
};

const parsingRubric = { ...draftRubric, id: "rubric-2", status: "parsing" as const };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useRubrics", () => {
  it("loads rubrics scoped by subject and assignment", async () => {
    mockedRubricService.listRubrics.mockResolvedValue([draftRubric]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useRubrics("subject-1", "assignment-1"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRubricService.listRubrics).toHaveBeenCalledWith({
      subjectId: "subject-1",
      assignmentId: "assignment-1",
    });
    expect(result.current.data).toEqual([draftRubric]);
  });

  it("polls every 2s while any rubric is parsing, and stops once none are", async () => {
    mockedRubricService.listRubrics.mockResolvedValue([parsingRubric]);
    const { Wrapper, queryClient } = createWrapper();

    renderHook(() => useRubrics(), { wrapper: Wrapper });

    await waitFor(() => {
      const query = queryClient.getQueryCache().find({ queryKey: ["rubrics", null, null] });
      expect(query?.state.status).toBe("success");
    });

    const query = queryClient.getQueryCache().find({ queryKey: ["rubrics", null, null] })!;
    const refetchInterval = query.options.refetchInterval as (query: typeof query) => number | false;

    expect(refetchInterval(query)).toBe(2000);

    query.setData([draftRubric]);
    expect(refetchInterval(query)).toBe(false);
  });

  it("surfaces errors", async () => {
    mockedRubricService.listRubrics.mockRejectedValue(new ApiError(500, "Server error"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useRubrics(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Server error");
  });
});

describe("useUploadRubric", () => {
  it("uploads a rubric and invalidates the rubrics query", async () => {
    mockedRubricService.uploadRubricDocx.mockResolvedValue(draftRubric);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUploadRubric(), { wrapper: Wrapper });
    const file = new File(["content"], "rubric.docx");

    result.current.mutate({ subjectId: "subject-1", assignmentId: "assignment-1", file, lecturerId: "lecturer-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["rubrics"] });
  });
});

describe("useUpdateRubricCriteria", () => {
  it("updates criteria and invalidates the rubrics query", async () => {
    mockedRubricService.updateRubricCriteria.mockResolvedValue([]);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateRubricCriteria(), { wrapper: Wrapper });
    const criteria = [{ name: "Criterion 1", maxScore: 10, orderIndex: 0 }];

    result.current.mutate({ rubricId: "rubric-1", criteria });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRubricService.updateRubricCriteria).toHaveBeenCalledWith("rubric-1", criteria);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["rubrics"] });
  });
});

describe("useConfirmRubric", () => {
  it("confirms a rubric and invalidates the rubrics query", async () => {
    mockedRubricService.confirmRubric.mockResolvedValue({ ...draftRubric, status: "confirmed" });
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useConfirmRubric(), { wrapper: Wrapper });

    result.current.mutate("rubric-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRubricService.confirmRubric).toHaveBeenCalledWith("rubric-1", expect.anything());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["rubrics"] });
  });
});

describe("useUnlockRubric", () => {
  it("unlocks a rubric and invalidates the rubrics query", async () => {
    mockedRubricService.unlockRubric.mockResolvedValue({ ...draftRubric, status: "draft" });
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUnlockRubric(), { wrapper: Wrapper });

    result.current.mutate("rubric-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRubricService.unlockRubric).toHaveBeenCalledWith("rubric-1", expect.anything());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["rubrics"] });
  });
});
