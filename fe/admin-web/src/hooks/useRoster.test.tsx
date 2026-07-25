import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as rosterService from "../services/rosterService";
import { useRosterUsers, useUpdateRosterUser } from "./useRoster";

vi.mock("../services/rosterService");

const mockedRosterService = vi.mocked(rosterService);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

const studentA = {
  id: "user-a",
  email: "alice@school.edu",
  fullName: "Alice Nguyen",
  role: "student",
  studentCode: "SE100001",
  classId: "class-1",
  className: "SE1801",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useRosterUsers", () => {
  it("loads roster users", async () => {
    mockedRosterService.listUsers.mockResolvedValue([studentA]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useRosterUsers(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([studentA]);
  });

  it("surfaces errors", async () => {
    mockedRosterService.listUsers.mockRejectedValue(new ApiError(500, "Server error"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useRosterUsers(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Server error");
  });
});

describe("useUpdateRosterUser", () => {
  it("updates a roster user and invalidates the roster-users query", async () => {
    mockedRosterService.updateUser.mockResolvedValue({ ...studentA, studentCode: "SE999999" });
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateRosterUser(), { wrapper: Wrapper });

    result.current.mutate({ userId: "user-a", studentCode: "SE999999", classId: "class-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedRosterService.updateUser).toHaveBeenCalledWith("user-a", {
      studentCode: "SE999999",
      classId: "class-1",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["roster-users"] });
  });

  it("surfaces mutation errors", async () => {
    mockedRosterService.updateUser.mockRejectedValue(new ApiError(403, "Forbidden"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useUpdateRosterUser(), { wrapper: Wrapper });

    result.current.mutate({ userId: "user-a", studentCode: "SE999999", classId: "class-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Forbidden");
  });
});
