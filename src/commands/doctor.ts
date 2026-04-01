import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { Command } from "commander";
import pc from "picocolors";
import { isBridgeHook, resolveBridgeExecutable } from "../bridge-command.js";
import { getCcMemoryDir, getClaudeConfigHome } from "../memory-path.js";
import { readSettingsRaw } from "../schemas/cc-settings.js";

interface CheckResult {
  label: string;
  pass: boolean;
  detail?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check that the bridge is correctly configured")
    .action(async () => {
      const cwd = process.cwd();
      const results: CheckResult[] = [];

      // 1. brv CLI found
      try {
        const version = execSync("brv --version", {
          encoding: "utf-8",
          timeout: 5_000,
        }).trim();
        results.push({ label: "brv CLI", pass: true, detail: version });
      } catch {
        results.push({
          label: "brv CLI",
          pass: false,
          detail: "not found in PATH",
        });
      }

      // 2. .brv/context-tree/ exists
      const ctPath = join(cwd, ".brv", "context-tree");
      results.push({
        label: "Context tree",
        pass: existsSync(ctPath),
        detail: existsSync(ctPath) ? ctPath : `${ctPath} not found`,
      });

      // 3. Settings file exists and is valid JSON
      const settingsPath = join(getClaudeConfigHome(), "settings.json");
      let settingsValid = false;
      try {
        readSettingsRaw(settingsPath);
        settingsValid = existsSync(settingsPath);
      } catch {
        settingsValid = false;
      }
      results.push({
        label: "Claude settings",
        pass: settingsValid,
        detail: settingsValid ? settingsPath : `${settingsPath} missing or invalid`,
      });

      // 4. Bridge hooks installed
      if (settingsValid) {
        const settings = readSettingsRaw(settingsPath);
        const hooks = settings.hooks as Record<string, unknown[]> | undefined;
        const hasPostToolUse = findBridgeHookInEvent(hooks, "PostToolUse");
        const hasStop = findBridgeHookInEvent(hooks, "Stop");
        const hasUserPrompt = findBridgeHookInEvent(hooks, "UserPromptSubmit");
        const installed = hasPostToolUse && hasStop && hasUserPrompt;
        results.push({
          label: "Bridge hooks",
          pass: installed,
          detail: installed
            ? "PostToolUse + Stop + UserPromptSubmit hooks found"
            : `missing: ${[
                !hasPostToolUse && "PostToolUse",
                !hasStop && "Stop",
                !hasUserPrompt && "UserPromptSubmit",
              ]
                .filter(Boolean)
                .join(", ")}`,
        });
      } else {
        results.push({
          label: "Bridge hooks",
          pass: false,
          detail: "cannot check — settings invalid",
        });
      }

      // 5. Bridge executable resolves
      try {
        const exe = resolveBridgeExecutable();
        results.push({
          label: "Bridge executable",
          pass: true,
          detail: exe,
        });
      } catch (err) {
        results.push({
          label: "Bridge executable",
          pass: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      // 6. cc memory dir resolves
      try {
        const memDir = getCcMemoryDir(cwd);
        const memExists = existsSync(memDir);
        results.push({
          label: "Memory directory",
          pass: memExists,
          detail: memExists
            ? memDir
            : `${memDir} (resolved but does not exist yet — will be created on first Claude session)`,
        });
      } catch (err) {
        results.push({
          label: "Memory directory",
          pass: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      // Print results
      console.log(pc.bold("\nbrv-claude-bridge doctor\n"));
      let allPass = true;
      for (const r of results) {
        const icon = r.pass ? pc.green("\u2713") : pc.red("\u2717");
        const detail = r.detail ? pc.dim(` — ${r.detail}`) : "";
        console.log(`  ${icon} ${r.label}${detail}`);
        if (!r.pass) allPass = false;
      }
      console.log();

      if (allPass) {
        console.log(pc.green("All checks passed."));
      } else {
        console.log(
          pc.yellow("Some checks failed. Run 'brv-claude-bridge install' to set up."),
        );
      }
    });
}

function findBridgeHookInEvent(
  hooks: Record<string, unknown[]> | undefined,
  event: string,
): boolean {
  if (!hooks) return false;
  const eventHooks = hooks[event];
  if (!Array.isArray(eventHooks)) return false;

  return eventHooks.some((entry) => {
    const innerHooks = (entry as Record<string, unknown>).hooks;
    if (!Array.isArray(innerHooks)) return false;
    return innerHooks.some(
      (h: unknown) =>
        typeof h === "object" &&
        h !== null &&
        isBridgeHook(h as Record<string, unknown>),
    );
  });
}
