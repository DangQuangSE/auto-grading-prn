import { beforeEach, describe, expect, it, vi } from "vitest";
import { utils, write } from "xlsx";
import { apiPostForm } from "../lib/apiClient";
import { previewRosterFile, uploadRosterFile, type RosterImportReport } from "./bulkImportService";

vi.mock("../lib/apiClient");

const mockedApiPostForm = vi.mocked(apiPostForm);

beforeEach(() => {
  vi.resetAllMocks();
});

function makeWorkbookFile(rows: string[][], fileName = "roster.xlsx"): File {
  const worksheet = utils.aoa_to_sheet(rows);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, "Sheet1");
  const buffer = write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buffer], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("uploadRosterFile", () => {
  it("posts the file as multipart FormData under the 'File' key", async () => {
    const report: RosterImportReport = {
      totalRows: 2,
      updatedCount: 2,
      skippedCount: 0,
      details: [],
    };
    mockedApiPostForm.mockResolvedValueOnce(report);

    const file = new File(["a,b"], "roster.csv");
    const result = await uploadRosterFile(file);

    expect(result).toBe(report);
    const [path, form] = mockedApiPostForm.mock.calls[0];
    expect(path).toBe("/identity/users/bulk-import");
    expect((form as FormData).get("File")).toBe(file);
  });
});

describe("previewRosterFile", () => {
  it("parses the header row case-insensitively and returns up to 5 trimmed data rows", async () => {
    const file = makeWorkbookFile([
      ["Email", "StudentCode", "ClassName"],
      [" a@b.com ", "SC1", "SE1801"],
      ["c@d.com", "SC2", "SE1802"],
    ]);

    const result = await previewRosterFile(file);

    expect(result).toEqual([
      { email: "a@b.com", studentCode: "SC1", className: "SE1801" },
      { email: "c@d.com", studentCode: "SC2", className: "SE1802" },
    ]);
  });

  it("matches header names case-insensitively and regardless of column order", async () => {
    const file = makeWorkbookFile([
      ["classname", "email", "studentcode"],
      ["SE1801", "a@b.com", "SC1"],
    ]);

    const result = await previewRosterFile(file);

    expect(result).toEqual([{ email: "a@b.com", studentCode: "SC1", className: "SE1801" }]);
  });

  it("caps the preview at 5 rows", async () => {
    const dataRows = Array.from({ length: 10 }, (_, i) => [`u${i}@b.com`, `SC${i}`, "SE1801"]);
    const file = makeWorkbookFile([["Email", "StudentCode", "ClassName"], ...dataRows]);

    const result = await previewRosterFile(file);

    expect(result).toHaveLength(5);
    expect(result[0].email).toBe("u0@b.com");
  });

  it("returns an empty array when the sheet has no header row", async () => {
    const workbook = utils.book_new();
    const worksheet = utils.aoa_to_sheet([]);
    utils.book_append_sheet(workbook, worksheet, "Sheet1");
    const buffer = write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buffer], "empty.xlsx");

    const result = await previewRosterFile(file);

    expect(result).toEqual([]);
  });

  it("returns empty strings for missing/blank cells and unmatched columns", async () => {
    const file = makeWorkbookFile([
      ["Email", "StudentCode"],
      ["a@b.com", "SC1"],
    ]);

    const result = await previewRosterFile(file);

    expect(result).toEqual([{ email: "a@b.com", studentCode: "SC1", className: "" }]);
  });
});
