import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPatch } from "../lib/apiClient";
import { getUser, getUsersByIds, listUsers, updateUser } from "./rosterService";

vi.mock("../lib/apiClient");

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPatch = vi.mocked(apiPatch);

beforeEach(() => {
  vi.resetAllMocks();
});

const user = {
  id: "u1",
  email: "a@b.com",
  fullName: "A",
  role: "student",
  studentCode: "SC1",
  classId: "c1",
  className: "SE1801",
};

describe("listUsers", () => {
  it("fetches the identity users list", async () => {
    mockedApiGet.mockResolvedValueOnce([user]);

    const result = await listUsers();

    expect(mockedApiGet).toHaveBeenCalledWith("/identity/users");
    expect(result).toEqual([user]);
  });
});

describe("getUsersByIds", () => {
  it("returns an empty array without calling the API for an empty id list", async () => {
    const result = await getUsersByIds([]);

    expect(result).toEqual([]);
    expect(mockedApiGet).not.toHaveBeenCalled();
  });

  it("dedupes ids and queries with a comma-joined ids param", async () => {
    mockedApiGet.mockResolvedValueOnce([user]);

    const result = await getUsersByIds(["u1", "u2", "u1"]);

    expect(mockedApiGet).toHaveBeenCalledWith("/identity/users?ids=u1,u2");
    expect(result).toEqual([user]);
  });
});

describe("getUser", () => {
  it("returns the first matching user", async () => {
    mockedApiGet.mockResolvedValueOnce([user]);

    const result = await getUser("u1");

    expect(mockedApiGet).toHaveBeenCalledWith("/identity/users?ids=u1");
    expect(result).toEqual(user);
  });

  it("returns null when no user is found", async () => {
    mockedApiGet.mockResolvedValueOnce([]);

    const result = await getUser("missing");

    expect(result).toBeNull();
  });
});

describe("updateUser", () => {
  it("patches the user with studentCode and classId, defaulting to null", async () => {
    mockedApiPatch.mockResolvedValueOnce(user);

    const result = await updateUser("u1", { studentCode: "SC2", classId: "c2" });

    expect(mockedApiPatch).toHaveBeenCalledWith("/identity/users/u1", {
      studentCode: "SC2",
      classId: "c2",
    });
    expect(result).toBe(user);
  });

  it("defaults omitted studentCode/classId to null", async () => {
    mockedApiPatch.mockResolvedValueOnce(user);

    await updateUser("u1", {});

    expect(mockedApiPatch).toHaveBeenCalledWith("/identity/users/u1", {
      studentCode: null,
      classId: null,
    });
  });
});
