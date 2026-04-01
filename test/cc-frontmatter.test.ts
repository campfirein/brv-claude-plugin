import { describe, it, expect } from "vitest";
import { parseCcMemoryFile, ccTypeToDomain } from "../src/cc-frontmatter.js";

describe("parseCcMemoryFile", () => {
  it("parses valid frontmatter with all fields", () => {
    const content = [
      "---",
      "name: test memory",
      "description: a test description",
      "type: feedback",
      "---",
      "Body content here.",
    ].join("\n");

    const result = parseCcMemoryFile(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe("test memory");
    expect(result!.frontmatter.description).toBe("a test description");
    expect(result!.frontmatter.type).toBe("feedback");
    expect(result!.body).toBe("Body content here.");
  });

  it("handles all four memory types", () => {
    for (const type of ["user", "feedback", "project", "reference"] as const) {
      const content = `---\nname: n\ndescription: d\ntype: ${type}\n---\nbody`;
      const result = parseCcMemoryFile(content);
      expect(result).not.toBeNull();
      expect(result!.frontmatter.type).toBe(type);
    }
  });

  it("returns null for invalid type", () => {
    const content = "---\nname: n\ntype: invalid\n---\nbody";
    expect(parseCcMemoryFile(content)).toBeNull();
  });

  it("returns null for missing frontmatter", () => {
    expect(parseCcMemoryFile("no frontmatter here")).toBeNull();
  });

  it("returns null for missing name field", () => {
    const content = "---\ntype: user\n---\nbody";
    expect(parseCcMemoryFile(content)).toBeNull();
  });

  it("handles values with colons and URLs", () => {
    const content = [
      "---",
      "name: 'webhook: stripe integration'",
      "description: 'see https://stripe.com/docs for details'",
      "type: project",
      "---",
      "Body.",
    ].join("\n");

    const result = parseCcMemoryFile(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe("webhook: stripe integration");
  });

  it("handles trailing whitespace after --- delimiters", () => {
    const content = "---  \nname: n\ntype: user\n---  \nbody";
    const result = parseCcMemoryFile(content);
    expect(result).not.toBeNull();
  });

  it("defaults description to empty string when missing", () => {
    const content = "---\nname: n\ntype: user\n---\nbody";
    const result = parseCcMemoryFile(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.description).toBe("");
  });
});

describe("ccTypeToDomain", () => {
  it("maps types to _cc/ domains", () => {
    expect(ccTypeToDomain("user")).toBe("_cc/user");
    expect(ccTypeToDomain("feedback")).toBe("_cc/feedback");
    expect(ccTypeToDomain("project")).toBe("_cc/project");
    expect(ccTypeToDomain("reference")).toBe("_cc/reference");
  });
});
