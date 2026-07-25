import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiClient from "../lib/apiClient";
import {
  getCurrentSession,
  getCurrentUser,
  isAllowedEducationEmail,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  signUpWithEmail,
} from "./authService";

vi.mock("../lib/apiClient", () => ({
  apiPost: vi.fn(),
  getStoredSession: vi.fn(),
  setStoredSession: vi.fn(),
  clearStoredSession: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const loginResponse = {
  token: "token-abc",
  userId: "user-1",
  email: "alice@school.edu",
  role: "student" as const,
};

const expectedSession = {
  token: "token-abc",
  user: { id: "user-1", email: "alice@school.edu", role: "student" as const },
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("isAllowedEducationEmail", () => {
  it("allows a .edu email", () => {
    expect(isAllowedEducationEmail("student@school.edu")).toBe(true);
  });

  it("allows a .edu.vn email", () => {
    expect(isAllowedEducationEmail("student@fpt.edu.vn")).toBe(true);
  });

  it("allows a domain containing .edu. in the middle", () => {
    expect(isAllowedEducationEmail("student@sub.edu.example.com")).toBe(true);
  });

  it("allows the bare domain edu.vn", () => {
    expect(isAllowedEducationEmail("student@edu.vn")).toBe(true);
  });

  it("rejects a non-education email", () => {
    expect(isAllowedEducationEmail("student@gmail.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isAllowedEducationEmail("Student@School.EDU")).toBe(true);
  });

  it("rejects an email with no domain", () => {
    expect(isAllowedEducationEmail("student@")).toBe(false);
  });

  it("rejects a malformed email with no @", () => {
    expect(isAllowedEducationEmail("student")).toBe(false);
  });

  it("rejects null/undefined input", () => {
    expect(isAllowedEducationEmail(null)).toBe(false);
    expect(isAllowedEducationEmail(undefined)).toBe(false);
  });

  it("trims whitespace before checking the domain", () => {
    expect(isAllowedEducationEmail("  student@school.edu  ")).toBe(true);
  });
});

describe("getCurrentSession / getCurrentUser", () => {
  it("getCurrentSession returns the stored session", () => {
    mockedApiClient.getStoredSession.mockReturnValue(expectedSession);

    expect(getCurrentSession()).toEqual(expectedSession);
    expect(mockedApiClient.getStoredSession).toHaveBeenCalled();
  });

  it("getCurrentSession returns null when nothing stored", () => {
    mockedApiClient.getStoredSession.mockReturnValue(null);

    expect(getCurrentSession()).toBeNull();
  });

  it("getCurrentUser returns the user from the stored session", () => {
    mockedApiClient.getStoredSession.mockReturnValue(expectedSession);

    expect(getCurrentUser()).toEqual(expectedSession.user);
  });

  it("getCurrentUser returns null when there is no stored session", () => {
    mockedApiClient.getStoredSession.mockReturnValue(null);

    expect(getCurrentUser()).toBeNull();
  });
});

describe("signInWithEmail", () => {
  it("rejects a non-education email without calling apiPost", async () => {
    await expect(signInWithEmail("student@gmail.com", "pw")).rejects.toThrow(
      "Only .edu email addresses can access this system.",
    );
    expect(mockedApiClient.apiPost).not.toHaveBeenCalled();
  });

  it("posts to /identity/auth/login with email and password", async () => {
    mockedApiClient.apiPost.mockResolvedValue(loginResponse);

    const session = await signInWithEmail("alice@school.edu", "password123");

    expect(mockedApiClient.apiPost).toHaveBeenCalledWith("/identity/auth/login", {
      email: "alice@school.edu",
      password: "password123",
    });
    expect(session).toEqual(expectedSession);
  });

  it("persists the session via setStoredSession", async () => {
    mockedApiClient.apiPost.mockResolvedValue(loginResponse);

    await signInWithEmail("alice@school.edu", "password123");

    expect(mockedApiClient.setStoredSession).toHaveBeenCalledWith(expectedSession);
  });
});

describe("signUpWithEmail", () => {
  const params = {
    email: "alice@school.edu",
    password: "password123",
    fullName: "Alice Nguyen",
    role: "student" as const,
    studentCode: "SE100001",
    classId: "class-1",
  };

  it("rejects a non-education email without calling apiPost", async () => {
    await expect(
      signUpWithEmail({ ...params, email: "alice@gmail.com" }),
    ).rejects.toThrow("Only .edu email addresses can access this system.");
    expect(mockedApiClient.apiPost).not.toHaveBeenCalled();
  });

  it("posts to /identity/auth/register with full payload including studentCode/classId", async () => {
    mockedApiClient.apiPost.mockResolvedValueOnce(undefined).mockResolvedValueOnce(loginResponse);

    await signUpWithEmail(params);

    expect(mockedApiClient.apiPost).toHaveBeenNthCalledWith(1, "/identity/auth/register", {
      email: params.email,
      password: params.password,
      fullName: params.fullName,
      role: params.role,
      studentCode: params.studentCode,
      classId: params.classId,
    });
  });

  it("sends null for studentCode/classId when omitted", async () => {
    mockedApiClient.apiPost.mockResolvedValueOnce(undefined).mockResolvedValueOnce(loginResponse);

    await signUpWithEmail({
      email: params.email,
      password: params.password,
      fullName: params.fullName,
      role: params.role,
    });

    expect(mockedApiClient.apiPost).toHaveBeenNthCalledWith(1, "/identity/auth/register", {
      email: params.email,
      password: params.password,
      fullName: params.fullName,
      role: params.role,
      studentCode: null,
      classId: null,
    });
  });

  it("signs in automatically after registering, returning the resulting session", async () => {
    mockedApiClient.apiPost.mockResolvedValueOnce(undefined).mockResolvedValueOnce(loginResponse);

    const session = await signUpWithEmail(params);

    expect(mockedApiClient.apiPost).toHaveBeenNthCalledWith(2, "/identity/auth/login", {
      email: params.email,
      password: params.password,
    });
    expect(session).toEqual(expectedSession);
    expect(mockedApiClient.setStoredSession).toHaveBeenCalledWith(expectedSession);
  });
});

describe("signInWithGoogle", () => {
  it("posts to /identity/auth/google with the idToken and persists the session", async () => {
    mockedApiClient.apiPost.mockResolvedValue(loginResponse);

    const session = await signInWithGoogle("google-id-token");

    expect(mockedApiClient.apiPost).toHaveBeenCalledWith("/identity/auth/google", {
      idToken: "google-id-token",
    });
    expect(session).toEqual(expectedSession);
    expect(mockedApiClient.setStoredSession).toHaveBeenCalledWith(expectedSession);
  });
});

describe("signOut", () => {
  it("clears the stored session", async () => {
    await signOut();

    expect(mockedApiClient.clearStoredSession).toHaveBeenCalled();
  });
});
