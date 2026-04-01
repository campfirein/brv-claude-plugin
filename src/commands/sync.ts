import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import { brvQuery } from "../brv-process.js";
import { getCcMemoryDir } from "../memory-path.js";
import { StopHookInputSchema } from "../schemas/cc-hook-input.js";
import { readStdinJson } from "../stdin.js";

const BRV_CONTEXT_FILE = "_brv_context.md";
const MEMORY_INDEX = "MEMORY.md";
const POINTER_LINE =
  "- [ByteRover context](_brv_context.md) \u2014 cross-references from project knowledge base";

interface SyncOpts {
  json?: boolean;
  memoryDir?: string;
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

        // Query ByteRover for ranked knowledge
        let queryResult: string | undefined;
        try {
          const response = await brvQuery({
            cwd,
            query:
              "List the most important knowledge entries from _cc/ domain, ranked by importance. Return a concise summary.",
            timeoutMs: 8_000,
          });
          queryResult =
            response.data?.result ?? response.data?.content ?? undefined;
          if (queryResult && !queryResult.trim()) {
            queryResult = undefined;
          }
        } catch {
          // brv query failed or timed out — fall through to stub
        }

        // Ensure memory dir exists
        mkdirSync(memoryDir, { recursive: true });

        const now = new Date().toISOString();
        const contextPath = join(memoryDir, BRV_CONTEXT_FILE);

        if (queryResult) {
          // Success: write full context file
          const content = [
            "---",
            "name: byterover context",
            "description: cross-references from ByteRover knowledge base",
            "type: reference",
            "---",
            `Last synced: ${now}`,
            "",
            queryResult.trim(),
            "",
          ].join("\n");
          writeFileSync(contextPath, content, "utf-8");
        } else {
          // Failure: write stub so pointer doesn't reference stale content
          const content = [
            "---",
            "name: byterover context",
            "description: cross-references from ByteRover knowledge base (sync pending)",
            "type: reference",
            "---",
            `Last sync attempt: ${now}`,
            "Status: no results available \u2014 ByteRover context tree may be empty or query timed out.",
            "",
          ].join("\n");
          writeFileSync(contextPath, content, "utf-8");
        }

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
              hasContent: !!queryResult,
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
