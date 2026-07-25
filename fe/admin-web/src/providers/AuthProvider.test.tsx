import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiClient from "../lib/apiClient";
import type { AdminSession } from "../lib/apiClient";
import { AuthProvider, useAuth } from "./AuthProvider";

vi.mock("../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../lib/apiClient")>("../lib/apiClient");
  return {
    ...actual,
    getStoredSession: vi.fn(),
    setStoredSession: vi.fn(),
    clearStoredSession: vi.fn(),
  };
});

const mockedApiClient = vi.mocked(apiClient);

const adminSession: AdminSession = {
  token: "token-1",
  user: { id: "admin-1", email: "admin@school.edu", role: "admin" },
};

const lecturerSession: AdminSession = {
  token: "token-2",
  user: { id: "lecturer-1", email: "lecturer@school.edu", role: "lecturer" },
};

function Consumer() {
  const { session, setSession, signOut } = useAuth();
  return (
    <div>
      <p>{session ? `Signed in as ${session.user.email} (${session.user.role})` : "No session"}</p>
      <button onClick={() => setSession(lecturerSession)}>Set lecturer session</button>
      <button onClick={signOut}>Sign out</button>
    </div>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedApiClient.getStoredSession.mockReturnValue(null);
});

describe("AuthProvider", () => {
  it("initializes session from getStoredSession on mount", () => {
    mockedApiClient.getStoredSession.mockReturnValue(adminSession);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    expect(screen.getByText("Signed in as admin@school.edu (admin)")).toBeInTheDocument();
    expect(mockedApiClient.getStoredSession).toHaveBeenCalled();
  });

  it("starts with no session when there is nothing stored", () => {
    mockedApiClient.getStoredSession.mockReturnValue(null);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    expect(screen.getByText("No session")).toBeInTheDocument();
  });

  it("setSession persists the session and updates context state", async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await user.click(screen.getByRole("button", { name: /set lecturer session/i }));

    expect(screen.getByText("Signed in as lecturer@school.edu (lecturer)")).toBeInTheDocument();
    expect(mockedApiClient.setStoredSession).toHaveBeenCalledWith(lecturerSession);
  });

  it("signOut clears the stored session and context state", async () => {
    mockedApiClient.getStoredSession.mockReturnValue(adminSession);
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    expect(screen.getByText(/signed in as admin/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    expect(screen.getByText("No session")).toBeInTheDocument();
    expect(mockedApiClient.clearStoredSession).toHaveBeenCalled();
  });

  it("throws when useAuth is used outside of an AuthProvider", () => {
    function Bare() {
      useAuth();
      return null;
    }

    expect(() => render(<Bare />)).toThrowError("useAuth must be used within an AuthProvider");
  });
});
