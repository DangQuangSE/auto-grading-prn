import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as AuthProviderModule from "../providers/AuthProvider";
import * as subjectService from "../services/subjectService";
import * as submissionService from "../services/submissionService";
import { StudentSubmissionPage } from "./StudentSubmissionPage";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../providers/AuthProvider", async () => {
  const actual = await vi.importActual<typeof import("../providers/AuthProvider")>("../providers/AuthProvider");
  return { ...actual, useAuth: vi.fn() };
});

vi.mock("../services/subjectService");
vi.mock("../services/submissionService");

const mockedUseAuth = vi.mocked(AuthProviderModule.useAuth);
const mockedSubjectService = vi.mocked(subjectService);
const mockedSubmissionService = vi.mocked(submissionService);

const session = { token: "t", user: { id: "student-1", email: "alice@school.edu", role: "student" as const } };

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(<StudentSubmissionPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedUseAuth.mockReturnValue({
    session,
    isLoadingSession: false,
    authNotice: null,
    refreshSession: vi.fn(),
    signOutUser: vi.fn(),
  });
  mockedSubjectService.listSubjects.mockResolvedValue([
    { id: "subj-1", code: "SE100", name: "Intro to SE", createdAt: "2024-01-01", registrationStatus: "open" },
  ]);
  mockedSubjectService.listAssignments.mockResolvedValue([
    { id: "assign-1", subjectId: "subj-1", title: "Assignment One", maxAttempts: 2, createdAt: "2024-01-01" },
  ]);
  mockedSubmissionService.listMySubmissions.mockResolvedValue([]);
});

describe("StudentSubmissionPage", () => {
  it("renders the subject dropdown populated from useSubjects", async () => {
    renderPage();

    expect(await screen.findByText("SE100 - Intro to SE")).toBeInTheDocument();
  });

  it("disables the submit button until a report file and assignment are chosen", async () => {
    const user = userEvent.setup();
    renderPage();

    const submitButton = screen.getByRole("button", { name: /submit/i });
    expect(submitButton).toBeDisabled();

    await screen.findByText("SE100 - Intro to SE");
    await user.selectOptions(screen.getByLabelText("Subject"), "subj-1");
    await screen.findByText("Assignment One");
    await user.selectOptions(screen.getByLabelText("Assignment"), "assign-1");

    // Still disabled: no report file selected yet.
    expect(submitButton).toBeDisabled();

    const reportInput = screen.getByLabelText("Report document", { exact: false }) as HTMLInputElement;
    const file = new File(["content"], "report.docx");
    await user.upload(reportInput, file);

    await waitFor(() => expect(submitButton).not.toBeDisabled());
  });

  it("shows attempts used once an assignment is selected", async () => {
    mockedSubmissionService.listMySubmissions.mockResolvedValue([
      {
        id: "sub-1",
        assignmentId: "assign-1",
        studentId: "student-1",
        reportObjectKey: "report.docx",
        state: "uploaded",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
        attemptNumber: 1,
      },
    ]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("SE100 - Intro to SE");
    await user.selectOptions(screen.getByLabelText("Subject"), "subj-1");
    await screen.findByText("Assignment One");
    await user.selectOptions(screen.getByLabelText("Assignment"), "assign-1");

    expect(await screen.findByText("Attempts used: 1 / 2")).toBeInTheDocument();
  });

  it("disables submit and shows an error tone once the attempt limit is reached", async () => {
    mockedSubmissionService.listMySubmissions.mockResolvedValue([
      {
        id: "sub-1",
        assignmentId: "assign-1",
        studentId: "student-1",
        reportObjectKey: "report.docx",
        state: "uploaded",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
        attemptNumber: 1,
      },
      {
        id: "sub-2",
        assignmentId: "assign-1",
        studentId: "student-1",
        reportObjectKey: "report2.docx",
        state: "uploaded",
        createdAt: "2024-01-02",
        updatedAt: "2024-01-02",
        attemptNumber: 2,
      },
    ]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("SE100 - Intro to SE");
    await user.selectOptions(screen.getByLabelText("Subject"), "subj-1");
    await screen.findByText("Assignment One");
    await user.selectOptions(screen.getByLabelText("Assignment"), "assign-1");

    expect(await screen.findByText("Attempts used: 2 / 2")).toBeInTheDocument();

    const reportInput = screen.getByLabelText("Report document", { exact: false }) as HTMLInputElement;
    await user.upload(reportInput, new File(["content"], "report.docx"));

    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
  });

  it("submits the form and navigates to the result page on success", async () => {
    mockedSubmissionService.createSubmission.mockResolvedValue({
      id: "new-sub-1",
      assignmentId: "assign-1",
      studentId: "student-1",
      reportObjectKey: "report.docx",
      state: "uploaded",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      attemptNumber: 1,
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("SE100 - Intro to SE");
    await user.selectOptions(screen.getByLabelText("Subject"), "subj-1");
    await screen.findByText("Assignment One");
    await user.selectOptions(screen.getByLabelText("Assignment"), "assign-1");

    const reportInput = screen.getByLabelText("Report document", { exact: false }) as HTMLInputElement;
    await user.upload(reportInput, new File(["content"], "report.docx"));

    const submitButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /submit/i });
      expect(button).not.toBeDisabled();
      return button;
    });
    await user.click(submitButton);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/result/new-sub-1"));
    expect(mockedSubmissionService.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: "assign-1", studentId: "student-1" }),
      expect.anything(),
    );
  });

  it("shows the mutation's error message when the submission fails", async () => {
    // StudentSubmissionPage's handleSubmit awaits mutateAsync without a try/catch, so a
    // rejected mutation surfaces as a genuine unhandled promise rejection (a source bug) in
    // addition to updating createSubmission.error. Vitest's process-level "unhandledRejection"
    // listener reports this and would otherwise turn the whole run red for a passing test, so
    // temporarily swap it out for the duration of this test only.
    const originalListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", () => {});

    mockedSubmissionService.createSubmission.mockRejectedValue(new Error("Upload rejected by server"));

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("SE100 - Intro to SE");
    await user.selectOptions(screen.getByLabelText("Subject"), "subj-1");
    await screen.findByText("Assignment One");
    await user.selectOptions(screen.getByLabelText("Assignment"), "assign-1");

    const reportInput = screen.getByLabelText("Report document", { exact: false }) as HTMLInputElement;
    await user.upload(reportInput, new File(["content"], "report.docx"));

    const submitButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /submit/i });
      expect(button).not.toBeDisabled();
      return button;
    });
    await user.click(submitButton);

    expect(await screen.findByText("Upload rejected by server")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    process.removeAllListeners("unhandledRejection");
    originalListeners.forEach((listener) => process.on("unhandledRejection", listener as NodeJS.UnhandledRejectionListener));
  });
});
