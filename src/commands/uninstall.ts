import { join } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { isBridgeHook } from "../bridge-command.js";
import { getClaudeConfigHome } from "../memory-path.js";
import {
  backupSettings,
  readSettingsRaw,
  writeSettingsRaw,
} from "../schemas/cc-settings.js";

interface UninstallOpts {
  settingsPath?: string;
}

export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description("Remove Claude Code hooks installed by the bridge")
    .option(
      "--settings-path <path>",
      "Override path to Claude Code settings.json",
    )
    .action(async (opts: UninstallOpts) => {
      try {
        const settingsPath =
          opts.settingsPath ??
          join(getClaudeConfigHome(), "settings.json");

        const settings = readSettingsRaw(settingsPath);
        const hooks = settings.hooks as
          | Record<string, unknown[]>
          | undefined;

        if (!hooks || typeof hooks !== "object") {
          console.log(pc.yellow("No hooks found in settings. Nothing to remove."));
          return;
        }

        let removed = 0;

        for (const event of Object.keys(hooks)) {
          const eventHooks = hooks[event];
          if (!Array.isArray(eventHooks)) continue;

          // Per-hook removal: within each matcher entry, remove only bridge hooks
          for (let i = eventHooks.length - 1; i >= 0; i--) {
            const matcherEntry = eventHooks[i] as Record<string, unknown>;
            const innerHooks = matcherEntry.hooks;
            if (!Array.isArray(innerHooks)) continue;

            const filtered = innerHooks.filter((h: unknown) => {
              if (
                typeof h === "object" &&
                h !== null &&
                isBridgeHook(h as Record<string, unknown>)
              ) {
                removed++;
                return false;
              }
              return true;
            });

            if (filtered.length === 0) {
              // All hooks in this matcher entry were bridge hooks — remove the entry
              eventHooks.splice(i, 1);
            } else {
              matcherEntry.hooks = filtered;
            }
          }

          // Clean up empty event arrays
          if (eventHooks.length === 0) {
            delete hooks[event];
          }
        }

        // Clean up empty hooks object
        if (Object.keys(hooks).length === 0) {
          delete settings.hooks;
        }

        if (removed === 0) {
          console.log(pc.yellow("No bridge hooks found. Nothing to remove."));
          return;
        }

        backupSettings(settingsPath);
        writeSettingsRaw(settingsPath, settings);

        console.log(
          pc.green(`Removed ${removed} bridge hook(s) from ${settingsPath}`),
        );
      } catch (err) {
        console.error(
          pc.red(
            `Uninstall failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    });
}
