import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as AuthProviderModule from "../providers/AuthProvider";
import * as subjectService from "../services/subjectService";
import { AssignmentsPage } from "./AssignmentsPage";

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

  return render(<AssignmentsPage />, { wrapper: Wrapper });
}

const subject = { id: "subject-1", code: "SWD392", name: "Software Development", registrationStatus: "open" as const, createdAt: "2026-01-01" };
const assignment = { id: "assignment-1", subjectId: "subject-1", title: "Assignment 1", description: "Details", dueDate: "2026-02-01", maxAttempts: 3, createdAt: "2026-01-01" };

const subjectsPage = { items: [subject], page: 1, pageSize: 100, totalCount: 1, totalPages: 1 };
const emptyAssignments = { items: [], page: 1, pageSize: 5, totalCount: 0, totalPages: 1 };
const assignmentsPage = { items: [assignment], page: 1, pageSize: 5, totalCount: 1, totalPages: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  mockedUseAuth.mockReturnValue({
    session: { token: "t", user: { id: "admin-1", email: "admin@school.edu", role: "admin" } },
    setSession: vi.fn(),
    signOut: vi.fn(),
  });
  mockedSubjectService.listSubjects.mockResolvedValue(subjectsPage);
});

describe("AssignmentsPage", () => {
  it("prompts to select a subject before an assignment is chosen", async () => {
    mockedSubjectService.listAssignments.mockResolvedValue(emptyAssignments);

    renderPage();

    expect(await screen.findByText("Select a subject to create your first assignment.")).toBeInTheDocument();
  });

  it("renders assignments once a subject is selected", async () => {
    mockedSubjectService.listAssignments.mockResolvedValue(assignmentsPage);

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("SWD392 - Software Development");
    await user.selectOptions(screen.getByLabelText("Subject"), "subject-1");

    expect(await screen.findByText("Assignment 1")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("creates a new assignment with the entered fields", async () => {
    mockedSubjectService.listAssignments.mockResolvedValue(emptyAssignments);
    mockedSubjectService.createAssignment.mockResolvedValue(assignment);

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("SWD392 - Software Development");
    await user.selectOptions(screen.getByLabelText("Subject"), "subject-1");
    await user.type(screen.getByPlaceholderText("Final exam, Group project #1..."), "Assignment 1");
    await user.type(screen.getByPlaceholderText("Details for this assignment"), "Details");
    await user.click(screen.getByRole("button", { name: /create assignment/i }));

    await waitFor(() => {
      expect(mockedSubjectService.createAssignment).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId: "subject-1",
          title: "Assignment 1",
          description: "Details",
          createdBy: "admin-1",
          maxAttempts: 1,
        }),
        expect.anything(),
      );
    });
    expect(screen.getByPlaceholderText("Final exam, Group project #1...")).toHaveValue("");
  });

  it("disables the submit button until a subject and title are filled", async () => {
    mockedSubjectService.listAssignments.mockResolvedValue(emptyAssignments);

    renderPage();

    await screen.findByText("SWD392 - Software Development");
    expect(screen.getByRole("button", { name: /create assignment/i })).toBeDisabled();
    expect(mockedSubjectService.createAssignment).not.toHaveBeenCalled();
  });

  it("shows an empty state message specific to the selected subject", async () => {
    mockedSubjectService.listAssignments.mockResolvedValue(emptyAssignments);

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("SWD392 - Software Development");
    await user.selectOptions(screen.getByLabelText("Subject"), "subject-1");

    expect(await screen.findByText("Create an assignment to start uploading rubrics for it.")).toBeInTheDocument();
  });

  it("shows an error message when the assignments query fails", async () => {
    mockedSubjectService.listAssignments.mockRejectedValue(new ApiError(500, "Server error"));

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("SWD392 - Software Development");
    await user.selectOptions(screen.getByLabelText("Subject"), "subject-1");

    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });
});
