import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as AuthProviderModule from "../providers/AuthProvider";
import { RequireAuth } from "./RequireAuth";

vi.mock("../providers/AuthProvider", async () => {
  const actual = await vi.importActual<typeof import("../providers/AuthProvider")>("../providers/AuthProvider");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(AuthProviderModule.useAuth);

function renderWithGuard() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<div>Dashboard area</div>} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  it("redirects to /login when there is no session", () => {
    mockedUseAuth.mockReturnValue({ session: null, setSession: vi.fn(), signOut: vi.fn() });

    renderWithGuard();

    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard area")).not.toBeInTheDocument();
  });

  it("renders the protected route for a lecturer session", () => {
    mockedUseAuth.mockReturnValue({
      session: { token: "t", user: { id: "1", email: "a@b.edu", role: "lecturer" } },
      setSession: vi.fn(),
      signOut: vi.fn(),
    });

    renderWithGuard();

    expect(screen.getByText("Dashboard area")).toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });

  it("renders the protected route for an admin session", () => {
    mockedUseAuth.mockReturnValue({
      session: { token: "t", user: { id: "1", email: "a@b.edu", role: "admin" } },
      setSession: vi.fn(),
      signOut: vi.fn(),
    });

    renderWithGuard();

    expect(screen.getByText("Dashboard area")).toBeInTheDocument();
  });
});
