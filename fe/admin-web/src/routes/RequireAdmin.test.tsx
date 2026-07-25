import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as AuthProviderModule from "../providers/AuthProvider";
import { RequireAdmin } from "./RequireAdmin";

const { getFeatureFlag, setFeatureFlag } = vi.hoisted(() => {
  let featureFlag = false;
  return {
    getFeatureFlag: () => featureFlag,
    setFeatureFlag: (value: boolean) => {
      featureFlag = value;
    },
  };
});

vi.mock("../lib/features", () => ({
  get courseEnrollmentEnabled() {
    return getFeatureFlag();
  },
}));

vi.mock("../providers/AuthProvider", async () => {
  const actual = await vi.importActual<typeof import("../providers/AuthProvider")>("../providers/AuthProvider");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(AuthProviderModule.useAuth);

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/classes"]}>
      <Routes>
        <Route element={<RequireAdmin />}>
          <Route path="/classes" element={<div>Class management</div>} />
        </Route>
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAdmin", () => {
  it("renders the protected route for an admin session when the feature flag is on", () => {
    setFeatureFlag(true);
    mockedUseAuth.mockReturnValue({
      session: { token: "t", user: { id: "1", email: "admin@school.edu", role: "admin" } },
      setSession: vi.fn(),
      signOut: vi.fn(),
    });

    renderGuard();

    expect(screen.getByText("Class management")).toBeInTheDocument();
  });

  it("redirects to /dashboard for a lecturer session even when the feature flag is on", () => {
    setFeatureFlag(true);
    mockedUseAuth.mockReturnValue({
      session: { token: "t", user: { id: "1", email: "lecturer@school.edu", role: "lecturer" } },
      setSession: vi.fn(),
      signOut: vi.fn(),
    });

    renderGuard();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Class management")).not.toBeInTheDocument();
  });

  it("redirects to /dashboard for an admin session when the feature flag is off", () => {
    setFeatureFlag(false);
    mockedUseAuth.mockReturnValue({
      session: { token: "t", user: { id: "1", email: "admin@school.edu", role: "admin" } },
      setSession: vi.fn(),
      signOut: vi.fn(),
    });

    renderGuard();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("Class management")).not.toBeInTheDocument();
  });

  it("redirects to /dashboard when there is no session", () => {
    setFeatureFlag(true);
    mockedUseAuth.mockReturnValue({ session: null, setSession: vi.fn(), signOut: vi.fn() });

    renderGuard();

    expect(screen.getByText("Dashboard page")).toBeInTheDocument();
  });
});
