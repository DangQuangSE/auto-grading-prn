import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as bulkImportService from "../services/bulkImportService";
import { useUploadRosterFile } from "./useBulkImport";

vi.mock("../services/bulkImportService");

const mockedBulkImportService = vi.mocked(bulkImportService);

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

describe("useUploadRosterFile", () => {
  it("uploads a roster file and returns the import report", async () => {
    const report = { totalRows: 2, updatedCount: 2, skippedCount: 0, details: [] };
    mockedBulkImportService.uploadRosterFile.mockResolvedValue(report);

    const { result } = renderHook(() => useUploadRosterFile(), { wrapper: createWrapper() });

    const file = new File(["content"], "roster.xlsx");
    result.current.mutate(file);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(report);
    expect(mockedBulkImportService.uploadRosterFile).toHaveBeenCalledWith(file, expect.anything());
  });

  it("surfaces an error when the upload fails", async () => {
    mockedBulkImportService.uploadRosterFile.mockRejectedValue(new ApiError(400, "Invalid file"));

    const { result } = renderHook(() => useUploadRosterFile(), { wrapper: createWrapper() });

    const file = new File(["content"], "roster.xlsx");
    result.current.mutate(file);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error?.message).toBe("Invalid file");
  });
});
