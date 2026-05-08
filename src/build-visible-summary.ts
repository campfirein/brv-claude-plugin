/**
 * Format the visible "ByteRover returns N memories: …" line that the
 * UserPromptSubmit hook emits via `systemMessage`. Pure function so it can
 * be unit-tested without filesystem or clock dependencies — the caller is
 * responsible for resolving each entry's age before calling.
 */

export interface VisibleSummaryEntry {
  /** Path as it should be rendered. Caller is responsible for stripping the .brv/context-tree/ prefix. */
  path: string;
  /** Last-modified (or originally-curated) date; omit when no signal is available. */
  age?: Date;
  /** Per-result relevance score from `brv query --format json`'s `matchedDocs[].score` (0..1). Omit when unavailable. */
  score?: number;
}

export interface BuildVisibleSummaryOptions {
  /** Override the reference clock for deterministic age computation in tests. */
  now?: Date;
}

const MAX_ENTRIES = 3;
const MS_PER_DAY = 86_400_000;

export function buildVisibleSummary(
  entries: readonly VisibleSummaryEntry[],
  options?: BuildVisibleSummaryOptions,
): string {
  if (entries.length === 0) return "";

  const shown = entries.slice(0, MAX_ENTRIES);
  const now = options?.now ?? new Date();
  const noun = shown.length === 1 ? "memory" : "memories";

  // When at least one entry has a score, render the multi-line right-aligned column layout.
  // Otherwise (older brv CLI without per-doc scores), fall back to the legacy single-line layout
  // so we don't regress backwards-compatibility.
  const anyScore = shown.some((e) => typeof e.score === "number");
  if (anyScore) {
    const maxPathLen = Math.max(...shown.map((e) => e.path.length));
    const lines = shown.map((entry, i) => renderColumnLine(entry, now, maxPathLen, i + 1));
    return `🧠 ByteRover returns ${shown.length} ${noun}:\n${lines.join("\n")}`;
  }

  const items = shown.map((entry) => renderEntry(entry, now)).join(", ");
  return `🧠 ByteRover returns ${shown.length} ${noun}: ${items}`;
}

function renderEntry(entry: VisibleSummaryEntry, now: Date): string {
  if (!entry.age) return entry.path;

  const elapsedMs = now.getTime() - entry.age.getTime();
  // Defensive: future-dated entries (clock skew, bad frontmatter) get rendered without an age tag
  // rather than something nonsensical like "-5d ago".
  if (elapsedMs < 0) return entry.path;

  return `${entry.path} (${humanizeAge(elapsedMs)})`;
}

function renderColumnLine(
  entry: VisibleSummaryEntry,
  now: Date,
  maxPathLen: number,
  rank: number,
): string {
  const paddedPath = entry.path.padEnd(maxPathLen, " ");
  const scoreCol = typeof entry.score === "number" ? entry.score.toFixed(2) : "    ";
  const ageStr = (() => {
    if (!entry.age) return "";
    const elapsedMs = now.getTime() - entry.age.getTime();
    if (elapsedMs < 0) return "";
    return ` (${humanizeAge(elapsedMs)})`;
  })();
  return `  ${rank}. ${paddedPath}  ${scoreCol}${ageStr}`;
}

function humanizeAge(elapsedMs: number): string {
  const days = Math.floor(elapsedMs / MS_PER_DAY);
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
