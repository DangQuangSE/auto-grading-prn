import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authService from "../services/authService";
import { AuthProvider, useAuth } from "./AuthProvider";

vi.mock("../services/authService");

const mockedAuthService = vi.mocked(authService);

function Consumer() {
  const { session, isLoadingSession, authNotice, signOutUser } = useAuth();

  return (
    <div>
      <span data-testid="loading">{String(isLoadingSession)}</span>
      <span data-testid="session">{session ? session.user.email : "none"}</span>
      <span data-testid="notice">{authNotice ?? "none"}</span>
      <button onClick={() => signOutUser()}>sign out</button>
    </div>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedAuthService.isAllowedEducationEmail.mockImplementation((email?: string | null) =>
    Boolean(email?.endsWith(".edu")),
  );
});

describe("AuthProvider", () => {
  it("loads the current session on mount and stops loading", async () => {
    mockedAuthService.getCurrentSession.mockReturnValue({
      token: "t",
      user: { id: "u1", email: "alice@school.edu", role: "student" },
    });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId("loading")).toHaveTextContent("true");

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("session")).toHaveTextContent("alice@school.edu");
  });

  it("has no session and no loading state when there is nothing stored", async () => {
    mockedAuthService.getCurrentSession.mockReturnValue(null);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("session")).toHaveTextContent("none");
  });

  it("rejects a non-.edu session, signs it out, and shows a notice", async () => {
    mockedAuthService.getCurrentSession.mockReturnValue({
      token: "t",
      user: { id: "u1", email: "bob@gmail.com", role: "student" },
    });
    mockedAuthService.signOut.mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    expect(screen.getByTestId("session")).toHaveTextContent("none");
    expect(screen.getByTestId("notice")).toHaveTextContent(/only \.edu email addresses/i);
    expect(mockedAuthService.signOut).toHaveBeenCalledTimes(1);
  });

  it("clears the session when signOutUser is invoked", async () => {
    mockedAuthService.getCurrentSession.mockReturnValue({
      token: "t",
      user: { id: "u1", email: "alice@school.edu", role: "student" },
    });
    mockedAuthService.signOut.mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("alice@school.edu"));

    screen.getByRole("button", { name: "sign out" }).click();

    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("none"));
    expect(mockedAuthService.signOut).toHaveBeenCalledTimes(1);
  });

  it("throws when useAuth is used outside AuthProvider", () => {
    function Bare() {
      useAuth();
      return null;
    }

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow("useAuth must be used within AuthProvider.");
    consoleError.mockRestore();
  });
});
