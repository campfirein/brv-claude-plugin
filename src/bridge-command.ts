import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Marker — explicit shell comment suffix for hook identification.
// Not derived from path text. Injected deliberately into every stored command.
// ---------------------------------------------------------------------------

export const BRIDGE_HOOK_MARKER = "#brv-claude-plugin";

// ---------------------------------------------------------------------------
// Executable resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the executable prefix for hook commands.
 * Returns ONLY the executable part — callers append subcommand via buildHookCommand().
 *
 *   Production: "/usr/local/bin/brv-claude-plugin"
 *   Dev:        "node /abs/path/to/dist/cli.js"
 */
export function resolveBridgeExecutable(): string {
  const pkgRoot = findPackageRoot();

  // Try production bin first
  const pkgJson = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf-8"),
  ) as Record<string, unknown>;

  const bin = pkgJson.bin as Record<string, string> | string | undefined;
  const binEntry =
    typeof bin === "string"
      ? bin
      : typeof bin === "object" && bin !== null
        ? bin["brv-claude-plugin"]
        : undefined;

  if (binEntry) {
    const resolved = resolve(pkgRoot, binEntry);
    if (existsSync(resolved)) {
      assertNoSpaces(resolved);
      // Only return the bare path if it's actually executable (e.g. npm
      // global install creates a proper shim with +x). tsc output and
      // local dev builds are 0644, so we must prefix with node.
      if (isExecutable(resolved)) {
        return resolved;
      }
      return `node ${resolved}`;
    }
  }

  // Dev fallback: dist/cli.js (never executable — always prefix with node)
  const distCli = join(pkgRoot, "dist", "cli.js");
  if (existsSync(distCli)) {
    assertNoSpaces(distCli);
    return `node ${distCli}`;
  }

  throw new Error(
    `Cannot resolve bridge executable. Run 'pnpm build' first, ` +
      `or install the package globally.`,
  );
}

/**
 * Build the full hook command string for a subcommand.
 * Appends the marker as a trailing shell comment so isBridgeHook() works
 * regardless of install path or directory name.
 *
 *   "/usr/local/bin/brv-claude-plugin ingest #brv-claude-plugin"
 *   "node /tmp/bridge/dist/cli.js sync #brv-claude-plugin"
 */
export function buildHookCommand(subcommand: string): string {
  const exe = resolveBridgeExecutable();
  return `${exe} ${subcommand} ${BRIDGE_HOOK_MARKER}`;
}

/**
 * Check if a hook object was installed by this bridge.
 * Matches on BRIDGE_HOOK_MARKER, not path text.
 */
export function isBridgeHook(hook: Record<string, unknown>): boolean {
  return (
    typeof hook.command === "string" &&
    hook.command.includes(BRIDGE_HOOK_MARKER)
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findPackageRoot(): string {
  // Walk up from this file to find package.json
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find package.json for brv-claude-plugin");
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function assertNoSpaces(resolvedPath: string): void {
  if (/\s/.test(resolvedPath)) {
    throw new Error(
      `Bridge install path contains spaces: "${resolvedPath}"\n` +
        `Install brv-claude-plugin to a path without spaces, or use a symlink.`,
    );
  }
}
