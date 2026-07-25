import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiGetBlob, apiPatch, apiPost, apiPostForm } from "../lib/apiClient";
import {
  confirmRubric,
  downloadRubricFile,
  listRubrics,
  unlockRubric,
  updateRubricCriteria,
  uploadRubricDocx,
  type RubricListItem,
} from "./rubricService";

vi.mock("../lib/apiClient");

const mockedApiGet = vi.mocked(apiGet);
const mockedApiGetBlob = vi.mocked(apiGetBlob);
const mockedApiPatch = vi.mocked(apiPatch);
const mockedApiPost = vi.mocked(apiPost);
const mockedApiPostForm = vi.mocked(apiPostForm);

beforeEach(() => {
  vi.resetAllMocks();
});

function makeFile(name: string) {
  return new File(["content"], name, { type: "application/octet-stream" });
}

describe("uploadRubricDocx", () => {
  it("rejects a non-.docx file before hitting the API", async () => {
    await expect(
      uploadRubricDocx({ subjectId: "s1", file: makeFile("rubric.pdf"), lecturerId: "l1" }),
    ).rejects.toThrow(/\.docx/);
    expect(mockedApiPostForm).not.toHaveBeenCalled();
  });

  it("posts a FormData payload with subject, filename, file, and default scope", async () => {
    const created = { id: "rubric-1" } as RubricListItem;
    mockedApiPostForm.mockResolvedValueOnce(created);

    const file = makeFile("rubric.docx");
    const result = await uploadRubricDocx({ subjectId: "s1", file, lecturerId: "l1" });

    expect(result).toBe(created);
    const [path, form] = mockedApiPostForm.mock.calls[0];
    expect(path).toBe("/catalog/rubrics/upload");
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("SubjectId")).toBe("s1");
    expect((form as FormData).get("Name")).toBe("rubric.docx");
    expect((form as FormData).get("File")).toBe(file);
    expect((form as FormData).get("Scope")).toBe("lecturer");
    expect((form as FormData).has("AssignmentId")).toBe(false);
  });

  it("includes AssignmentId and a custom scope when provided", async () => {
    mockedApiPostForm.mockResolvedValueOnce({ id: "rubric-1" } as RubricListItem);

    await uploadRubricDocx({
      subjectId: "s1",
      assignmentId: "assignment-1",
      file: makeFile("rubric.docx"),
      lecturerId: "l1",
      scope: "schoolWide",
    });

    const form = mockedApiPostForm.mock.calls[0][1] as FormData;
    expect(form.get("AssignmentId")).toBe("assignment-1");
    expect(form.get("Scope")).toBe("schoolWide");
  });
});

describe("listRubrics", () => {
  it("requests without query params and sorts newest first", async () => {
    mockedApiGet.mockResolvedValueOnce([
      { id: "r1", createdAt: "2024-01-01" },
      { id: "r2", createdAt: "2024-03-01" },
      { id: "r3", createdAt: "2024-02-01" },
    ] as RubricListItem[]);

    const result = await listRubrics();

    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/rubrics");
    expect(result.map((r) => r.id)).toEqual(["r2", "r3", "r1"]);
  });

  it("builds a query string from subjectId and assignmentId when provided", async () => {
    mockedApiGet.mockResolvedValueOnce([]);

    await listRubrics({ subjectId: "s1", assignmentId: "a1" });

    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/rubrics?subjectId=s1&assignmentId=a1");
  });

  it("omits assignmentId from the query when it is null", async () => {
    mockedApiGet.mockResolvedValueOnce([]);

    await listRubrics({ subjectId: "s1", assignmentId: null });

    expect(mockedApiGet).toHaveBeenCalledWith("/catalog/rubrics?subjectId=s1");
  });
});

describe("downloadRubricFile", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("fetches the blob and triggers a download via a temporary anchor", async () => {
    const blob = new Blob(["file"]);
    mockedApiGetBlob.mockResolvedValueOnce(blob);
    const clickSpy = vi.fn();
    const anchor = { href: "", download: "", click: clickSpy } as unknown as HTMLAnchorElement;
    const createElementSpy = vi.spyOn(document, "createElement").mockReturnValue(anchor);

    const rubric = { id: "rubric-1", name: "Rubric.docx" } as RubricListItem;
    await downloadRubricFile(rubric);

    expect(mockedApiGetBlob).toHaveBeenCalledWith("/catalog/rubrics/rubric-1/file");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe("blob:mock-url");
    expect(anchor.download).toBe("Rubric.docx");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    createElementSpy.mockRestore();
  });
});

describe("confirmRubric / unlockRubric / updateRubricCriteria", () => {
  it("confirmRubric posts to the confirm endpoint", async () => {
    const rubric = { id: "rubric-1" } as RubricListItem;
    mockedApiPost.mockResolvedValueOnce(rubric);

    const result = await confirmRubric("rubric-1");

    expect(mockedApiPost).toHaveBeenCalledWith("/catalog/rubrics/rubric-1/confirm");
    expect(result).toBe(rubric);
  });

  it("unlockRubric posts to the unlock endpoint", async () => {
    const rubric = { id: "rubric-1" } as RubricListItem;
    mockedApiPost.mockResolvedValueOnce(rubric);

    const result = await unlockRubric("rubric-1");

    expect(mockedApiPost).toHaveBeenCalledWith("/catalog/rubrics/rubric-1/unlock");
    expect(result).toBe(rubric);
  });

  it("updateRubricCriteria patches criteria to the rubric's criteria endpoint", async () => {
    const criteria = [{ name: "C1", maxScore: 10, orderIndex: 0 }];
    mockedApiPatch.mockResolvedValueOnce([]);

    await updateRubricCriteria("rubric-1", criteria);

    expect(mockedApiPatch).toHaveBeenCalledWith("/catalog/rubrics/rubric-1/criteria", criteria);
  });
});
