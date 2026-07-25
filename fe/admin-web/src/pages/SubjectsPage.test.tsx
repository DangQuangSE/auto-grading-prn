import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as AuthProviderModule from "../providers/AuthProvider";
import * as subjectService from "../services/subjectService";
import { SubjectsPage } from "./SubjectsPage";

vi.mock("../services/subjectService");

vi.mock("../providers/AuthProvider", async () => {
  const actual = await vi.importActual<typeof import("../providers/AuthProvider")>("../providers/AuthProvider");
  return { ...actual, useAuth: vi.fn() };
});

const mockedSubjectService = vi.mocked(subjectService);
const mockedUseAuth = vi.mocked(AuthProviderModule.useAuth);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return render(<SubjectsPage />, { wrapper: Wrapper });
}

const adminSession = { session: { token: "t", user: { id: "admin-1", email: "admin@school.edu", role: "admin" as const } }, setSession: vi.fn(), signOut: vi.fn() };
const lecturerSession = { session: { token: "t", user: { id: "lecturer-1", email: "lecturer@school.edu", role: "lecturer" as const } }, setSession: vi.fn(), signOut: vi.fn() };

const subject = { id: "subject-1", code: "SWD392", name: "Software Development", registrationStatus: "open" as const, createdAt: "2026-01-01" };

const emptyPage = { items: [], page: 1, pageSize: 5, totalCount: 0, totalPages: 1 };
const subjectsPage = { items: [subject], page: 1, pageSize: 5, totalCount: 1, totalPages: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  mockedUseAuth.mockReturnValue(adminSession);
});

describe("SubjectsPage", () => {
  it("renders an empty state with no subjects", async () => {
    mockedSubjectService.listSubjects.mockResolvedValue(emptyPage);

    renderPage();

    expect(await screen.findByText("No subjects yet")).toBeInTheDocument();
  });

  it("renders the subject list with registration status", async () => {
    mockedSubjectService.listSubjects.mockResolvedValue(subjectsPage);

    renderPage();

    expect(await screen.findByText("SWD392")).toBeInTheDocument();
    expect(screen.getByText("Software Development")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("creates a new subject and clears the form on success", async () => {
    mockedSubjectService.listSubjects.mockResolvedValue(emptyPage);
    mockedSubjectService.createSubject.mockResolvedValue(subject);

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("No subjects yet");

    await user.type(screen.getByPlaceholderText("SWD392"), "SWD392");
    await user.type(screen.getByPlaceholderText("Software Development"), "Software Development");
    await user.click(screen.getByRole("button", { name: /create subject/i }));

    await waitFor(() => {
      expect(mockedSubjectService.createSubject).toHaveBeenCalledWith(
        { code: "SWD392", name: "Software Development", createdBy: "admin-1" },
        expect.anything(),
      );
    });
    expect(screen.getByPlaceholderText("SWD392")).toHaveValue("");
    expect(screen.getByPlaceholderText("Software Development")).toHaveValue("");
  });

  it("shows an error message when subject creation fails", async () => {
    mockedSubjectService.listSubjects.mockResolvedValue(emptyPage);
    mockedSubjectService.createSubject.mockRejectedValue(new ApiError(400, "Subject code already exists"));

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("No subjects yet");

    await user.type(screen.getByPlaceholderText("SWD392"), "SWD392");
    await user.type(screen.getByPlaceholderText("Software Development"), "Software Development");
    await user.click(screen.getByRole("button", { name: /create subject/i }));

    expect(await screen.findByText("Subject code already exists")).toBeInTheDocument();
  });

  it("lets an admin toggle registration status", async () => {
    mockedSubjectService.listSubjects.mockResolvedValue(subjectsPage);
    mockedSubjectService.updateSubjectRegistration.mockResolvedValue({ ...subject, registrationStatus: "closed" });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("SWD392");
    await user.click(screen.getByRole("button", { name: /close registration/i }));

    await waitFor(() => {
      expect(mockedSubjectService.updateSubjectRegistration).toHaveBeenCalledWith("subject-1", "closed");
    });
    expect(await screen.findByText("Registration is now closed.")).toBeInTheDocument();
  });

  it("hides the registration toggle for a lecturer", async () => {
    mockedUseAuth.mockReturnValue(lecturerSession);
    mockedSubjectService.listSubjects.mockResolvedValue(subjectsPage);

    renderPage();

    await screen.findByText("SWD392");
    expect(screen.queryByRole("button", { name: /close registration/i })).not.toBeInTheDocument();
  });

  it("does not submit the create form when required fields are blank", async () => {
    mockedSubjectService.listSubjects.mockResolvedValue(emptyPage);

    renderPage();

    await screen.findByText("No subjects yet");
    expect(screen.getByRole("button", { name: /create subject/i })).toBeDisabled();
    expect(mockedSubjectService.createSubject).not.toHaveBeenCalled();
  });
});
