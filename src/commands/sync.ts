import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { getCcMemoryDir } from "../memory-path.js";
import { StopHookInputSchema } from "../schemas/cc-hook-input.js";
import { readStdinJson } from "../stdin.js";

const BRV_CONTEXT_FILE = "_brv_context.md";
const CONTEXT_TREE_INDEX = ".brv/context-tree/_index.md";
const MEMORY_INDEX = "MEMORY.md";
const POINTER_LINE =
  "- [ByteRover context](_brv_context.md) \u2014 cross-references from project knowledge base";

function buildContextTreeGuide(cwd: string): string {
  const treePath = join(cwd, ".brv/context-tree");
  return [
    "<Note>",
    `The full ByteRover context tree is located at \`${treePath}/\`.`,
    "All paths referenced below are relative to this directory.",
    "When you need deeper context on any topic, read the relevant files there.",
    "Each domain contains topics with detailed narratives, facts, and code references that go beyond this summary.",
    "</Note>",
  ].join("\n");
}

interface SyncOpts {
  json?: boolean;
  memoryDir?: string;
}

/**
 * Strip YAML frontmatter (--- ... ---) from the beginning of a markdown string.
 * Returns the body content after the closing --- delimiter.
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  if (match) {
    return content.slice(match[0].length);
  }
  return content;
}

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description(
      "Regenerate _brv_context.md with cross-references from ByteRover context tree (called by Stop hook)",
    )
    .option("--json", "Output result as JSON")
    .option(
      "--memory-dir <path>",
      "Override path to Claude Code memory directory",
    )
    .action(async (opts: SyncOpts) => {
      try {
        const input = await readStdinJson(StopHookInputSchema);
        const cwd = input.cwd;
        const memoryDir = opts.memoryDir ?? getCcMemoryDir(cwd);

        // Read the context tree root _index.md directly from disk
        const indexPath = join(cwd, CONTEXT_TREE_INDEX);
        let indexBody: string | undefined;
        if (existsSync(indexPath)) {
          try {
            const raw = readFileSync(indexPath, "utf-8");
            const body = stripFrontmatter(raw).trim();
            if (body) {
              indexBody = body;
            }
          } catch {
            // Read failed — fall through to stub
          }
        }

        // Ensure memory dir exists
        mkdirSync(memoryDir, { recursive: true });

        const now = new Date().toISOString();
        const contextPath = join(memoryDir, BRV_CONTEXT_FILE);

        if (indexBody) {
          // Success: write guide first, then context tree index body
          const content = [
            "---",
            "name: byterover context",
            "description: cross-references from ByteRover knowledge base",
            "type: reference",
            "---",
            `Last synced: ${now}`,
            "",
            buildContextTreeGuide(cwd),
            "",
            indexBody,
            "",
          ].join("\n");
          writeFileSync(contextPath, content, "utf-8");
        } else if (!existsSync(contextPath)) {
          // No context tree and no existing file — write stub for first run
          const content = [
            "---",
            "name: byterover context",
            "description: cross-references from ByteRover knowledge base (sync pending)",
            "type: reference",
            "---",
            `Last sync attempt: ${now}`,
            "Status: no context tree index available \u2014 .brv/context-tree/_index.md not found or empty.",
            "",
          ].join("\n");
          writeFileSync(contextPath, content, "utf-8");
        }
        // Otherwise: _index.md unavailable but _brv_context.md exists — keep existing content

        // Add pointer to MEMORY.md if not already present (idempotent)
        const memoryPath = join(memoryDir, MEMORY_INDEX);
        let memoryContent = "";
        if (existsSync(memoryPath)) {
          memoryContent = readFileSync(memoryPath, "utf-8");
        }

        if (!memoryContent.includes(BRV_CONTEXT_FILE)) {
          const separator = memoryContent.endsWith("\n") || !memoryContent
            ? ""
            : "\n";
          writeFileSync(
            memoryPath,
            memoryContent + separator + POINTER_LINE + "\n",
            "utf-8",
          );
        }

        if (opts.json) {
          console.log(
            JSON.stringify({
              synced: true,
              hasContent: !!indexBody,
              contextPath,
            }),
          );
        }

        process.exit(0);
      } catch (err) {
        // Best-effort — never block Claude
        process.stderr.write(
          `brv-claude-bridge sync error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(0);
      }
    });
}
