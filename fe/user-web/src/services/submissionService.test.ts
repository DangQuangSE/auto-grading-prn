import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiClient from "../lib/apiClient";
import { createSubmission, listAssignmentSubmissions, listMySubmissions } from "./submissionService";

vi.mock("../lib/apiClient", () => ({
  apiGet: vi.fn(),
  apiPostForm: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

beforeEach(() => {
  vi.resetAllMocks();
});

const submission1 = {
  id: "sub-1",
  assignmentId: "a1",
  studentId: "stu-1",
  reportObjectKey: "key1",
  state: "graded" as const,
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
  attemptNumber: 1,
};
const submission2 = {
  id: "sub-2",
  assignmentId: "a1",
  studentId: "stu-1",
  reportObjectKey: "key2",
  state: "graded" as const,
  createdAt: "2024-01-02",
  updatedAt: "2024-01-02",
  attemptNumber: 2,
};

describe("createSubmission", () => {
  it("posts a FormData with AssignmentId and ReportFile to /submissions/submissions/upload", async () => {
    mockedApiClient.apiPostForm.mockResolvedValue(submission1);
    const reportFile = new File(["content"], "report.docx");

    const result = await createSubmission({
      assignmentId: "a1",
      studentId: "stu-1",
      reportFile,
    });

    expect(mockedApiClient.apiPostForm).toHaveBeenCalledTimes(1);
    const [path, form] = mockedApiClient.apiPostForm.mock.calls[0];
    expect(path).toBe("/submissions/submissions/upload");
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("AssignmentId")).toBe("a1");
    expect((form as FormData).get("ReportFile")).toBe(reportFile);
    expect((form as FormData).get("DiagramFile")).toBeNull();
    expect(result).toBe(submission1);
  });

  it("includes DiagramFile in the form when provided", async () => {
    mockedApiClient.apiPostForm.mockResolvedValue(submission1);
    const reportFile = new File(["content"], "report.docx");
    const diagramFile = new File(["diagram"], "diagram.drawio");

    await createSubmission({
      assignmentId: "a1",
      studentId: "stu-1",
      reportFile,
      diagramFile,
    });

    const [, form] = mockedApiClient.apiPostForm.mock.calls[0];
    expect((form as FormData).get("DiagramFile")).toBe(diagramFile);
  });

  it("rejects a report file with a disallowed extension without calling apiPostForm", async () => {
    const reportFile = new File(["content"], "report.pdf");

    await expect(
      createSubmission({ assignmentId: "a1", studentId: "stu-1", reportFile }),
    ).rejects.toThrow("File must use one of these extensions: .docx");
    expect(mockedApiClient.apiPostForm).not.toHaveBeenCalled();
  });

  it("rejects a diagram file with a disallowed extension without calling apiPostForm", async () => {
    const reportFile = new File(["content"], "report.docx");
    const diagramFile = new File(["diagram"], "diagram.png");

    await expect(
      createSubmission({ assignmentId: "a1", studentId: "stu-1", reportFile, diagramFile }),
    ).rejects.toThrow("File must use one of these extensions: .drawio");
    expect(mockedApiClient.apiPostForm).not.toHaveBeenCalled();
  });
});

describe("listMySubmissions", () => {
  it("GETs /submissions/submissions?studentId=... and sorts newest first", async () => {
    mockedApiClient.apiGet.mockResolvedValue([submission1, submission2]);

    const result = await listMySubmissions("stu-1");

    expect(mockedApiClient.apiGet).toHaveBeenCalledWith("/submissions/submissions?studentId=stu-1");
    expect(result.map((s) => s.id)).toEqual(["sub-2", "sub-1"]);
  });
});

describe("listAssignmentSubmissions", () => {
  it("GETs /submissions/submissions?assignmentId=... and sorts newest first", async () => {
    mockedApiClient.apiGet.mockResolvedValue([submission1, submission2]);

    const result = await listAssignmentSubmissions("a1");

    expect(mockedApiClient.apiGet).toHaveBeenCalledWith("/submissions/submissions?assignmentId=a1");
    expect(result.map((s) => s.id)).toEqual(["sub-2", "sub-1"]);
  });
});
