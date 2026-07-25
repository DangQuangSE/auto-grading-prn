import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as apiClient from "../lib/apiClient";
import { getFinalGrade, getGradingResult, getGradingRuns } from "./gradingService";

vi.mock("../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../lib/apiClient")>("../lib/apiClient");
  return {
    ...actual,
    apiGet: vi.fn(),
  };
});

const mockedApiClient = vi.mocked(apiClient);

beforeEach(() => {
  vi.resetAllMocks();
});

const gradingRun = {
  id: "run-1",
  submissionId: "sub-1",
  model: "gpt",
  status: "completed" as const,
  createdAt: "2024-01-01",
  scores: [],
};

describe("getGradingResult", () => {
  it("GETs /grading/grades/:id/result and returns published result on success", async () => {
    mockedApiClient.apiGet.mockResolvedValue({ gradingRun, finalGrade: null });

    const result = await getGradingResult("sub-1");

    expect(mockedApiClient.apiGet).toHaveBeenCalledWith("/grading/grades/sub-1/result");
    expect(result).toEqual({ gradingRun, isPublished: true, gradingDone: true });
  });

  it("defaults gradingRun to null when the response omits it", async () => {
    mockedApiClient.apiGet.mockResolvedValue({});

    const result = await getGradingResult("sub-1");

    expect(result).toEqual({ gradingRun: null, isPublished: true, gradingDone: true });
  });

  it("on a 404 with gradingDone true, returns unpublished-but-done result", async () => {
    mockedApiClient.apiGet.mockRejectedValue(new ApiError(404, "not found", { gradingDone: true }));

    const result = await getGradingResult("sub-1");

    expect(result).toEqual({ gradingRun: null, isPublished: false, gradingDone: true });
  });

  it("on a 404 with gradingDone false/absent, returns not-done result", async () => {
    mockedApiClient.apiGet.mockRejectedValue(new ApiError(404, "not found", null));

    const result = await getGradingResult("sub-1");

    expect(result).toEqual({ gradingRun: null, isPublished: false, gradingDone: false });
  });

  it("rethrows non-404 ApiErrors", async () => {
    mockedApiClient.apiGet.mockRejectedValue(new ApiError(500, "server error"));

    await expect(getGradingResult("sub-1")).rejects.toMatchObject({ status: 500 });
  });

  it("rethrows non-ApiError errors", async () => {
    mockedApiClient.apiGet.mockRejectedValue(new Error("network down"));

    await expect(getGradingResult("sub-1")).rejects.toThrow("network down");
  });
});

describe("getGradingRuns (deprecated shim)", () => {
  it("returns an array with the single gradingRun when present", async () => {
    mockedApiClient.apiGet.mockResolvedValue({ gradingRun, finalGrade: null });

    const result = await getGradingRuns("sub-1");

    expect(result).toEqual([gradingRun]);
  });

  it("returns an empty array when there is no gradingRun", async () => {
    mockedApiClient.apiGet.mockRejectedValue(new ApiError(404, "not found", { gradingDone: false }));

    const result = await getGradingRuns("sub-1");

    expect(result).toEqual([]);
  });
});

describe("getFinalGrade", () => {
  const finalGrade = { id: "fg-1", submissionId: "sub-1", finalScore: 9.5, createdAt: "2024-01-01" };

  it("GETs /grading/grades/:id/final and returns the grade", async () => {
    mockedApiClient.apiGet.mockResolvedValue(finalGrade);

    const result = await getFinalGrade("sub-1");

    expect(mockedApiClient.apiGet).toHaveBeenCalledWith("/grading/grades/sub-1/final");
    expect(result).toBe(finalGrade);
  });

  it("returns null on a 404", async () => {
    mockedApiClient.apiGet.mockRejectedValue(new ApiError(404, "not found"));

    const result = await getFinalGrade("sub-1");

    expect(result).toBeNull();
  });

  it("rethrows non-404 errors", async () => {
    mockedApiClient.apiGet.mockRejectedValue(new ApiError(500, "boom"));

    await expect(getFinalGrade("sub-1")).rejects.toMatchObject({ status: 500 });
  });
});
