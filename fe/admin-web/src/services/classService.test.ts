import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPatch, apiPost } from "../lib/apiClient";
import {
  createClass,
  fetchLecturers,
  getClasses,
  updateClass,
  updateClassLecturer,
} from "./classService";

vi.mock("../lib/apiClient");

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);
const mockedApiPatch = vi.mocked(apiPatch);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getClasses", () => {
  it("fetches the first page and returns items when there is only one page", async () => {
    mockedApiGet.mockResolvedValueOnce({
      items: [{ id: "c1", name: "SE1801", lecturerId: "l1" }],
      page: 1,
      pageSize: 100,
      totalCount: 1,
      totalPages: 1,
    });

    const result = await getClasses();

    expect(mockedApiGet).toHaveBeenCalledTimes(1);
    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/classes/admin?page=1&pageSize=100");
    expect(result).toEqual([{ id: "c1", name: "SE1801", lecturerId: "l1" }]);
  });

  it("paginates through all pages and concatenates items", async () => {
    mockedApiGet.mockResolvedValueOnce({
      items: [{ id: "c1", name: "SE1801", lecturerId: "l1" }],
      page: 1,
      pageSize: 100,
      totalCount: 2,
      totalPages: 2,
    });
    mockedApiGet.mockResolvedValueOnce({
      items: [{ id: "c2", name: "SE1802", lecturerId: "l2" }],
      page: 2,
      pageSize: 100,
      totalCount: 2,
      totalPages: 2,
    });

    const result = await getClasses();

    expect(mockedApiGet).toHaveBeenCalledTimes(2);
    expect(mockedApiGet).toHaveBeenNthCalledWith(2, "/catalog/classes/admin?page=2&pageSize=100");
    expect(result).toEqual([
      { id: "c1", name: "SE1801", lecturerId: "l1" },
      { id: "c2", name: "SE1802", lecturerId: "l2" },
    ]);
  });
});

describe("createClass", () => {
  it("posts to the subject-scoped classes endpoint with the given params", async () => {
    const created = { id: "c1", name: "SE1801", lecturerId: "l1" };
    mockedApiPost.mockResolvedValueOnce(created);

    const params = { name: "SE1801", lecturerId: "l1", subjectId: "s1" };
    const result = await createClass(params);

    expect(mockedApiPost).toHaveBeenCalledWith("/catalog/classes/subject-scoped", params);
    expect(result).toBe(created);
  });
});

describe("updateClass", () => {
  it("patches the class by id with the given changes", async () => {
    const updated = { id: "c1", name: "SE1801", lecturerId: "l2" };
    mockedApiPatch.mockResolvedValueOnce(updated);

    const result = await updateClass("c1", { lecturerId: "l2" });

    expect(mockedApiPatch).toHaveBeenCalledWith("/catalog/classes/c1", { lecturerId: "l2" });
    expect(result).toBe(updated);
  });
});

describe("updateClassLecturer", () => {
  it("delegates to updateClass with a lecturerId-only payload", async () => {
    const updated = { id: "c1", name: "SE1801", lecturerId: "l3" };
    mockedApiPatch.mockResolvedValueOnce(updated);

    const result = await updateClassLecturer("c1", "l3");

    expect(mockedApiPatch).toHaveBeenCalledWith("/catalog/classes/c1", { lecturerId: "l3" });
    expect(result).toBe(updated);
  });
});

describe("fetchLecturers", () => {
  it("fetches identity users and returns only lecturers, mapped to Lecturer shape", async () => {
    mockedApiGet.mockResolvedValueOnce([
      { id: "u1", email: "a@b.com", fullName: "A", role: "lecturer" },
      { id: "u2", email: "b@b.com", fullName: "B", role: "admin" },
      { id: "u3", email: "c@b.com", fullName: "C", role: "lecturer" },
    ]);

    const result = await fetchLecturers();

    expect(mockedApiGet).toHaveBeenCalledWith("/identity/users");
    expect(result).toEqual([
      { id: "u1", email: "a@b.com", fullName: "A" },
      { id: "u3", email: "c@b.com", fullName: "C" },
    ]);
  });

  it("returns an empty array when there are no lecturers", async () => {
    mockedApiGet.mockResolvedValueOnce([{ id: "u1", email: "a@b.com", fullName: "A", role: "admin" }]);

    const result = await fetchLecturers();

    expect(result).toEqual([]);
  });
});
