import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPostForm } from "../lib/apiClient";
import { createSubmission, listAssignmentSubmissions, listMySubmissions } from "./submissionService";

vi.mock("../lib/apiClient");

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPostForm = vi.mocked(apiPostForm);

beforeEach(() => {
  vi.resetAllMocks();
});

function makeFile(name: string) {
  return new File(["content"], name);
}

describe("createSubmission", () => {
  it("rejects a report file without a .docx extension", async () => {
    await expect(
      createSubmission({
        assignmentId: "a1",
        studentId: "s1",
        reportFile: makeFile("report.pdf"),
        diagramFile: makeFile("diagram.drawio"),
      }),
    ).rejects.toThrow(/\.docx/);
    expect(mockedApiPostForm).not.toHaveBeenCalled();
  });

  it("rejects a diagram file without a .drawio extension", async () => {
    await expect(
      createSubmission({
        assignmentId: "a1",
        studentId: "s1",
        reportFile: makeFile("report.docx"),
        diagramFile: makeFile("diagram.png"),
      }),
    ).rejects.toThrow(/\.drawio/);
    expect(mockedApiPostForm).not.toHaveBeenCalled();
  });

  it("posts a FormData payload with assignment, student, and both files", async () => {
    const created = { id: "sub-1" };
    mockedApiPostForm.mockResolvedValueOnce(created);

    const reportFile = makeFile("report.docx");
    const diagramFile = makeFile("diagram.drawio");
    const result = await createSubmission({
      assignmentId: "a1",
      studentId: "s1",
      reportFile,
      diagramFile,
    });

    expect(result).toBe(created);
    const [path, form] = mockedApiPostForm.mock.calls[0];
    expect(path).toBe("/submissions/submissions/upload");
    expect((form as FormData).get("AssignmentId")).toBe("a1");
    expect((form as FormData).get("StudentId")).toBe("s1");
    expect((form as FormData).get("ReportFile")).toBe(reportFile);
    expect((form as FormData).get("DiagramFile")).toBe(diagramFile);
  });
});

describe("listMySubmissions", () => {
  it("queries by studentId and sorts newest first", async () => {
    mockedApiGet.mockResolvedValueOnce([
      { id: "s1", createdAt: "2024-01-01" },
      { id: "s2", createdAt: "2024-03-01" },
    ]);

    const result = await listMySubmissions("student-1");

    expect(mockedApiGet).toHaveBeenCalledWith("/submissions/submissions?studentId=student-1");
    expect(result.map((r) => r.id)).toEqual(["s2", "s1"]);
  });
});

describe("listAssignmentSubmissions", () => {
  it("queries by assignmentId and sorts newest first", async () => {
    mockedApiGet.mockResolvedValueOnce([
      { id: "s1", createdAt: "2024-02-01" },
      { id: "s2", createdAt: "2024-01-01" },
    ]);

    const result = await listAssignmentSubmissions("assignment-1");

    expect(mockedApiGet).toHaveBeenCalledWith("/submissions/submissions?assignmentId=assignment-1");
    expect(result.map((r) => r.id)).toEqual(["s1", "s2"]);
  });
});
