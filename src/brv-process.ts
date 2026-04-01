import { spawn } from "node:child_process";
import {
  accessSync,
  existsSync,
  readFileSync,
  constants as fsConstants,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";

// ---------------------------------------------------------------------------
// Win32 .cmd shim resolution (ported from brv-openclaw-plugin)
// ---------------------------------------------------------------------------

function resolveWin32Command(name: string): {
  command: string;
  prependArgs: string[];
} {
  if (process.platform !== "win32") {
    return { command: name, prependArgs: [] };
  }

  if (name.endsWith(".cmd")) {
    const jsEntry = resolveJsFromCmdShim(name);
    if (jsEntry) {
      return { command: process.execPath, prependArgs: [jsEntry] };
    }
  }

  if (!isAbsolute(name)) {
    for (const dir of (process.env.PATH || "").split(delimiter)) {
      const cmdCandidate = join(dir, name + ".cmd");
      const jsEntry = resolveJsFromCmdShim(cmdCandidate);
      if (jsEntry) {
        return { command: process.execPath, prependArgs: [jsEntry] };
      }
    }
  }

  return { command: name, prependArgs: [] };
}

function resolveJsFromCmdShim(cmdPath: string): string | undefined {
  try {
    const content = readFileSync(cmdPath, "utf8");
    const match = content.match(
      /"%(?:~dp0|dp0)%\\(node_modules\\[^"]+\.(?:js|cjs|mjs))"/i,
    );
    if (match) {
      const resolved = join(dirname(cmdPath), match[1]);
      accessSync(resolved, fsConstants.R_OK);
      return resolved;
    }
  } catch {
    // not a valid .cmd shim
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrvJsonResponse<T = unknown> {
  command: string;
  success: boolean;
  timestamp: string;
  data: T;
}

export interface BrvCurateResult {
  status: "completed" | "queued" | "error";
  taskId?: string;
  logId?: string;
  changes?: { created?: string[]; updated?: string[] };
  error?: string;
  message?: string;
}

export interface BrvQueryResult {
  status: "completed" | "error";
  result?: string;
  content?: string;
  error?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Core spawning utility
// ---------------------------------------------------------------------------

export function runBrv(params: {
  brvPath: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  maxOutputChars?: number;
}): Promise<{ stdout: string; stderr: string }> {
  const maxOutput = params.maxOutputChars ?? 512_000;

  return new Promise((resolve, reject) => {
    let settled = false;

    function settle(
      outcome: "resolve" | "reject",
      value: { stdout: string; stderr: string } | Error,
    ) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (outcome === "resolve") {
        resolve(value as { stdout: string; stderr: string });
      } else {
        reject(value);
      }
    }

    const { command, prependArgs } = resolveWin32Command(params.brvPath);
    const child = spawn(command, [...prependArgs, ...params.args], {
      cwd: params.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(
        "reject",
        new Error(
          `brv ${params.args[0]} timed out after ${params.timeoutMs}ms`,
        ),
      );
    }, params.timeoutMs);

    if (params.signal) {
      if (params.signal.aborted) {
        child.kill("SIGKILL");
        settle("reject", new Error(`brv ${params.args[0]} aborted`));
      } else {
        params.signal.addEventListener(
          "abort",
          () => {
            child.kill("SIGKILL");
            settle("reject", new Error(`brv ${params.args[0]} aborted`));
          },
          { once: true },
        );
      }
    }

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > maxOutput) {
        child.kill("SIGKILL");
        settle(
          "reject",
          new Error(
            `brv ${params.args[0]} output exceeded ${maxOutput} chars`,
          ),
        );
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        if (!existsSync(params.cwd)) {
          settle(
            "reject",
            new Error(
              `Working directory "${params.cwd}" does not exist. ` +
                `Ensure you are in a valid project directory.`,
            ),
          );
        } else {
          settle(
            "reject",
            new Error(
              `ByteRover CLI not found at "${params.brvPath}". ` +
                `Install it (https://www.byterover.dev) or set brvPath.`,
            ),
          );
        }
        return;
      }
      settle("reject", err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        settle("resolve", { stdout, stderr });
      } else {
        const errMsg = `brv ${params.args[0]} failed (exit ${code}): ${stderr || stdout}`;
        settle("reject", new Error(errMsg));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Parse NDJSON output — take the last valid JSON line
// ---------------------------------------------------------------------------

export function parseLastJsonLine<T>(stdout: string): BrvJsonResponse<T> {
  const lines = stdout.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as BrvJsonResponse<T>;
    } catch {
      // skip non-JSON lines
    }
  }
  throw new Error("No valid JSON in brv output");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function brvCurate(params: {
  brvPath?: string;
  cwd: string;
  context: string;
  detach?: boolean;
  timeoutMs?: number;
}): Promise<BrvJsonResponse<BrvCurateResult>> {
  const brvPath = params.brvPath ?? "brv";
  const timeoutMs = params.timeoutMs ?? 60_000;

  const args = ["curate", "--format", "json"];
  if (params.detach) {
    args.push("--detach");
  }
  args.push("--", params.context);

  const { stdout } = await runBrv({
    brvPath,
    args,
    cwd: params.cwd,
    timeoutMs,
  });
  return parseLastJsonLine<BrvCurateResult>(stdout);
}

export async function brvQuery(params: {
  brvPath?: string;
  cwd: string;
  query: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<BrvJsonResponse<BrvQueryResult>> {
  const brvPath = params.brvPath ?? "brv";
  const timeoutMs = params.timeoutMs ?? 12_000;

  const args = ["query", "--format", "json", "--", params.query];

  const { stdout } = await runBrv({
    brvPath,
    args,
    cwd: params.cwd,
    timeoutMs,
    signal: params.signal,
  });
  return parseLastJsonLine<BrvQueryResult>(stdout);
}
