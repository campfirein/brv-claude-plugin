import { describe, it, expect } from "vitest";
import {
  buildRecallOutput,
  type RecallHookOutput,
} from "../src/build-recall-output.js";

const NOW = new Date("2026-05-04T12:00:00Z");
const FIXED_AGE = new Date("2026-05-01T12:00:00Z"); // 3d ago

const stubAge = (_cwd: string, _path: string) => FIXED_AGE;

function assertDefined<T>(
  value: T | undefined,
  message = "expected defined value",
): asserts value is T {
  if (value === undefined) throw new Error(message);
}

describe("buildRecallOutput", () => {
  it("emits both systemMessage and additionalContext when matchedDocs is populated", () => {
    const out = buildRecallOutput({
      content: "synthesized prose with **Sources**:\n- `auth/jwt.md`",
      matchedDocs: [
        { path: "auth/jwt.md" },
        { path: "billing/stripe.md" },
        { path: "design/cache.md" },
      ],
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBe(
      "🧠 ByteRover returns 3 memories: auth/jwt.md (3d ago), billing/stripe.md (3d ago), design/cache.md (3d ago)",
    );
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "<byterover-context>",
    );
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "synthesized prose",
    );
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "</byterover-context>",
    );
  });

  it("falls back to parsing **Sources** when matchedDocs is empty but the cached content carries a Sources block (cache hit recovery)", () => {
    const out = buildRecallOutput({
      content: `**Summary**: cached answer.

**Sources**:
- \`.brv/context-tree/auth/jwt.md\`
- \`.brv/context-tree/billing/stripe.md\`

**Gaps**: none`,
      // Tier 0/1 cache hit: QueryExecutor returns empty matchedDocs but the cached
      // response prose still has the original **Sources**: block.
      matchedDocs: [],
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBe(
      "🧠 ByteRover returns 2 memories: auth/jwt.md (3d ago), billing/stripe.md (3d ago)",
    );
    expect(out.hookSpecificOutput.additionalContext).toContain("cached answer");
  });

  it("emits additionalContext but no systemMessage when matchedDocs is empty and content has no Sources block", () => {
    const out = buildRecallOutput({
      content: "synthesised answer with no Sources block at all",
      matchedDocs: [],
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBeUndefined();
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "synthesised answer",
    );
  });

  it("falls back to parsing **Sources** from content when matchedDocs is undefined (older CLI)", () => {
    const out = buildRecallOutput({
      content: `**Summary**: stuff.

**Sources**:
- \`.brv/context-tree/auth/jwt.md\`
- \`.brv/context-tree/billing/stripe.md\`

**Gaps**: none`,
      matchedDocs: undefined,
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBe(
      "🧠 ByteRover returns 2 memories: auth/jwt.md (3d ago), billing/stripe.md (3d ago)",
    );
  });

  it("emits only additionalContext when matchedDocs is undefined and content has no Sources block", () => {
    const out = buildRecallOutput({
      content: "plain prose with no sources block",
      matchedDocs: undefined,
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBeUndefined();
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "plain prose with no sources block",
    );
  });

  it("returns undefined when content is empty (caller should exit 0)", () => {
    const out: RecallHookOutput | undefined = buildRecallOutput({
      content: "",
      matchedDocs: [],
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });
    expect(out).toBeUndefined();
  });

  it("caps systemMessage at 3 paths even when matchedDocs has more", () => {
    const out = buildRecallOutput({
      content: "synthesized prose",
      matchedDocs: [
        { path: "a.md" },
        { path: "b.md" },
        { path: "c.md" },
        { path: "d.md" },
        { path: "e.md" },
      ],
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBe(
      "🧠 ByteRover returns 3 memories: a.md (3d ago), b.md (3d ago), c.md (3d ago)",
    );
  });

  it("renders summary without age suffixes when age resolver returns undefined for all paths", () => {
    const out = buildRecallOutput({
      content: "prose",
      matchedDocs: [{ path: "missing.md" }],
      cwd: "/proj",
      getAge: () => undefined,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBe("🧠 ByteRover returns 1 memory: missing.md");
  });

  // Per-entry score filtering: drop matches below threshold; suppress summary if nothing qualifies.
  it("drops individual matches below the score threshold and renders only qualifying ones", () => {
    const out = buildRecallOutput({
      content: "mixed-quality matches",
      matchedDocs: [
        { path: "strong.md", score: 0.92 },
        { path: "weak.md", score: 0.31 },
        { path: "okay.md", score: 0.55 },
      ],
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBe(
      "🧠 ByteRover returns 2 memories:\n" +
        "  1. strong.md  0.92 (3d ago)\n" +
        "  2. okay.md    0.55 (3d ago)",
    );
  });

  it("suppresses systemMessage when every match falls below the threshold", () => {
    const out = buildRecallOutput({
      content: "all weak matches",
      matchedDocs: [
        { path: "a.md", score: 0.2 },
        { path: "b.md", score: 0.3 },
        { path: "c.md", score: 0.4 },
      ],
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBeUndefined();
    expect(out.hookSpecificOutput.additionalContext).toContain("all weak matches");
  });

  it("suppresses systemMessage when the single match falls below the threshold", () => {
    const out = buildRecallOutput({
      content: "one weak match",
      matchedDocs: [{ path: "weak.md", score: 0.42 }],
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBeUndefined();
    expect(out.hookSpecificOutput.additionalContext).toContain("one weak match");
  });

  it("renders single match exactly at the threshold (≥0.5 inclusive)", () => {
    const out = buildRecallOutput({
      content: "boundary match",
      matchedDocs: [{ path: "edge.md", score: 0.5 }],
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBe(
      "🧠 ByteRover returns 1 memory:\n" +
        "  1. edge.md  0.50 (3d ago)",
    );
  });

  it("does not filter when matchedDocs entries have no score (graceful — older bridge)", () => {
    const out = buildRecallOutput({
      content: "no scores available",
      matchedDocs: [{ path: "a.md" }, { path: "b.md" }],
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.systemMessage).toBe(
      "🧠 ByteRover returns 2 memories: a.md (3d ago), b.md (3d ago)",
    );
  });

  it("preserves the existing additionalContext wrapper format", () => {
    const out = buildRecallOutput({
      content: "rich content here",
      matchedDocs: [{ path: "a.md" }],
      cwd: "/proj",
      getAge: stubAge,
      now: NOW,
    });

    assertDefined(out);
    expect(out.hookSpecificOutput.additionalContext).toBe(
      "<byterover-context>\nThe following knowledge is from ByteRover context engine:\n\nrich content here\n</byterover-context>",
    );
  });
});
