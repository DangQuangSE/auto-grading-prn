import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiClient from "../lib/apiClient";
import { AuthProvider } from "../providers/AuthProvider";
import { LoginPage } from "./LoginPage";

vi.mock("@react-oauth/google", () => ({
  GoogleLogin: () => null,
}));

vi.mock("../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../lib/apiClient")>("../lib/apiClient");
  return {
    ...actual,
    apiPost: vi.fn(),
    getStoredSession: vi.fn(),
    setStoredSession: vi.fn(),
    clearStoredSession: vi.fn(),
  };
});

const mockedApiClient = vi.mocked(apiClient);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Home area</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedApiClient.getStoredSession.mockReturnValue(null);
});

describe("LoginPage", () => {
  it("renders the sign in form", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: /admin sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("submits credentials and signs in an admin account", async () => {
    mockedApiClient.apiPost.mockResolvedValue({
      token: "token-1",
      userId: "admin-1",
      email: "admin@school.edu",
      role: "admin",
    });

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Email"), "admin@school.edu");
    await user.type(screen.getByLabelText("Password"), "password1");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockedApiClient.apiPost).toHaveBeenCalledWith("/identity/auth/login", {
        email: "admin@school.edu",
        password: "password1",
      });
    });
    expect(await screen.findByText("Home area")).toBeInTheDocument();
  });

  it("signs in a lecturer account", async () => {
    mockedApiClient.apiPost.mockResolvedValue({
      token: "token-2",
      userId: "lecturer-1",
      email: "lecturer@school.edu",
      role: "lecturer",
    });

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Email"), "lecturer@school.edu");
    await user.type(screen.getByLabelText("Password"), "password1");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Home area")).toBeInTheDocument();
  });

  it("rejects a student account with an access error and does not navigate away", async () => {
    mockedApiClient.apiPost.mockResolvedValue({
      token: "token-3",
      userId: "student-1",
      email: "student@school.edu",
      role: "student",
    });

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Email"), "student@school.edu");
    await user.type(screen.getByLabelText("Password"), "password1");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("This account does not have lecturer or admin access.")).toBeInTheDocument();
    expect(screen.queryByText("Home area")).not.toBeInTheDocument();
    expect(mockedApiClient.setStoredSession).not.toHaveBeenCalled();
  });

  it("shows the server's error message when sign in fails", async () => {
    mockedApiClient.apiPost.mockRejectedValue(new apiClient.ApiError(401, "Invalid email or password."));

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Email"), "admin@school.edu");
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
  });

  it("redirects immediately when a session is already active", () => {
    mockedApiClient.getStoredSession.mockReturnValue({
      token: "stale-token",
      user: { id: "admin-1", email: "admin@school.edu", role: "admin" },
    });

    renderPage();

    expect(screen.getByText("Home area")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /admin sign in/i })).not.toBeInTheDocument();
  });
});
