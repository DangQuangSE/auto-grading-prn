import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as submissionService from "../services/submissionService";
import { useCreateSubmission } from "./useSubmissions";

vi.mock("../services/submissionService");

const mockedSubmissionService = vi.mocked(submissionService);

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

describe("useCreateSubmission", () => {
  it("calls createSubmission with the provided params", async () => {
    const record = {
      id: "sub-1",
      assignmentId: "a1",
      studentId: "u1",
      reportObjectKey: "report.docx",
      state: "uploaded",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      attemptNumber: 1,
    } as any;
    mockedSubmissionService.createSubmission.mockResolvedValue(record);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useCreateSubmission(), { wrapper: Wrapper });

    const reportFile = new File(["content"], "report.docx");
    result.current.mutate({ assignmentId: "a1", studentId: "u1", reportFile });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedSubmissionService.createSubmission).toHaveBeenCalledWith(
      { assignmentId: "a1", studentId: "u1", reportFile },
      expect.anything(),
    );
    expect(result.current.data).toEqual(record);
  });

  it("invalidates my-submissions and submissions queries on success", async () => {
    mockedSubmissionService.createSubmission.mockResolvedValue({ id: "sub-1" } as any);
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateSubmission(), { wrapper: Wrapper });

    const reportFile = new File(["content"], "report.docx");
    result.current.mutate({ assignmentId: "a1", studentId: "u1", reportFile });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["my-submissions"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["submissions"] });
  });

  it("surfaces mutation errors", async () => {
    mockedSubmissionService.createSubmission.mockRejectedValue(new Error("upload failed"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useCreateSubmission(), { wrapper: Wrapper });

    const reportFile = new File(["content"], "report.docx");
    result.current.mutate({ assignmentId: "a1", studentId: "u1", reportFile });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("upload failed");
  });
});
