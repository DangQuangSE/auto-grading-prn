import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import * as AuthProviderModule from "../providers/AuthProvider";
import * as classService from "../services/classService";
import * as enrollmentService from "../services/enrollmentService";
import * as subjectService from "../services/subjectService";
import { StudentProfilePage } from "./StudentProfilePage";

vi.mock("../providers/AuthProvider", async () => {
  const actual = await vi.importActual<typeof import("../providers/AuthProvider")>("../providers/AuthProvider");
  return { ...actual, useAuth: vi.fn() };
});

vi.mock("../services/classService");
vi.mock("../services/enrollmentService");
vi.mock("../services/subjectService");

const mockedUseAuth = vi.mocked(AuthProviderModule.useAuth);
const mockedClassService = vi.mocked(classService);
const mockedEnrollmentService = vi.mocked(enrollmentService);
const mockedSubjectService = vi.mocked(subjectService);

const session = { token: "t", user: { id: "student-1", email: "alice@school.edu", role: "student" as const } };

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return render(<StudentProfilePage />, { wrapper: Wrapper });
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
  mockedSubjectService.listOpenSubjects.mockResolvedValue([
    { id: "subj-1", code: "SE100", name: "Intro to SE", createdAt: "2024-01-01", registrationStatus: "open" },
  ]);
  mockedClassService.getClassesBySubject.mockResolvedValue([{ id: "class-1", name: "SE1801" }]);
  mockedEnrollmentService.listMyEnrollments.mockResolvedValue([]);
});

describe("StudentProfilePage", () => {
  it("renders the account email", () => {
    renderPage();

    expect(screen.getByText("alice@school.edu")).toBeInTheDocument();
  });

  it("shows an empty state when there are no enrollments", async () => {
    renderPage();

    expect(await screen.findByText("No enrolled subjects")).toBeInTheDocument();
  });

  it("renders the enrollments table when data is present", async () => {
    mockedEnrollmentService.listMyEnrollments.mockResolvedValue([
      {
        id: "enr-1",
        subjectId: "subj-1",
        subjectCode: "SE100",
        subjectName: "Intro to SE",
        registrationStatus: "open",
        classId: "class-1",
        className: "SE1801",
        rowVersion: "v1",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      },
    ]);

    renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("SE100 — Intro to SE")).toBeInTheDocument();
    expect(within(table).getByText("SE1801")).toBeInTheDocument();
    expect(within(table).getByText("Open for changes")).toBeInTheDocument();
  });

  it("populates the subject dropdown from useOpenSubjects", async () => {
    renderPage();

    expect(await screen.findByText("SE100 — Intro to SE")).toBeInTheDocument();
  });

  it("disables the class select until a subject is chosen, then loads classes", async () => {
    const user = userEvent.setup();
    renderPage();

    const classSelect = screen.getByLabelText("Class") as HTMLSelectElement;
    expect(classSelect).toBeDisabled();

    await screen.findByText("SE100 — Intro to SE");
    await user.selectOptions(screen.getByLabelText("Subject"), "subj-1");

    await waitFor(() => expect(classSelect).not.toBeDisabled());
    expect(await screen.findByText("SE1801")).toBeInTheDocument();
    expect(mockedClassService.getClassesBySubject).toHaveBeenCalledWith("subj-1");
  });

  it("keeps the save button disabled until both subject and class are selected", async () => {
    const user = userEvent.setup();
    renderPage();

    const saveButton = screen.getByRole("button", { name: /save enrollment/i });
    expect(saveButton).toBeDisabled();

    await screen.findByText("SE100 — Intro to SE");
    await user.selectOptions(screen.getByLabelText("Subject"), "subj-1");
    expect(saveButton).toBeDisabled();

    await screen.findByText("SE1801");
    await user.selectOptions(screen.getByLabelText("Class"), "class-1");

    expect(saveButton).not.toBeDisabled();
  });

  it("saves the enrollment and shows a success message, resetting the form", async () => {
    mockedEnrollmentService.saveMyEnrollment.mockResolvedValue({} as any);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("SE100 — Intro to SE");
    await user.selectOptions(screen.getByLabelText("Subject"), "subj-1");
    await screen.findByText("SE1801");
    await user.selectOptions(screen.getByLabelText("Class"), "class-1");

    await user.click(screen.getByRole("button", { name: /save enrollment/i }));

    expect(await screen.findByText("Enrollment saved.")).toBeInTheDocument();
    expect(mockedEnrollmentService.saveMyEnrollment).toHaveBeenCalledWith(
      { subjectId: "subj-1", classId: "class-1", rowVersion: null },
      expect.anything(),
    );

    await waitFor(() => expect(screen.getByLabelText("Subject")).toHaveValue(""));
  });

  it("shows a conflict message and confirm button on a 409 error", async () => {
    mockedEnrollmentService.saveMyEnrollment.mockRejectedValue(
      new ApiError(409, "Row version mismatch"),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("SE100 — Intro to SE");
    await user.selectOptions(screen.getByLabelText("Subject"), "subj-1");
    await screen.findByText("SE1801");
    await user.selectOptions(screen.getByLabelText("Class"), "class-1");

    await user.click(screen.getByRole("button", { name: /save enrollment/i }));

    expect(
      await screen.findByText(/enrollment changed or registration closed/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use refreshed data and retry/i })).toBeInTheDocument();
  });
});
