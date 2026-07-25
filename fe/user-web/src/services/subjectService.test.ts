import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiClient from "../lib/apiClient";
import { listAssignments, listOpenSubjects, listSubjects } from "./subjectService";

vi.mock("../lib/apiClient", () => ({
  apiGet: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

beforeEach(() => {
  vi.resetAllMocks();
});

const subjectB = { id: "s2", code: "SE200", name: "B", createdAt: "2024-01-02", registrationStatus: "open" as const };
const subjectA = { id: "s1", code: "SE100", name: "A", createdAt: "2024-01-01", registrationStatus: "open" as const };

describe("listSubjects", () => {
  it("GETs /catalog/subjects and returns items sorted by code ascending", async () => {
    mockedApiClient.apiGet.mockResolvedValue({
      items: [subjectB, subjectA],
      page: 1,
      pageSize: 100,
      totalCount: 2,
      totalPages: 1,
    });

    const result = await listSubjects();

    expect(mockedApiClient.apiGet).toHaveBeenCalledWith("/catalog/subjects?page=1&pageSize=100");
    expect(result.map((s) => s.code)).toEqual(["SE100", "SE200"]);
  });

  it("aggregates multiple pages before sorting", async () => {
    mockedApiClient.apiGet
      .mockResolvedValueOnce({ items: [subjectB], page: 1, pageSize: 100, totalCount: 2, totalPages: 2 })
      .mockResolvedValueOnce({ items: [subjectA], page: 2, pageSize: 100, totalCount: 2, totalPages: 2 });

    const result = await listSubjects();

    expect(mockedApiClient.apiGet).toHaveBeenNthCalledWith(2, "/catalog/subjects?page=2&pageSize=100");
    expect(result.map((s) => s.code)).toEqual(["SE100", "SE200"]);
  });
});

describe("listOpenSubjects", () => {
  it("GETs /catalog/subjects/open-for-registration and returns items sorted by code", async () => {
    mockedApiClient.apiGet.mockResolvedValue({
      items: [subjectB, subjectA],
      page: 1,
      pageSize: 100,
      totalCount: 2,
      totalPages: 1,
    });

    const result = await listOpenSubjects();

    expect(mockedApiClient.apiGet).toHaveBeenCalledWith(
      "/catalog/subjects/open-for-registration?page=1&pageSize=100",
    );
    expect(result.map((s) => s.code)).toEqual(["SE100", "SE200"]);
  });
});

describe("listAssignments", () => {
  const assignment1 = { id: "a1", subjectId: "s1", title: "A1", maxAttempts: 1, createdAt: "2024-01-01" };
  const assignment2 = { id: "a2", subjectId: "s1", title: "A2", maxAttempts: 1, createdAt: "2024-01-02" };

  it("builds the URL without subjectId when omitted, sorted by createdAt descending", async () => {
    mockedApiClient.apiGet.mockResolvedValue({
      items: [assignment1, assignment2],
      page: 1,
      pageSize: 100,
      totalCount: 2,
      totalPages: 1,
    });

    const result = await listAssignments();

    expect(mockedApiClient.apiGet).toHaveBeenCalledWith("/catalog/assignments?pageSize=100&page=1");
    expect(result.map((a) => a.id)).toEqual(["a2", "a1"]);
  });

  it("includes subjectId in the query string when provided", async () => {
    mockedApiClient.apiGet.mockResolvedValue({
      items: [assignment1],
      page: 1,
      pageSize: 100,
      totalCount: 1,
      totalPages: 1,
    });

    await listAssignments("subject-1");

    expect(mockedApiClient.apiGet).toHaveBeenCalledWith(
      "/catalog/assignments?subjectId=subject-1&pageSize=100&page=1",
    );
  });

  it("paginates using the same base URL for subsequent pages", async () => {
    mockedApiClient.apiGet
      .mockResolvedValueOnce({ items: [assignment1], page: 1, pageSize: 100, totalCount: 2, totalPages: 2 })
      .mockResolvedValueOnce({ items: [assignment2], page: 2, pageSize: 100, totalCount: 2, totalPages: 2 });

    const result = await listAssignments("subject-1");

    expect(mockedApiClient.apiGet).toHaveBeenNthCalledWith(
      2,
      "/catalog/assignments?subjectId=subject-1&pageSize=100&page=2",
    );
    expect(result.map((a) => a.id)).toEqual(["a2", "a1"]);
  });
});
