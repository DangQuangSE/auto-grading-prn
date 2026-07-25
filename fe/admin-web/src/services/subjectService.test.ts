import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPatch, apiPost } from "../lib/apiClient";
import {
  createAssignment,
  createSubject,
  listAllSubjects,
  listAssignments,
  listSubjects,
  updateSubjectRegistration,
} from "./subjectService";

vi.mock("../lib/apiClient");

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPatch = vi.mocked(apiPatch);
const mockedApiPost = vi.mocked(apiPost);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("listSubjects", () => {
  it("uses default page/pageSize when no params are given", async () => {
    const paged = { items: [], page: 1, pageSize: 5, totalCount: 0, totalPages: 0 };
    mockedApiGet.mockResolvedValueOnce(paged);

    const result = await listSubjects();

    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/subjects?page=1&pageSize=5");
    expect(result).toBe(paged);
  });

  it("uses given page/pageSize and includes a trimmed search term", async () => {
    mockedApiGet.mockResolvedValueOnce({ items: [], page: 2, pageSize: 20, totalCount: 0, totalPages: 0 });

    await listSubjects({ page: 2, pageSize: 20, search: "  math  " });

    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/subjects?page=2&pageSize=20&search=math");
  });

  it("omits the search param when search is blank", async () => {
    mockedApiGet.mockResolvedValueOnce({ items: [], page: 1, pageSize: 5, totalCount: 0, totalPages: 0 });

    await listSubjects({ search: "   " });

    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/subjects?page=1&pageSize=5");
  });
});

describe("createSubject", () => {
  it("posts code and name (createdBy is not sent)", async () => {
    const subject = { id: "s1", code: "SE100", name: "SE", registrationStatus: "open" as const, createdAt: "2024-01-01" };
    mockedApiPost.mockResolvedValueOnce(subject);

    const result = await createSubject({ code: "SE100", name: "SE", createdBy: "admin-1" });

    expect(mockedApiPost).toHaveBeenCalledWith("/catalog/subjects", { code: "SE100", name: "SE" });
    expect(result).toBe(subject);
  });
});

describe("listAllSubjects", () => {
  it("paginates through all pages at pageSize 100", async () => {
    mockedApiGet.mockResolvedValueOnce({
      items: [{ id: "s1" }],
      page: 1,
      pageSize: 100,
      totalCount: 2,
      totalPages: 2,
    });
    mockedApiGet.mockResolvedValueOnce({
      items: [{ id: "s2" }],
      page: 2,
      pageSize: 100,
      totalCount: 2,
      totalPages: 2,
    });

    const result = await listAllSubjects();

    expect(mockedApiGet).toHaveBeenNthCalledWith(1, "/catalog/subjects?page=1&pageSize=100");
    expect(mockedApiGet).toHaveBeenNthCalledWith(2, "/catalog/subjects?page=2&pageSize=100");
    expect(result).toEqual([{ id: "s1" }, { id: "s2" }]);
  });
});

describe("updateSubjectRegistration", () => {
  it("patches the subject registration status", async () => {
    const subject = { id: "s1", code: "SE100", name: "SE", registrationStatus: "closed" as const, createdAt: "2024-01-01" };
    mockedApiPatch.mockResolvedValueOnce(subject);

    const result = await updateSubjectRegistration("s1", "closed");

    expect(mockedApiPatch).toHaveBeenCalledWith("/catalog/subjects/s1/registration", { status: "closed" });
    expect(result).toBe(subject);
  });
});

describe("listAssignments", () => {
  it("uses default page/pageSize and omits subjectId when not given", async () => {
    mockedApiGet.mockResolvedValueOnce({ items: [], page: 1, pageSize: 5, totalCount: 0, totalPages: 0 });

    await listAssignments({});

    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/assignments?page=1&pageSize=5");
  });

  it("includes subjectId and custom pagination when given", async () => {
    mockedApiGet.mockResolvedValueOnce({ items: [], page: 3, pageSize: 10, totalCount: 0, totalPages: 0 });

    await listAssignments({ subjectId: "s1", page: 3, pageSize: 10 });

    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/assignments?page=3&pageSize=10&subjectId=s1");
  });
});

describe("createAssignment", () => {
  it("posts assignment fields, defaulting description/dueDate", async () => {
    const assignment = { id: "a1", subjectId: "s1", title: "HW1", createdAt: "2024-01-01" };
    mockedApiPost.mockResolvedValueOnce(assignment);

    const result = await createAssignment({
      subjectId: "s1",
      title: "HW1",
      createdBy: "admin-1",
      maxAttempts: 3,
    });

    expect(mockedApiPost).toHaveBeenCalledWith("/catalog/assignments", {
      subjectId: "s1",
      title: "HW1",
      description: "",
      dueDate: null,
      maxAttempts: 3,
    });
    expect(result).toBe(assignment);
  });

  it("passes through description and dueDate when provided", async () => {
    mockedApiPost.mockResolvedValueOnce({ id: "a1" });

    await createAssignment({
      subjectId: "s1",
      title: "HW1",
      description: "Do the thing",
      dueDate: "2024-05-01",
      createdBy: "admin-1",
      maxAttempts: 1,
    });

    expect(mockedApiPost).toHaveBeenCalledWith("/catalog/assignments", {
      subjectId: "s1",
      title: "HW1",
      description: "Do the thing",
      dueDate: "2024-05-01",
      maxAttempts: 1,
    });
  });
});
