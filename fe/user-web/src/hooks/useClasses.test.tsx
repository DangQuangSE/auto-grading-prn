import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as classService from "../services/classService";
import { useClasses } from "./useClasses";

vi.mock("../services/classService");

const mockedClassService = vi.mocked(classService);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useClasses", () => {
  it("does not fetch when disabled", () => {
    mockedClassService.getClasses.mockResolvedValue([{ id: "c1", name: "SE1801" }]);

    const { result } = renderHook(() => useClasses(false), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedClassService.getClasses).not.toHaveBeenCalled();
  });

  it("loads classes when enabled", async () => {
    mockedClassService.getClasses.mockResolvedValue([{ id: "c1", name: "SE1801" }]);

    const { result } = renderHook(() => useClasses(true), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([{ id: "c1", name: "SE1801" }]);
    expect(mockedClassService.getClasses).toHaveBeenCalledTimes(1);
  });

  it("surfaces errors from the service", async () => {
    mockedClassService.getClasses.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useClasses(true), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect((result.current.error as Error).message).toBe("boom");
  });
});
