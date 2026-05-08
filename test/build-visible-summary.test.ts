import { describe, it, expect } from "vitest";
import {
  buildVisibleSummary,
  type VisibleSummaryEntry,
} from "../src/build-visible-summary.js";

const NOW = new Date("2026-05-04T12:00:00Z");

function entry(
  path: string,
  daysAgo: number | undefined,
): VisibleSummaryEntry {
  if (daysAgo === undefined) return { path };
  const age = new Date(NOW.getTime() - daysAgo * 86_400_000);
  return { path, age };
}

describe("buildVisibleSummary", () => {
  it("returns empty string when given no entries", () => {
    expect(buildVisibleSummary([], { now: NOW })).toBe("");
  });

  it("renders one entry with singular memory noun", () => {
    const out = buildVisibleSummary(
      [entry("auth/jwt-tokens.md", 3)],
      { now: NOW },
    );
    expect(out).toBe("🧠 ByteRover returns 1 memory: auth/jwt-tokens.md (3d ago)");
  });

  it("renders three entries with plural memory noun and humanized ages", () => {
    const out = buildVisibleSummary(
      [
        entry("auth/jwt-tokens.md", 3),
        entry("billing/stripe-webhooks.md", 7),
        entry("design/caching.md", 30),
      ],
      { now: NOW },
    );
    expect(out).toBe(
      "🧠 ByteRover returns 3 memories: auth/jwt-tokens.md (3d ago), billing/stripe-webhooks.md (1w ago), design/caching.md (1mo ago)",
    );
  });

  it("caps at three entries and reports 3 in the count to match what is shown", () => {
    const out = buildVisibleSummary(
      [
        entry("a.md", 1),
        entry("b.md", 2),
        entry("c.md", 3),
        entry("d.md", 4),
        entry("e.md", 5),
      ],
      { now: NOW },
    );
    expect(out).toBe(
      "🧠 ByteRover returns 3 memories: a.md (1d ago), b.md (2d ago), c.md (3d ago)",
    );
  });

  it("omits the age suffix when age is undefined", () => {
    const out = buildVisibleSummary(
      [
        entry("auth/jwt-tokens.md", 3),
        { path: "design/caching.md" }, // no age
      ],
      { now: NOW },
    );
    expect(out).toBe(
      "🧠 ByteRover returns 2 memories: auth/jwt-tokens.md (3d ago), design/caching.md",
    );
  });

  it("renders age <1d as 'today'", () => {
    const out = buildVisibleSummary(
      [
        {
          path: "fresh.md",
          age: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
        },
      ],
      { now: NOW },
    );
    expect(out).toBe("🧠 ByteRover returns 1 memory: fresh.md (today)");
  });

  it("renders ages crossing month boundaries", () => {
    const out = buildVisibleSummary(
      [
        entry("yearly.md", 365),
        entry("quarter.md", 95),
        entry("week.md", 14),
      ],
      { now: NOW },
    );
    expect(out).toBe(
      "🧠 ByteRover returns 3 memories: yearly.md (1y ago), quarter.md (3mo ago), week.md (2w ago)",
    );
  });

  it("preserves [alias]:path format for shared cross-project sources", () => {
    const out = buildVisibleSummary(
      [
        { path: "[shared-design]:auth/sso.md", age: new Date(NOW.getTime() - 86_400_000) },
        entry("local/notes.md", 2),
      ],
      { now: NOW },
    );
    expect(out).toBe(
      "🧠 ByteRover returns 2 memories: [shared-design]:auth/sso.md (1d ago), local/notes.md (2d ago)",
    );
  });

  it("treats future-dated ages defensively as undefined", () => {
    const out = buildVisibleSummary(
      [
        {
          path: "clock-skew.md",
          age: new Date(NOW.getTime() + 5 * 86_400_000),
        },
      ],
      { now: NOW },
    );
    expect(out).toBe("🧠 ByteRover returns 1 memory: clock-skew.md");
  });

  // ---------------------------------------------------------------------------
  // Scored multi-line layout — engaged when at least one entry carries a score
  // ---------------------------------------------------------------------------

  it("renders multi-line numbered layout when any entry has a score", () => {
    const out = buildVisibleSummary(
      [
        { ...entry("auth/jwt-tokens.md", 3), score: 0.92 },
        { ...entry("billing/stripe-webhooks.md", 7), score: 0.78 },
        { ...entry("design/caching.md", 30), score: 0.55 },
      ],
      { now: NOW },
    );
    expect(out).toBe(
      "🧠 ByteRover returns 3 memories:\n" +
        "  1. auth/jwt-tokens.md          0.92 (3d ago)\n" +
        "  2. billing/stripe-webhooks.md  0.78 (1w ago)\n" +
        "  3. design/caching.md           0.55 (1mo ago)",
    );
  });

  it("renders single scored entry numbered as 1.", () => {
    const out = buildVisibleSummary(
      [{ ...entry("auth/jwt-tokens.md", 3), score: 0.81 }],
      { now: NOW },
    );
    expect(out).toBe(
      "🧠 ByteRover returns 1 memory:\n" + "  1. auth/jwt-tokens.md  0.81 (3d ago)",
    );
  });

  it("aligns the score column to the longest path within the displayed entries", () => {
    const out = buildVisibleSummary(
      [
        { ...entry("a.md", 1), score: 1.0 },
        { ...entry("a/much/longer/path/here.md", 2), score: 0.5 },
      ],
      { now: NOW },
    );
    // both paths must be padded to the longer one's length so scores form a column
    expect(out).toBe(
      "🧠 ByteRover returns 2 memories:\n" +
        "  1. a.md                        1.00 (1d ago)\n" +
        "  2. a/much/longer/path/here.md  0.50 (2d ago)",
    );
  });

  it("formats scores at fixed two-decimal width including 0.00 and 1.00", () => {
    const out = buildVisibleSummary(
      [
        { ...entry("perfect.md", 0), score: 1.0 },
        { ...entry("zero.md", 0), score: 0.0 },
      ],
      { now: NOW },
    );
    expect(out).toBe(
      "🧠 ByteRover returns 2 memories:\n" +
        "  1. perfect.md  1.00 (today)\n" +
        "  2. zero.md     0.00 (today)",
    );
  });

  it("keeps scoreless entries aligned in the same column when at least one has a score", () => {
    const out = buildVisibleSummary(
      [
        { ...entry("with-score.md", 1), score: 0.83 },
        entry("no-score.md", 2), // no score
      ],
      { now: NOW },
    );
    // scoreless rows render four spaces in the score slot to preserve column alignment
    expect(out).toBe(
      "🧠 ByteRover returns 2 memories:\n" +
        "  1. with-score.md  0.83 (1d ago)\n" +
        "  2. no-score.md         (2d ago)",
    );
  });

  it("omits the age suffix in the scored layout when age is undefined", () => {
    const out = buildVisibleSummary(
      [
        { path: "no-age.md", score: 0.77 },
        { ...entry("with-age.md", 5), score: 0.61 },
      ],
      { now: NOW },
    );
    expect(out).toBe(
      "🧠 ByteRover returns 2 memories:\n" +
        "  1. no-age.md    0.77\n" +
        "  2. with-age.md  0.61 (5d ago)",
    );
  });

  it("falls back to legacy single-line layout when no entry has a score", () => {
    const out = buildVisibleSummary(
      [entry("a.md", 1), entry("b.md", 2)],
      { now: NOW },
    );
    expect(out).toBe(
      "🧠 ByteRover returns 2 memories: a.md (1d ago), b.md (2d ago)",
    );
  });
});
