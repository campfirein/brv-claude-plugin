import {
  buildVisibleSummary,
  type VisibleSummaryEntry,
} from "./build-visible-summary.js";
import { parseSourcesFromContent } from "./parse-sources.js";
import { resolveContextTreeAge } from "./resolve-context-tree-age.js";

/** Resolve a path's age. Injectable so unit tests can avoid touching the filesystem. */
export type AgeResolver = (cwd: string, relativePath: string) => Date | undefined;

export interface BuildRecallOutputArgs {
  /** Synthesized prose returned by `brv query`. */
  content: string;
  /**
   * Structured matches surfaced by newer brv CLIs. When undefined we fall back to
   * regex-parsing the `**Sources**:` block in `content` for graceful degradation against
   * older brv CLIs that do not emit this field.
   */
  matchedDocs?: ReadonlyArray<{ path: string; score?: number }>;
  /** Project root used to resolve frontmatter timestamps and mtime fallbacks. */
  cwd: string;
  /** Override the age resolver (test seam). Defaults to filesystem-backed resolver. */
  getAge?: AgeResolver;
  /** Override the reference clock (test seam). */
  now?: Date;
}

export interface RecallHookOutput {
  /**
   * Visible single-line summary rendered by Claude Code beneath the prompt.
   * Omitted when there are no recall paths to surface (cache hits with empty matchedDocs,
   * older CLIs that returned content without a Sources block).
   */
  systemMessage?: string;
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit";
    additionalContext: string;
  };
}

const MAX_VISIBLE_PATHS = 3;
/** Drop individual matches whose score is below this threshold; if nothing qualifies, suppress the visible summary entirely. */
const MIN_QUALIFYING_SCORE = 0.5;

/**
 * Assemble the dual-channel UserPromptSubmit hook output (visible systemMessage + invisible
 * additionalContext) from a recall result. Returns undefined when there is nothing to emit
 * (no synthesized content), letting the caller exit silently without writing JSON to stdout.
 */
export function buildRecallOutput(
  args: BuildRecallOutputArgs,
): RecallHookOutput | undefined {
  if (!args.content) return undefined;

  const matches = qualifyingPaths(args.matchedDocs, args.content).slice(
    0,
    MAX_VISIBLE_PATHS,
  );
  const summary = matches.length > 0 ? renderSummary(matches, args) : "";

  return {
    ...(summary ? { systemMessage: summary } : {}),
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        `<byterover-context>\n` +
        `The following knowledge is from ByteRover context engine:\n\n` +
        `${args.content}\n` +
        `</byterover-context>`,
    },
  };
}

function qualifyingPaths(
  matchedDocs: ReadonlyArray<{ path: string; score?: number }> | undefined,
  content: string,
): Array<{ path: string; score?: number }> {
  // Newer CLI with structured matches: matchedDocs is the source of truth. Drop entries
  // whose score falls below the qualifying threshold.
  //
  // Empty matchedDocs has two meanings depending on CLI behaviour:
  //   1. Cache hits (Tier 0/1) — QueryExecutor intentionally returns [] because the cache
  //      stores only the response string, not match metadata. The synthesised content still
  //      carries a `**Sources**:` block listing the docs that informed the cached answer.
  //   2. True "no matches found" — no Sources block in content, parse returns [].
  // In both cases we fall through to the Sources-block parser: case 1 recovers the paths,
  // case 2 returns [] and the caller suppresses systemMessage.
  if (matchedDocs !== undefined && matchedDocs.length > 0) {
    return matchedDocs
      .filter((d) => d.score === undefined || d.score >= MIN_QUALIFYING_SCORE)
      .map((d) => ({ path: d.path, score: d.score }));
  }
  // Fallback path used by older CLIs (no matchedDocs at all) AND by cache hits (empty
  // matchedDocs but `**Sources**:` block present in content). Per-entry score is not
  // recoverable here, so paths flow through without per-entry filtering — acceptable
  // because the cached/synthesised response was already deemed answer-worthy upstream.
  return parseSourcesFromContent(content).map((path) => ({ path }));
}

function renderSummary(
  matches: Array<{ path: string; score?: number }>,
  args: BuildRecallOutputArgs,
): string {
  const resolve = args.getAge ?? resolveContextTreeAge;
  const entries: VisibleSummaryEntry[] = matches.map(({ path, score }) => {
    const age = resolve(args.cwd, path);
    const base: VisibleSummaryEntry = age ? { path, age } : { path };
    return typeof score === "number" ? { ...base, score } : base;
  });
  const summaryOptions = args.now ? { now: args.now } : {};
  return buildVisibleSummary(entries, summaryOptions);
}
