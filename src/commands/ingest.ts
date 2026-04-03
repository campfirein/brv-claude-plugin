import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Command } from "commander";
import { BrvBridge } from "@byterover/brv-bridge";
import { parseCcMemoryFile } from "../cc-frontmatter.js";
import { getCcMemoryDir, isCcMemoryPath } from "../memory-path.js";
import { PostToolUseHookInputSchema } from "../schemas/cc-hook-input.js";
import { readStdinJson } from "../stdin.js";

// Files in the memory dir that we should never ingest
const SKIP_FILES = new Set(["MEMORY.md", "_brv_context.md"]);

interface IngestOpts {
  json?: boolean;
}

export function registerIngestCommand(program: Command): void {
  program
    .command("ingest")
    .description(
      "Ingest a Claude Code memory file into ByteRover context tree (called by PostToolUse hook)",
    )
    .option("--json", "Output result as JSON")
    .action(async (opts: IngestOpts) => {
      try {
        const input = await readStdinJson(PostToolUseHookInputSchema);

        const toolInput = input.tool_input as Record<string, unknown>;
        const filePath = toolInput.file_path as string | undefined;
        const toolName = input.tool_name;
        const cwd = input.cwd;

        if (!filePath || typeof filePath !== "string") {
          exit(opts, { ingested: false, reason: "no file_path in tool_input" });
          return;
        }

        // Guard: only process files in cc memory directory
        const memoryDir = getCcMemoryDir(cwd);
        if (!isCcMemoryPath(filePath, memoryDir)) {
          exit(opts, { ingested: false, reason: "not a memory path" });
          return;
        }

        // Guard: skip index and our own file
        const fileName = basename(filePath);
        if (SKIP_FILES.has(fileName)) {
          exit(opts, { ingested: false, reason: `skipped ${fileName}` });
          return;
        }

        // Get file content based on tool type
        let content: string;
        if (toolName === "Write") {
          // Write tool: content is in tool_input
          const rawContent = toolInput.content;
          if (typeof rawContent !== "string") {
            exit(opts, { ingested: false, reason: "no content in Write input" });
            return;
          }
          content = rawContent;
        } else if (toolName === "Edit") {
          // Edit tool: only has old_string/new_string — read from disk
          try {
            content = readFileSync(filePath, "utf-8");
          } catch {
            exit(opts, {
              ingested: false,
              reason: `cannot read file after Edit: ${filePath}`,
            });
            return;
          }
        } else {
          exit(opts, { ingested: false, reason: `unexpected tool: ${toolName}` });
          return;
        }

        // Parse cc-ts frontmatter
        const parsed = parseCcMemoryFile(content);
        if (!parsed) {
          exit(opts, {
            ingested: false,
            reason: "invalid cc-ts memory frontmatter",
          });
          return;
        }

        const { frontmatter, body } = parsed;

        // Pass content to brv curate without path constraints.
        // Let ByteRover's agent decide the best domain/topic structure.
        const curateContext = body.trim();

        // Fire-and-forget curate
        const bridge = new BrvBridge({ cwd, persistTimeoutMs: 15_000 });
        await bridge.persist(curateContext);

        exit(opts, {
          ingested: true,
          name: frontmatter.name,
          type: frontmatter.type,
        });
      } catch (err) {
        // All errors → stderr + exit 0. Never exit 2 (would block Claude).
        process.stderr.write(
          `brv-claude-plugin ingest error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(0);
      }
    });
}

function exit(opts: IngestOpts, result: Record<string, unknown>): void {
  if (opts.json) {
    console.log(JSON.stringify(result));
  }
  process.exit(0);
}
