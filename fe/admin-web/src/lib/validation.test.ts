import { describe, expect, it } from "vitest";
import {
  aiCriterionScoreSchema,
  assertValidFileExtension,
  assertValidFileSize,
  criterionDeductionSchema,
  criterionEvidenceSchema,
  extractionArtifactSchema,
  finalCriterionScoreSchema,
  rubricCriterionSchema,
  rubricTemplateSchema,
  sanitizeSpreadsheetCell,
  submissionMetadataSchema,
  validateAiScoreWithinCriterion,
} from "./validation";

const VALID_UUID = "00000000-0000-4000-8000-000000000000";
const VALID_UUID_2 = "11111111-1111-4111-8111-111111111111";

describe("rubricCriterionSchema", () => {
  const valid = {
    criterionCode: "C1",
    title: "Correctness",
    description: "Solution is correct",
    maxScore: 10,
  };

  it("accepts a minimal valid criterion and fills in defaults", () => {
    const result = rubricCriterionSchema.parse(valid);
    expect(result).toMatchObject({
      criterionCode: "C1",
      title: "Correctness",
      description: "Solution is correct",
      maxScore: 10,
      gradingGuidance: "",
      deductionNotes: "",
      displayOrder: 0,
    });
  });

  it("accepts an optional id when it is a valid uuid", () => {
    const result = rubricCriterionSchema.parse({ ...valid, id: VALID_UUID });
    expect(result.id).toBe(VALID_UUID);
  });

  it("rejects an invalid uuid for id", () => {
    expect(() => rubricCriterionSchema.parse({ ...valid, id: "not-a-uuid" })).toThrow();
  });

  it("rejects empty/whitespace-only required strings", () => {
    expect(() => rubricCriterionSchema.parse({ ...valid, criterionCode: "" })).toThrow();
    expect(() => rubricCriterionSchema.parse({ ...valid, title: "   " })).toThrow();
    expect(() => rubricCriterionSchema.parse({ ...valid, description: "" })).toThrow();
  });

  it("trims whitespace on required strings", () => {
    const result = rubricCriterionSchema.parse({ ...valid, title: "  Correctness  " });
    expect(result.title).toBe("Correctness");
  });

  it("rejects a negative maxScore", () => {
    expect(() => rubricCriterionSchema.parse({ ...valid, maxScore: -1 })).toThrow();
  });

  it("accepts a zero maxScore (boundary)", () => {
    expect(() => rubricCriterionSchema.parse({ ...valid, maxScore: 0 })).not.toThrow();
  });

  it("rejects a non-finite maxScore", () => {
    expect(() => rubricCriterionSchema.parse({ ...valid, maxScore: Infinity })).toThrow();
  });

  it("rejects a negative or non-integer displayOrder", () => {
    expect(() => rubricCriterionSchema.parse({ ...valid, displayOrder: -1 })).toThrow();
    expect(() => rubricCriterionSchema.parse({ ...valid, displayOrder: 1.5 })).toThrow();
  });
});

describe("rubricTemplateSchema", () => {
  const validCriterion = {
    criterionCode: "C1",
    title: "Correctness",
    description: "Solution is correct",
    maxScore: 10,
  };

  const valid = {
    subjectId: VALID_UUID,
    originalFilename: "rubric.docx",
    filePath: "/rubrics/rubric.docx",
    criteria: [validCriterion],
  };

  it("accepts a minimal valid template and defaults version to 1", () => {
    const result = rubricTemplateSchema.parse(valid);
    expect(result.version).toBe(1);
    expect(result.criteria).toHaveLength(1);
  });

  it("rejects an empty criteria array", () => {
    expect(() => rubricTemplateSchema.parse({ ...valid, criteria: [] })).toThrow();
  });

  it("rejects a non-uuid subjectId", () => {
    expect(() => rubricTemplateSchema.parse({ ...valid, subjectId: "nope" })).toThrow();
  });

  it("allows assignmentId to be null, omitted, or a uuid", () => {
    expect(rubricTemplateSchema.parse({ ...valid, assignmentId: null }).assignmentId).toBeNull();
    expect(rubricTemplateSchema.parse(valid).assignmentId).toBeUndefined();
    expect(rubricTemplateSchema.parse({ ...valid, assignmentId: VALID_UUID_2 }).assignmentId).toBe(VALID_UUID_2);
  });

  it("rejects a non-positive version", () => {
    expect(() => rubricTemplateSchema.parse({ ...valid, version: 0 })).toThrow();
    expect(() => rubricTemplateSchema.parse({ ...valid, version: -1 })).toThrow();
  });

  it("rejects a non-integer version", () => {
    expect(() => rubricTemplateSchema.parse({ ...valid, version: 1.5 })).toThrow();
  });
});

describe("submissionMetadataSchema", () => {
  const valid = {
    assignmentId: VALID_UUID,
    studentId: VALID_UUID_2,
    reportOriginalFilename: "report.docx",
    diagramOriginalFilename: "diagram.drawio",
  };

  it("accepts a minimal valid submission and defaults state to uploaded", () => {
    const result = submissionMetadataSchema.parse(valid);
    expect(result.state).toBe("uploaded");
  });

  it("accepts any known grading state", () => {
    for (const state of ["uploaded", "extracting", "extracted", "grading", "graded", "reviewed", "published", "failed"]) {
      expect(submissionMetadataSchema.parse({ ...valid, state }).state).toBe(state);
    }
  });

  it("rejects an unknown state", () => {
    expect(() => submissionMetadataSchema.parse({ ...valid, state: "bogus" })).toThrow();
  });

  it("rejects a non-uuid assignmentId or studentId", () => {
    expect(() => submissionMetadataSchema.parse({ ...valid, assignmentId: "nope" })).toThrow();
    expect(() => submissionMetadataSchema.parse({ ...valid, studentId: "nope" })).toThrow();
  });

  it("allows rubricId to be omitted or null", () => {
    expect(submissionMetadataSchema.parse(valid).rubricId).toBeUndefined();
    expect(submissionMetadataSchema.parse({ ...valid, rubricId: null }).rubricId).toBeNull();
  });

  it("rejects empty filename fields", () => {
    expect(() => submissionMetadataSchema.parse({ ...valid, reportOriginalFilename: "" })).toThrow();
    expect(() => submissionMetadataSchema.parse({ ...valid, diagramOriginalFilename: "" })).toThrow();
  });
});

describe("extractionArtifactSchema", () => {
  const valid = {
    submissionId: VALID_UUID,
    artifactType: "document" as const,
  };

  it("accepts a minimal valid artifact and defaults content/warnings", () => {
    const result = extractionArtifactSchema.parse(valid);
    expect(result.content).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it("accepts each known artifact type", () => {
    for (const artifactType of ["rubric", "document", "diagram"]) {
      expect(extractionArtifactSchema.parse({ ...valid, artifactType }).artifactType).toBe(artifactType);
    }
  });

  it("rejects an unknown artifact type", () => {
    expect(() => extractionArtifactSchema.parse({ ...valid, artifactType: "spreadsheet" })).toThrow();
  });

  it("rejects a non-uuid submissionId", () => {
    expect(() => extractionArtifactSchema.parse({ ...valid, submissionId: "nope" })).toThrow();
  });

  it("accepts arbitrary content object and warnings array", () => {
    const result = extractionArtifactSchema.parse({
      ...valid,
      content: { foo: "bar", nested: { a: 1 } },
      warnings: ["w1", "w2"],
    });
    expect(result.content).toEqual({ foo: "bar", nested: { a: 1 } });
    expect(result.warnings).toEqual(["w1", "w2"]);
  });
});

describe("criterionDeductionSchema", () => {
  it("accepts a valid deduction", () => {
    const result = criterionDeductionSchema.parse({ reason: "Missing section", points: 2 });
    expect(result).toEqual({ reason: "Missing section", points: 2 });
  });

  it("rejects an empty reason", () => {
    expect(() => criterionDeductionSchema.parse({ reason: "", points: 1 })).toThrow();
  });

  it("rejects negative points", () => {
    expect(() => criterionDeductionSchema.parse({ reason: "x", points: -1 })).toThrow();
  });

  it("accepts zero points (boundary)", () => {
    expect(() => criterionDeductionSchema.parse({ reason: "x", points: 0 })).not.toThrow();
  });
});

describe("criterionEvidenceSchema", () => {
  it("accepts a valid evidence entry with optional quote omitted", () => {
    const result = criterionEvidenceSchema.parse({ source: "document", reference: "page 3" });
    expect(result.quote).toBeUndefined();
  });

  it("accepts each known source", () => {
    for (const source of ["document", "diagram", "rubric", "missing"]) {
      expect(criterionEvidenceSchema.parse({ source, reference: "x" }).source).toBe(source);
    }
  });

  it("rejects an unknown source", () => {
    expect(() => criterionEvidenceSchema.parse({ source: "email", reference: "x" })).toThrow();
  });

  it("rejects an empty reference", () => {
    expect(() => criterionEvidenceSchema.parse({ source: "document", reference: "" })).toThrow();
  });

  it("accepts an optional quote", () => {
    const result = criterionEvidenceSchema.parse({ source: "document", reference: "x", quote: "some text" });
    expect(result.quote).toBe("some text");
  });
});

describe("aiCriterionScoreSchema", () => {
  const valid = {
    criterionId: VALID_UUID,
    maxScore: 10,
    suggestedScore: 8,
  };

  it("accepts a minimal valid score and applies defaults", () => {
    const result = aiCriterionScoreSchema.parse(valid);
    expect(result.deductions).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(result.comment).toBe("");
    expect(result.confidence).toBe("medium");
  });

  it("rejects suggestedScore greater than maxScore", () => {
    expect(() => aiCriterionScoreSchema.parse({ ...valid, suggestedScore: 11 })).toThrow(
      /cannot exceed max score/,
    );
  });

  it("accepts suggestedScore equal to maxScore (boundary)", () => {
    expect(() => aiCriterionScoreSchema.parse({ ...valid, suggestedScore: 10 })).not.toThrow();
  });

  it("rejects a negative suggestedScore or maxScore", () => {
    expect(() => aiCriterionScoreSchema.parse({ ...valid, suggestedScore: -1 })).toThrow();
    expect(() => aiCriterionScoreSchema.parse({ ...valid, maxScore: -1 })).toThrow();
  });

  it("accepts each known confidence level", () => {
    for (const confidence of ["low", "medium", "high"]) {
      expect(aiCriterionScoreSchema.parse({ ...valid, confidence }).confidence).toBe(confidence);
    }
  });

  it("rejects an unknown confidence level", () => {
    expect(() => aiCriterionScoreSchema.parse({ ...valid, confidence: "certain" })).toThrow();
  });

  it("accepts nested deductions and evidence", () => {
    const result = aiCriterionScoreSchema.parse({
      ...valid,
      deductions: [{ reason: "Missing test", points: 1 }],
      evidence: [{ source: "rubric", reference: "R1" }],
    });
    expect(result.deductions).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
  });
});

describe("finalCriterionScoreSchema", () => {
  const valid = {
    criterionId: VALID_UUID,
    finalScore: 8,
    maxScore: 10,
  };

  it("accepts a minimal valid score and applies defaults", () => {
    const result = finalCriterionScoreSchema.parse(valid);
    expect(result.finalComment).toBe("");
    expect(result.aiCriterionScoreId).toBeUndefined();
  });

  it("rejects finalScore greater than maxScore", () => {
    expect(() => finalCriterionScoreSchema.parse({ ...valid, finalScore: 11 })).toThrow(
      /cannot exceed max score/,
    );
  });

  it("accepts finalScore equal to maxScore (boundary)", () => {
    expect(() => finalCriterionScoreSchema.parse({ ...valid, finalScore: 10 })).not.toThrow();
  });

  it("allows aiCriterionScoreId to be null, omitted, or a uuid", () => {
    expect(finalCriterionScoreSchema.parse({ ...valid, aiCriterionScoreId: null }).aiCriterionScoreId).toBeNull();
    expect(
      finalCriterionScoreSchema.parse({ ...valid, aiCriterionScoreId: VALID_UUID_2 }).aiCriterionScoreId,
    ).toBe(VALID_UUID_2);
  });

  it("rejects a negative finalScore", () => {
    expect(() => finalCriterionScoreSchema.parse({ ...valid, finalScore: -1 })).toThrow();
  });
});

describe("assertValidFileExtension", () => {
  it("does not throw when the filename matches an allowed extension", () => {
    expect(() => assertValidFileExtension("report.docx", [".docx"])).not.toThrow();
  });

  it("is case-insensitive", () => {
    expect(() => assertValidFileExtension("REPORT.DOCX", [".docx"])).not.toThrow();
  });

  it("throws when the extension does not match", () => {
    expect(() => assertValidFileExtension("report.pdf", [".docx"])).toThrow(
      /File must use one of these extensions: \.docx/,
    );
  });

  it("accepts any of multiple allowed extensions", () => {
    expect(() => assertValidFileExtension("diagram.drawio", [".docx", ".drawio"])).not.toThrow();
  });

  it("throws for a filename with no extension", () => {
    expect(() => assertValidFileExtension("report", [".docx"])).toThrow();
  });
});

describe("assertValidFileSize", () => {
  const oneMb = 1024 * 1024;

  it("does not throw when the size is below the max", () => {
    expect(() => assertValidFileSize(oneMb, 5 * oneMb)).not.toThrow();
  });

  it("does not throw when the size exactly equals the max (boundary)", () => {
    expect(() => assertValidFileSize(5 * oneMb, 5 * oneMb)).not.toThrow();
  });

  it("throws when the size exceeds the max by one byte (boundary)", () => {
    expect(() => assertValidFileSize(5 * oneMb + 1, 5 * oneMb)).toThrow(/File is too large \(max 5 MB\)/);
  });

  it("throws with a floored MB figure in the message", () => {
    expect(() => assertValidFileSize(10 * oneMb, oneMb + 500)).toThrow(/max 1 MB/);
  });
});

describe("sanitizeSpreadsheetCell", () => {
  it.each(["=SUM(A1)", "+1+1", "-1", "@cmd", "\ttab", "\rcr"])(
    "prefixes a leading quote for formula-trigger value %j",
    (value) => {
      expect(sanitizeSpreadsheetCell(value)).toBe(`'${value}`);
    },
  );

  it("leaves normal text untouched", () => {
    expect(sanitizeSpreadsheetCell("hello world")).toBe("hello world");
  });

  it("leaves an empty string untouched", () => {
    expect(sanitizeSpreadsheetCell("")).toBe("");
  });

  it("only inspects the first character", () => {
    expect(sanitizeSpreadsheetCell("a=b")).toBe("a=b");
  });
});

describe("validateAiScoreWithinCriterion", () => {
  it("returns the parsed score when suggestedScore is within maxScore", () => {
    const result = validateAiScoreWithinCriterion(5, 10);
    expect(result.suggestedScore).toBe(5);
    expect(result.maxScore).toBe(10);
  });

  it("accepts suggestedScore equal to maxScore (boundary)", () => {
    expect(() => validateAiScoreWithinCriterion(10, 10)).not.toThrow();
  });

  it("throws when suggestedScore exceeds maxScore", () => {
    expect(() => validateAiScoreWithinCriterion(11, 10)).toThrow(/cannot exceed max score/);
  });

  it("throws when suggestedScore is negative", () => {
    expect(() => validateAiScoreWithinCriterion(-1, 10)).toThrow();
  });

  it("accepts a zero suggestedScore (boundary)", () => {
    expect(() => validateAiScoreWithinCriterion(0, 10)).not.toThrow();
  });
});
