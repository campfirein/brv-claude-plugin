import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  resolve,
  sep,
} from "node:path";

// ---------------------------------------------------------------------------
// djb2 hash — exact match of cc-ts/utils/hash.ts
// ---------------------------------------------------------------------------

function djb2Hash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

function simpleHash(str: string): string {
  return Math.abs(djb2Hash(str)).toString(36);
}

// ---------------------------------------------------------------------------
// Path sanitization — exact match of cc-ts/utils/sessionStoragePortable.ts
// ---------------------------------------------------------------------------

const MAX_SANITIZED_LENGTH = 200;

export function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, "-");
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized;
  }
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${simpleHash(name)}`;
}

// ---------------------------------------------------------------------------
// Claude config home
// ---------------------------------------------------------------------------

export function getClaudeConfigHome(): string {
  return (
    process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")
  ).normalize("NFC");
}

// ---------------------------------------------------------------------------
// Memory base directory
// ---------------------------------------------------------------------------

function getMemoryBaseDir(): string {
  return process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR ?? getClaudeConfigHome();
}

// ---------------------------------------------------------------------------
// Memory path validation — matches cc-ts/memdir/paths.ts validateMemoryPath
// ---------------------------------------------------------------------------

function validateMemoryPath(
  raw: string | undefined,
  expandTilde: boolean,
): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;

  let candidate = raw;

  // Expand ~/ if allowed (settings: yes, env var: no)
  if (
    expandTilde &&
    (candidate.startsWith("~/") || candidate.startsWith("~\\"))
  ) {
    candidate = join(homedir(), candidate.slice(2));
  }

  // Normalize and strip trailing separators
  const normalized = normalize(candidate).replace(/[/\\]+$/, "");

  // Reject non-absolute, too short, or dangerous paths
  if (!isAbsolute(normalized)) return undefined;
  if (normalized.length < 3) return undefined;
  if (normalized.includes("\0")) return undefined;

  // Reject UNC paths on Windows
  if (normalized.startsWith("\\\\")) return undefined;

  return (normalized + sep).normalize("NFC");
}

// ---------------------------------------------------------------------------
// Settings-based override — best local approximation of cc-ts precedence
// ---------------------------------------------------------------------------

function readAutoMemDirFromSettings(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, "utf-8");
    const settings = JSON.parse(content) as Record<string, unknown>;
    if (
      typeof settings.autoMemoryDirectory === "string" &&
      settings.autoMemoryDirectory
    ) {
      return settings.autoMemoryDirectory;
    }
  } catch {
    // file doesn't exist or isn't valid JSON
  }
  return undefined;
}

function getAutoMemPathSetting(cwd: string): string | undefined {
  // Best local approximation of cc-ts precedence:
  //   policySettings → flagSettings → localSettings → userSettings
  // We cannot access policySettings or flagSettings from a hook process.
  // Env-var overrides (priority 1 & 2) cover those cases in practice.

  // localSettings: <cwd>/.claude/settings.local.json
  const localDir = readAutoMemDirFromSettings(
    join(cwd, ".claude", "settings.local.json"),
  );
  if (localDir) return validateMemoryPath(localDir, true);

  // userSettings: ~/.claude/settings.json
  const userDir = readAutoMemDirFromSettings(
    join(getClaudeConfigHome(), "settings.json"),
  );
  if (userDir) return validateMemoryPath(userDir, true);

  return undefined;
}

// ---------------------------------------------------------------------------
// Full override via env var
// ---------------------------------------------------------------------------

function getAutoMemPathOverride(): string | undefined {
  const raw = process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE;
  return validateMemoryPath(raw, false);
}

// ---------------------------------------------------------------------------
// Canonical git root — walk up, follow worktree chain
// Ported from cc-ts/utils/git.ts
// ---------------------------------------------------------------------------

function findGitRoot(startPath: string): string | null {
  let current = resolve(startPath);
  const root = current.substring(0, current.indexOf(sep) + 1) || sep;

  while (current !== root) {
    try {
      const gitPath = join(current, ".git");
      const st = statSync(gitPath);
      if (st.isDirectory() || st.isFile()) {
        return current.normalize("NFC");
      }
    } catch {
      // .git doesn't exist here
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Check root
  try {
    const st = statSync(join(root, ".git"));
    if (st.isDirectory() || st.isFile()) {
      return root.normalize("NFC");
    }
  } catch {
    // not in git
  }

  return null;
}

function resolveCanonicalRoot(gitRoot: string): string {
  try {
    const gitContent = readFileSync(join(gitRoot, ".git"), "utf-8").trim();
    if (!gitContent.startsWith("gitdir:")) {
      return gitRoot;
    }

    const worktreeGitDir = resolve(
      gitRoot,
      gitContent.slice("gitdir:".length).trim(),
    );

    // commondir → shared .git directory. Submodules have none → falls through.
    const commonDir = resolve(
      worktreeGitDir,
      readFileSync(join(worktreeGitDir, "commondir"), "utf-8").trim(),
    );

    // Security: validate worktree chain structure
    if (resolve(dirname(worktreeGitDir)) !== join(commonDir, "worktrees")) {
      return gitRoot;
    }

    const backlink = realpathSync(
      readFileSync(join(worktreeGitDir, "gitdir"), "utf-8").trim(),
    );
    if (backlink !== join(realpathSync(gitRoot), ".git")) {
      return gitRoot;
    }

    // Bare-repo worktrees: common dir isn't inside a working directory
    if (basename(commonDir) !== ".git") {
      return commonDir.normalize("NFC");
    }
    return dirname(commonDir).normalize("NFC");
  } catch {
    return gitRoot;
  }
}

export function findCanonicalGitRoot(startPath: string): string | null {
  const root = findGitRoot(startPath);
  if (!root) return null;
  return resolveCanonicalRoot(root);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the Claude Code auto-memory directory for a given project cwd.
 * Matches cc-ts resolution priority:
 *   1. CLAUDE_COWORK_MEMORY_PATH_OVERRIDE env var
 *   2. autoMemoryDirectory from settings (local → user)
 *   3. <memoryBase>/projects/<sanitized-git-root>/memory/
 */
export function getCcMemoryDir(cwd: string): string {
  // Priority 1: full path override
  const override = getAutoMemPathOverride();
  if (override) return override;

  // Priority 2: settings override
  const setting = getAutoMemPathSetting(cwd);
  if (setting) return setting;

  // Priority 3: computed from canonical git root
  const gitRoot = findCanonicalGitRoot(cwd) ?? cwd;
  const projectsDir = join(getMemoryBaseDir(), "projects");
  return (
    join(projectsDir, sanitizePath(gitRoot), "memory") + sep
  ).normalize("NFC");
}

/**
 * Check if a file path is inside a cc-ts memory directory.
 * Takes pre-resolved memoryDir for efficiency and clarity.
 */
export function isCcMemoryPath(
  filePath: string,
  memoryDir: string,
): boolean {
  return filePath.startsWith(memoryDir);
}
