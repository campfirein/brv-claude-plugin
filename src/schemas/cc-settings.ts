import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types for our own hook entries (type-safe generation)
// ---------------------------------------------------------------------------

export interface BridgeCommandHook {
  type: "command";
  command: string;
  async: boolean;
  timeout: number;
}

export interface BridgeHookEntry {
  matcher?: string;
  hooks: BridgeCommandHook[];
}

// ---------------------------------------------------------------------------
// Raw JSON read/write — preserves all unknown fields
// ---------------------------------------------------------------------------

/**
 * Read settings.json as a raw JSON object. Returns empty object if missing.
 * Never validates with Zod — preserves all upstream fields verbatim.
 */
export function readSettingsRaw(
  path: string,
): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Write settings.json, preserving formatting.
 * Creates parent directories if needed.
 */
export function writeSettingsRaw(
  path: string,
  data: Record<string, unknown>,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Backup settings.json before modification.
 */
export function backupSettings(path: string): string {
  const backupPath = path + ".brv-backup";
  if (existsSync(path)) {
    copyFileSync(path, backupPath);
  }
  return backupPath;
}
