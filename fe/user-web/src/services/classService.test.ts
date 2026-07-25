import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiClient from "../lib/apiClient";
import { getClasses, getClassesBySubject } from "./classService";

vi.mock("../lib/apiClient", () => ({
  apiGet: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getClasses", () => {
  it("GETs /catalog/classes and returns the data as-is", async () => {
    const classes = [{ id: "c1", name: "SE1801" }];
    mockedApiClient.apiGet.mockResolvedValue(classes);

    const result = await getClasses();

    expect(mockedApiClient.apiGet).toHaveBeenCalledWith("/catalog/classes");
    expect(result).toBe(classes);
  });
});

describe("getClassesBySubject", () => {
  it("returns items directly when there is only a single page", async () => {
    mockedApiClient.apiGet.mockResolvedValue({
      items: [{ id: "c1", name: "SE1801" }],
      page: 1,
      pageSize: 100,
      totalCount: 1,
      totalPages: 1,
    });

    const result = await getClassesBySubject("subject-1");

    expect(mockedApiClient.apiGet).toHaveBeenCalledTimes(1);
    expect(mockedApiClient.apiGet).toHaveBeenCalledWith(
      "/catalog/classes/by-subject/subject-1?page=1&pageSize=100",
    );
    expect(result).toEqual([{ id: "c1", name: "SE1801" }]);
  });

  it("aggregates items across multiple pages", async () => {
    mockedApiClient.apiGet
      .mockResolvedValueOnce({
        items: [{ id: "c1", name: "SE1801" }],
        page: 1,
        pageSize: 100,
        totalCount: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [{ id: "c2", name: "SE1802" }],
        page: 2,
        pageSize: 100,
        totalCount: 2,
        totalPages: 2,
      });

    const result = await getClassesBySubject("subject-1");

    expect(mockedApiClient.apiGet).toHaveBeenCalledTimes(2);
    expect(mockedApiClient.apiGet).toHaveBeenNthCalledWith(
      2,
      "/catalog/classes/by-subject/subject-1?page=2&pageSize=100",
    );
    expect(result).toEqual([
      { id: "c1", name: "SE1801" },
      { id: "c2", name: "SE1802" },
    ]);
  });
});
