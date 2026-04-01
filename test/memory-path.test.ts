import { describe, it, expect } from "vitest";
import { sanitizePath, isCcMemoryPath } from "../src/memory-path.js";

describe("sanitizePath", () => {
  it("replaces non-alphanumeric chars with hyphens", () => {
    expect(sanitizePath("/Users/foo/my-project")).toBe(
      "-Users-foo-my-project",
    );
  });

  it("preserves alphanumeric characters", () => {
    expect(sanitizePath("abc123")).toBe("abc123");
  });

  it("truncates and appends hash for long paths", () => {
    const longPath = "/" + "a".repeat(250);
    const result = sanitizePath(longPath);
    expect(result.length).toBeLessThanOrEqual(210); // 200 + dash + hash
    expect(result).toMatch(/^-a+-\w+$/);
  });

  it("returns same result for paths under 200 chars", () => {
    const path = "/Users/test/short";
    expect(sanitizePath(path).length).toBeLessThanOrEqual(200);
  });
});

describe("isCcMemoryPath", () => {
  it("returns true for paths inside memory dir", () => {
    expect(
      isCcMemoryPath(
        "/Users/x/.claude/projects/-foo/memory/test.md",
        "/Users/x/.claude/projects/-foo/memory/",
      ),
    ).toBe(true);
  });

  it("returns false for paths outside memory dir", () => {
    expect(
      isCcMemoryPath(
        "/Users/x/project/src/file.ts",
        "/Users/x/.claude/projects/-foo/memory/",
      ),
    ).toBe(false);
  });
});
