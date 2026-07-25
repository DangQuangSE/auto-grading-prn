import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet } from "../lib/apiClient";
import { batchGetGrades, getAssignments } from "./gradeExportService";

vi.mock("../lib/apiClient");

const mockedApiGet = vi.mocked(apiGet);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getAssignments", () => {
  it("fetches assignments with the max page size and returns the items array", async () => {
    const items = [{ id: "a1", subjectId: "s1", title: "HW1", createdAt: "2024-01-01" }];
    mockedApiGet.mockResolvedValueOnce({
      items,
      page: 1,
      pageSize: 100,
      totalCount: 1,
      totalPages: 1,
    });

    const result = await getAssignments();

    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/assignments?page=1&pageSize=100");
    expect(result).toBe(items);
  });
});

describe("batchGetGrades", () => {
  it("returns an empty array without calling the API when there are no ids", async () => {
    const result = await batchGetGrades([]);

    expect(result).toEqual([]);
    expect(mockedApiGet).not.toHaveBeenCalled();
  });

  it("dedupes submission ids and joins them into the query string", async () => {
    const grades = [{ submissionId: "sub-1", finalGradeId: "g1", finalScore: 9, createdAt: "2024-01-01" }];
    mockedApiGet.mockResolvedValueOnce(grades);

    const result = await batchGetGrades(["sub-1", "sub-2", "sub-1"]);

    expect(mockedApiGet).toHaveBeenCalledWith("/grading/grades/final?submissionIds=sub-1,sub-2");
    expect(result).toBe(grades);
  });
});
