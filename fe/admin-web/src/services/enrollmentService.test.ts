import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPut } from "../lib/apiClient";
import { correctEnrollment, listEnrollments } from "./enrollmentService";

vi.mock("../lib/apiClient");

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPut = vi.mocked(apiPut);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("listEnrollments", () => {
  it("queries the admin enrollments endpoint with studentId and a large page size", async () => {
    const paged = {
      items: [],
      page: 1,
      pageSize: 100,
      totalCount: 0,
      totalPages: 0,
    };
    mockedApiGet.mockResolvedValueOnce(paged);

    const result = await listEnrollments("student-1");

    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/enrollments/admin?studentId=student-1&pageSize=100");
    expect(result).toBe(paged);
  });
});

describe("correctEnrollment", () => {
  it("PUTs to the per-student/subject endpoint with classId and rowVersion", async () => {
    const updated = {
      id: "e1",
      studentId: "student-1",
      subjectId: "subject-1",
      subjectCode: "SE100",
      subjectName: "Software Engineering",
      registrationStatus: "open" as const,
      classId: "class-2",
      className: "SE1802",
      rowVersion: "v2",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-02",
    };
    mockedApiPut.mockResolvedValueOnce(updated);

    const params = {
      studentId: "student-1",
      subjectId: "subject-1",
      classId: "class-2",
      rowVersion: "v1",
    };
    const result = await correctEnrollment(params);

    expect(mockedApiPut).toHaveBeenCalledWith("/catalog/enrollments/admin/student-1/subject-1", {
      classId: "class-2",
      rowVersion: "v1",
    });
    expect(result).toBe(updated);
  });
});
