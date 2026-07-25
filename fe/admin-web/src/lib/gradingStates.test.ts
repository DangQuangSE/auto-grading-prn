import { describe, expect, it } from "vitest";
import type { GradingState } from "./database.types";
import { GRADING_STATES, GRADING_STATE_LABELS, canRetry, isStudentVisibleState } from "./gradingStates";

describe("GRADING_STATE_LABELS", () => {
  it("has a label for every grading state", () => {
    for (const state of GRADING_STATES) {
      expect(GRADING_STATE_LABELS[state]).toEqual(expect.any(String));
      expect(GRADING_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });

  it("has exactly one label per state (no extras)", () => {
    expect(Object.keys(GRADING_STATE_LABELS).sort()).toEqual([...GRADING_STATES].sort());
  });

  it("matches the expected human-readable copy", () => {
    expect(GRADING_STATE_LABELS).toEqual({
      uploaded: "Uploaded",
      extracting: "Extracting",
      extracted: "Extracted",
      grading: "Grading",
      graded: "AI graded",
      reviewed: "Reviewed",
      published: "Published",
      failed: "Failed",
    });
  });
});

describe("canRetry", () => {
  const expected: Record<GradingState, boolean> = {
    uploaded: true,
    extracting: false,
    extracted: true,
    grading: false,
    graded: true,
    reviewed: false,
    published: false,
    failed: true,
  };

  it.each(GRADING_STATES)("returns %s for state %s", (state) => {
    expect(canRetry(state)).toBe(expected[state]);
  });

  it("returns false for an unknown state", () => {
    expect(canRetry("unknown" as GradingState)).toBe(false);
  });
});

describe("isStudentVisibleState", () => {
  it.each(GRADING_STATES)("is only true for published (checking %s)", (state) => {
    expect(isStudentVisibleState(state)).toBe(state === "published");
  });

  it("returns false for an unknown state", () => {
    expect(isStudentVisibleState("unknown" as GradingState)).toBe(false);
  });
});
