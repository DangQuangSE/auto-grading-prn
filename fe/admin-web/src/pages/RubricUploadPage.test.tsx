import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as AuthProviderModule from "../providers/AuthProvider";
import * as rubricService from "../services/rubricService";
import * as subjectService from "../services/subjectService";
import { RubricUploadPage } from "./RubricUploadPage";

vi.mock("../services/rubricService");
vi.mock("../services/subjectService");

vi.mock("../providers/AuthProvider", async () => {
  const actual = await vi.importActual<typeof import("../providers/AuthProvider")>("../providers/AuthProvider");
  return { ...actual, useAuth: vi.fn() };
});

const mockedRubricService = vi.mocked(rubricService);
const mockedSubjectService = vi.mocked(subjectService);
const mockedUseAuth = vi.mocked(AuthProviderModule.useAuth);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return render(<RubricUploadPage />, { wrapper: Wrapper });
}

const subject = { id: "subject-1", code: "SWD392", name: "Software Development", registrationStatus: "open" as const, createdAt: "2026-01-01" };
const assignment = { id: "assignment-1", subjectId: "subject-1", title: "Assignment 1", createdAt: "2026-01-01" };

const subjectsPage = { items: [subject], page: 1, pageSize: 100, totalCount: 1, totalPages: 1 };
const assignmentsPage = { items: [assignment], page: 1, pageSize: 100, totalCount: 1, totalPages: 1 };

const rubric = {
  id: "rubric-1",
  subjectId: "subject-1",
  assignmentId: "assignment-1",
  name: "rubric.docx",
  createdAt: "2026-01-01",
  status: "draft" as const,
  scope: "lecturer" as const,
  criteria: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mockedUseAuth.mockReturnValue({
    session: { token: "t", user: { id: "lecturer-1", email: "lecturer@school.edu", role: "lecturer" } },
    setSession: vi.fn(),
    signOut: vi.fn(),
  });
  mockedSubjectService.listSubjects.mockResolvedValue(subjectsPage);
  mockedSubjectService.listAssignments.mockResolvedValue(assignmentsPage);
  mockedRubricService.listRubrics.mockResolvedValue([]);
});

describe("RubricUploadPage", () => {
  it("shows an empty state when there are no rubrics", async () => {
    renderPage();

    expect(await screen.findByText("No rubrics uploaded")).toBeInTheDocument();
  });

  it("disables the school-wide scope option for a lecturer", async () => {
    renderPage();

    await screen.findByText("No rubrics uploaded");
    expect(screen.getByRole("radio", { name: /school-wide \(admin only\)/i })).toBeDisabled();
  });

  it("enables the school-wide scope option for an admin", async () => {
    mockedUseAuth.mockReturnValue({
      session: { token: "t", user: { id: "admin-1", email: "admin@school.edu", role: "admin" } },
      setSession: vi.fn(),
      signOut: vi.fn(),
    });

    renderPage();

    await screen.findByText("No rubrics uploaded");
    expect(screen.getByRole("radio", { name: "School-wide" })).not.toBeDisabled();
  });

  it("uploads a rubric after selecting subject, assignment and a file", async () => {
    mockedRubricService.uploadRubricDocx.mockResolvedValue(rubric);

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("No rubrics uploaded");
    await user.selectOptions(screen.getByLabelText("Subject"), "subject-1");
    await user.selectOptions(screen.getByLabelText("Assignment"), "assignment-1");

    const file = new File(["content"], "rubric.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: /parse rubric/i }));

    await waitFor(() => {
      expect(mockedRubricService.uploadRubricDocx).toHaveBeenCalledWith(
        {
          subjectId: "subject-1",
          assignmentId: "assignment-1",
          file,
          lecturerId: "lecturer-1",
          scope: "lecturer",
        },
        expect.anything(),
      );
    });
    expect(await screen.findByText("Rubric uploaded and parsed successfully.")).toBeInTheDocument();
  });

  it("renders the rubric table once rubrics are loaded", async () => {
    mockedRubricService.listRubrics.mockResolvedValue([rubric]);

    renderPage();

    const row = (await screen.findByText("rubric.docx")).closest("tr")!;
    expect(within(row).getByText("SWD392")).toBeInTheDocument();
    expect(within(row).getByText("Assignment 1")).toBeInTheDocument();
    expect(within(row).getByText("Draft")).toBeInTheDocument();
  });

  it("shows an error message when the subjects query fails", async () => {
    mockedSubjectService.listSubjects.mockRejectedValue(new ApiError(500, "Server error"));

    renderPage();

    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });
});
