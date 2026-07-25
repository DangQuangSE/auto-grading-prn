import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiClient from "../lib/apiClient";
import { listMyEnrollments, saveMyEnrollment } from "./enrollmentService";

vi.mock("../lib/apiClient", () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

beforeEach(() => {
  vi.resetAllMocks();
});

const enrollment = {
  id: "e1",
  subjectId: "s1",
  subjectCode: "SE100",
  subjectName: "Software Engineering",
  registrationStatus: "open" as const,
  classId: "c1",
  className: "SE1801",
  rowVersion: "v1",
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
};

describe("listMyEnrollments", () => {
  it("GETs the first page and returns items when there is only one page", async () => {
    mockedApiClient.apiGet.mockResolvedValue({
      items: [enrollment],
      page: 1,
      pageSize: 100,
      totalCount: 1,
      totalPages: 1,
    });

    const result = await listMyEnrollments();

    expect(mockedApiClient.apiGet).toHaveBeenCalledWith("/catalog/enrollments/me?page=1&pageSize=100");
    expect(mockedApiClient.apiGet).toHaveBeenCalledTimes(1);
    expect(result).toEqual([enrollment]);
  });

  it("aggregates items across multiple pages", async () => {
    const enrollment2 = { ...enrollment, id: "e2" };
    mockedApiClient.apiGet
      .mockResolvedValueOnce({ items: [enrollment], page: 1, pageSize: 100, totalCount: 2, totalPages: 2 })
      .mockResolvedValueOnce({ items: [enrollment2], page: 2, pageSize: 100, totalCount: 2, totalPages: 2 });

    const result = await listMyEnrollments();

    expect(mockedApiClient.apiGet).toHaveBeenNthCalledWith(2, "/catalog/enrollments/me?page=2&pageSize=100");
    expect(result).toEqual([enrollment, enrollment2]);
  });
});

describe("saveMyEnrollment", () => {
  it("PUTs to /catalog/enrollments/me/:subjectId with classId and rowVersion", async () => {
    mockedApiClient.apiPut.mockResolvedValue(enrollment);

    const result = await saveMyEnrollment({ subjectId: "s1", classId: "c1", rowVersion: "v1" });

    expect(mockedApiClient.apiPut).toHaveBeenCalledWith("/catalog/enrollments/me/s1", {
      classId: "c1",
      rowVersion: "v1",
    });
    expect(result).toBe(enrollment);
  });

  it("passes through a null rowVersion", async () => {
    mockedApiClient.apiPut.mockResolvedValue(enrollment);

    await saveMyEnrollment({ subjectId: "s1", classId: "c1", rowVersion: null });

    expect(mockedApiClient.apiPut).toHaveBeenCalledWith("/catalog/enrollments/me/s1", {
      classId: "c1",
      rowVersion: null,
    });
  });
});
