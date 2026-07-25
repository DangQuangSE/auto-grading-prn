import { describe, expect, it } from "vitest";
import { assertValidFileExtension } from "./validation";

describe("assertValidFileExtension", () => {
  it("does not throw when the file name ends with an allowed extension", () => {
    expect(() => assertValidFileExtension("report.docx", [".docx"])).not.toThrow();
  });

  it("does not throw when the file matches one of several allowed extensions", () => {
    expect(() => assertValidFileExtension("diagram.drawio", [".docx", ".drawio"])).not.toThrow();
  });

  it("throws when the file extension is not in the allowed list", () => {
    expect(() => assertValidFileExtension("report.pdf", [".docx"])).toThrow(
      "File must use one of these extensions: .docx",
    );
  });

  it("is case-insensitive when matching extensions", () => {
    expect(() => assertValidFileExtension("Report.DOCX", [".docx"])).not.toThrow();
  });

  it("throws when the file name has no extension at all", () => {
    expect(() => assertValidFileExtension("report", [".docx"])).toThrow(
      "File must use one of these extensions: .docx",
    );
  });

  it("includes all allowed extensions in the error message", () => {
    expect(() => assertValidFileExtension("report.txt", [".docx", ".drawio"])).toThrow(
      "File must use one of these extensions: .docx, .drawio",
    );
  });

  it("throws for an empty file name", () => {
    expect(() => assertValidFileExtension("", [".docx"])).toThrow();
  });

  it("throws when allowedExtensions is empty (nothing can match)", () => {
    expect(() => assertValidFileExtension("report.docx", [])).toThrow(
      "File must use one of these extensions: ",
    );
  });
});
