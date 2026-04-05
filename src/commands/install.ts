import { join } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import {
  buildHookCommand,
  isBridgeHook,
  resolveBridgeExecutable,
} from "../bridge-command.js";
import { getClaudeConfigHome } from "../memory-path.js";
import {
  backupSettings,
  readSettingsRaw,
  writeSettingsRaw,
} from "../schemas/cc-settings.js";

interface InstallOpts {
  dryRun?: boolean;
  settingsPath?: string;
}

// The hook entries we want to install
function buildDesiredHooks(): Array<{
  event: string;
  entry: { matcher?: string; hooks: Array<Record<string, unknown>> };
}> {
  return [
    {
      event: "PostToolUse",
      entry: {
        matcher: "Write",
        hooks: [
          {
            type: "command",
            command: buildHookCommand("ingest"),
            async: true,
            timeout: 15,
          },
        ],
      },
    },
    {
      event: "PostToolUse",
      entry: {
        matcher: "Edit",
        hooks: [
          {
            type: "command",
            command: buildHookCommand("ingest"),
            async: true,
            timeout: 15,
          },
        ],
      },
    },
    {
      event: "Stop",
      entry: {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("sync"),
            async: true,
            timeout: 10,
          },
        ],
      },
    },
    {
      event: "UserPromptSubmit",
      entry: {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("recall"),
            timeout: 8,
          },
        ],
      },
    },
  ];
}

export function registerInstallCommand(program: Command): void {
  program
    .command("install")
    .description(
      "Install Claude Code hooks that bridge auto-memory to ByteRover context tree",
    )
    .option("--dry-run", "Show what would be written without modifying files")
    .option(
      "--settings-path <path>",
      "Override path to Claude Code settings.json",
    )
    .action(async (opts: InstallOpts) => {
      try {
        // Validate executable resolves before touching settings
        const exe = resolveBridgeExecutable();
        console.log(pc.dim(`Resolved executable: ${exe}`));

        const settingsPath =
          opts.settingsPath ?? join(getClaudeConfigHome(), "settings.json");

        const settings = readSettingsRaw(settingsPath);

        // Ensure hooks object exists
        if (!settings.hooks || typeof settings.hooks !== "object") {
          settings.hooks = {};
        }
        const hooks = settings.hooks as Record<string, unknown[]>;

        const desired = buildDesiredHooks();
        let added = 0;

        for (const { event, entry } of desired) {
          if (!Array.isArray(hooks[event])) {
            hooks[event] = [];
          }
          const eventHooks = hooks[event] as Array<Record<string, unknown>>;

          // Per-hook dedupe: check if any existing matcher entry with the
          // same matcher value already contains a bridge hook
          const matcherValue = "matcher" in entry ? entry.matcher : undefined;

          const alreadyInstalled = eventHooks.some((existing) => {
            const existingMatcher = existing.matcher as string | undefined;
            if (existingMatcher !== matcherValue) return false;
            const innerHooks = existing.hooks;
            if (!Array.isArray(innerHooks)) return false;
            return innerHooks.some(
              (h: unknown) =>
                typeof h === "object" &&
                h !== null &&
                isBridgeHook(h as Record<string, unknown>),
            );
          });

          if (!alreadyInstalled) {
            eventHooks.push(entry);
            added++;
          }
        }

        if (added === 0) {
          console.log(
            pc.yellow("Bridge hooks already installed. No changes made."),
          );
          return;
        }

        if (opts.dryRun) {
          console.log(pc.cyan("Dry run — would write:"));
          console.log(JSON.stringify(settings, null, 2));
          return;
        }

        const backupPath = backupSettings(settingsPath);
        console.log(pc.dim(`Backup: ${backupPath}`));

        writeSettingsRaw(settingsPath, settings);

        console.log(
          pc.green(`Installed ${added} hook(s) into ${settingsPath}`),
        );
        console.log(
          pc.dim(
            "Hooks: PostToolUse(Write), PostToolUse(Edit), Stop, UserPromptSubmit",
          ),
        );
      } catch (err) {
        console.error(
          pc.red(
            `Install failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    });
}
