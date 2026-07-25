import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "./pagination";

describe("pagination constants", () => {
  it("has sane default page/page size values", () => {
    expect(DEFAULT_PAGE).toBe(1);
    expect(DEFAULT_PAGE_SIZE).toBe(5);
    expect(MAX_PAGE_SIZE).toBe(100);
  });

  it("lists page size options in ascending order, all within bounds", () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([5, 10, 20, 50]);
    const sorted = [...PAGE_SIZE_OPTIONS].sort((a, b) => a - b);
    expect(PAGE_SIZE_OPTIONS).toEqual(sorted);
    for (const size of PAGE_SIZE_OPTIONS) {
      expect(size).toBeLessThanOrEqual(MAX_PAGE_SIZE);
      expect(size).toBeGreaterThan(0);
    }
  });

  it("includes the default page size among the options", () => {
    expect(PAGE_SIZE_OPTIONS).toContain(DEFAULT_PAGE_SIZE);
  });
});
