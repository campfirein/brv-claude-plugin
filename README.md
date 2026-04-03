# @byterover/claude-bridge

Native bridge between [ByteRover](https://www.byterover.dev) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Enriches Claude's auto-memory with ByteRover's full multi-tier retrieval — BM25 search, importance scoring, performance correlation, and LLM synthesis — giving Claude persistent, cross-referenced context that improves over time.

## Table of contents

- [What it does](#what-it-does)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Commands](#commands)
- [How it works](#how-it-works)
- [Development](#development)
- [Project structure](#project-structure)
- [License](#license)

## What it does

Claude Code has a built-in auto-memory system — it saves observations across sessions as flat markdown files. ByteRover has a richer context tree with multi-tier retrieval: BM25 text search, importance/recency scoring, maturity tier boosting, performance-memory correlation, and LLM-powered synthesis. This bridge connects the two:

1. **Ingesting memories** — when Claude's extraction agent writes a memory file, a hook fires and sends the content to `brv curate`, which enriches it with tags, keywords, scoring metadata, and stores it in the context tree
2. **Syncing context** — after each turn, a hook queries ByteRover for ranked knowledge and writes a cross-reference file that Claude's recall system can pick up
3. **Zero workflow change** — you use `claude` exactly as before. The bridge runs in the background via Claude Code's hook system

The result: Claude's memories are indexed, scored, and searchable alongside the rest of your project knowledge in ByteRover.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- Node.js 20+
- [brv CLI](https://docs.byterover.dev/quickstart) installed and available on your `PATH`

## Quick start

### 1. Install the bridge

```bash
npm install -g @byterover/claude-bridge
```

### 2. Install hooks

```bash
brv-claude-plugin install
```

This adds four hooks to `~/.claude/settings.json`:

- **PostToolUse(Write)** — triggers `brv-claude-plugin ingest` when Claude writes a memory file
- **PostToolUse(Edit)** — triggers `brv-claude-plugin ingest` when Claude edits a memory file
- **Stop** — triggers `brv-claude-plugin sync` after each turn to refresh cross-references
- **UserPromptSubmit** — triggers `brv-claude-plugin recall` to query ByteRover with the user's prompt and inject relevant context before the model call

Your existing settings and hooks are preserved. A backup is saved to `settings.json.brv-backup`.

### 3. Verify

```bash
brv-claude-plugin doctor
```

You should see all checks passing:

```
brv-claude-plugin doctor

  ✓ brv CLI — byterover-cli/2.5.0
  ✓ Context tree — /path/to/project/.brv/context-tree
  ✓ Claude settings — ~/.claude/settings.json
  ✓ Bridge hooks — PostToolUse + Stop + UserPromptSubmit hooks found
  ✓ Bridge executable — /usr/local/bin/brv-claude-plugin
  ✓ Memory directory — ~/.claude/projects/-path-to-project/memory/

All checks passed.
```

### 4. Use Claude normally

```bash
claude "fix the auth bug"
```

Memories are ingested into `.brv/context-tree/_cc/` automatically. No changes to your workflow.

### 5. Uninstall (if needed)

```bash
brv-claude-plugin uninstall
```

Removes only bridge hooks. Your other hooks and settings are untouched.

## Commands

### `brv-claude-plugin install`

Installs hooks into Claude Code's `~/.claude/settings.json`.

| Option              | Description                                |
| ------------------- | ------------------------------------------ |
| `--dry-run`         | Show what would be written without saving  |
| `--settings-path`   | Override path to Claude Code settings.json |

Idempotent — safe to run multiple times. Deduplicates by checking for the `#brv-claude-plugin` marker in existing hooks.

### `brv-claude-plugin uninstall`

Removes bridge hooks from settings. Per-hook removal — if a matcher entry contains both a bridge hook and your own hook, only the bridge hook is deleted.

| Option              | Description                                |
| ------------------- | ------------------------------------------ |
| `--settings-path`   | Override path to Claude Code settings.json |

### `brv-claude-plugin ingest`

Called by the PostToolUse hook. Reads hook JSON from stdin, parses the memory file, and sends it to `brv curate --detach`.

- **Write tool**: reads content from `tool_input.content`
- **Edit tool**: reads the file from disk (Edit only carries `old_string`/`new_string`)
- Skips non-memory files, `MEMORY.md`, and `_brv_context.md`
- Always exits 0 — never blocks Claude

| Option    | Description              |
| --------- | ------------------------ |
| `--json`  | Output result as JSON    |

### `brv-claude-plugin sync`

Called by the Stop hook. Copies the context tree index from `.brv/context-tree/_index.md` into `_brv_context.md` in Claude's memory directory with a single pointer in `MEMORY.md`.

- On success: writes context tree index with a guide note pointing to the full tree
- If `_index.md` unavailable but `_brv_context.md` exists: preserves existing content
- If `_index.md` unavailable and no existing file: writes a stub with "(sync pending)"
- Runs async in the background — never blocks Claude

| Option           | Description                              |
| ---------------- | ---------------------------------------- |
| `--json`         | Output result as JSON                    |
| `--memory-dir`   | Override path to Claude memory directory |

### `brv-claude-plugin recall`

Called by the UserPromptSubmit hook. Reads the user's prompt from stdin, queries ByteRover with it, and returns targeted context as `additionalContext` that Claude sees before generating a response.

- Runs **synchronously** — delays the model call until ByteRover responds (6s internal timeout, 8s hook timeout)
- Skips trivially short prompts (< 5 chars)
- If ByteRover query fails or times out, exits silently — prompt proceeds without context
- Wraps results in `<byterover-context>` tags

### `brv-claude-plugin doctor`

Runs 6 diagnostic checks: brv CLI, context tree, settings file, installed hooks, bridge executable, and memory directory resolution.

## How it works

The bridge uses Claude Code's [hook system](https://docs.anthropic.com/en/docs/claude-code/hooks) to intercept memory operations without modifying Claude Code's source.

### Recall flow (UserPromptSubmit hook)

```
User types: "fix the combo scoring bug"
  │
  ▼ UserPromptSubmit hook fires (before model call)
brv-claude-plugin recall
  │ brv query "fix the combo scoring bug" → targeted results
  ▼
Claude sees <byterover-context> as system reminder
  (live, relevant to this specific prompt)
```

### Ingest flow (PostToolUse hook)

```
Claude writes ~/.claude/projects/.../memory/feedback_testing.md
  │
  ▼ PostToolUse hook fires, pipes JSON to stdin
brv-claude-plugin ingest
  │ Parse cc-ts frontmatter (name, description, type)
  │ Map type → domain (_cc/user, _cc/feedback, _cc/project, _cc/reference)
  ▼
brv curate --detach --format json -- "context string"
  │ Daemon queues curation (async, non-blocking)
  ▼
.brv/context-tree/_cc/feedback/testing.md
  (enriched with tags, keywords, importance scoring)
```

### Sync flow (Stop hook)

```
Turn ends
  │
  ▼ Stop hook fires
brv-claude-plugin sync
  │ read .brv/context-tree/_index.md → copy to memory dir
  ▼
~/.claude/projects/.../memory/_brv_context.md
  (context tree index + guide to full tree)
```

### Memory path resolution

The bridge resolves Claude's memory directory using the same logic as Claude Code:

1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` env var (full override)
2. `autoMemoryDirectory` from settings (local → user, excluding project settings for security)
3. `~/.claude/projects/<sanitized-canonical-git-root>/memory/`

Git worktrees are resolved to their canonical root so all worktrees share one memory directory.

### Multi-project support

The bridge naturally supports multiple projects. Claude Code scopes memory per git repository, and ByteRover scopes its context tree per `.brv/` directory. Both use the same `cwd` from the hook input as their anchor:

```
/Users/x/project-a/        ← claude session here
├── .git/                   ← Claude memory: ~/.claude/projects/-Users-x-project-a/memory/
├── .brv/                   ← ByteRover tree: project-a/.brv/context-tree/
└── src/

/Users/x/project-b/        ← separate claude session here
├── .git/                   ← Claude memory: ~/.claude/projects/-Users-x-project-b/memory/
├── .brv/                   ← ByteRover tree: project-b/.brv/context-tree/
└── src/
```

Each project's memories are ingested into its own context tree and synced back to its own memory directory. No cross-project leakage.

**Important: initialize `.brv/` at the git root.** Claude Code resolves memory directories from the canonical git root. ByteRover walks up from `cwd` to find `.brv/`. When both are at the same level, everything maps correctly.

If you initialize `.brv/` in a subdirectory instead of the git root, the bridge will encounter mismatches:

```
/monorepo/                  ← git root (Claude memory lives here)
├── .git/
├── frontend/
│   └── .brv/               ← brv initialized here, not at git root
└── backend/                ← sessions from here won't find .brv/
```

In this layout, Claude sessions from `/monorepo/backend/` would fail to reach the `.brv/` in `frontend/`. To fix this, initialize ByteRover at the git root:

```bash
cd /monorepo
brv init                    # .brv/ at git root — matches Claude's project boundary
```

If you need separate context trees for subdirectories in a monorepo, initialize `.brv/` in each subdirectory and run `claude` from within that subdirectory (not from the monorepo root).

### Hook identification

Every stored hook command includes a `#brv-claude-plugin` shell comment marker. This marker — not the path text — is used by `install` (dedupe), `uninstall` (removal), and `doctor` (detection). A clone in any directory will work correctly.

## Development

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Build
npm run build

# Run in dev mode
npm run dev -- doctor

# Run built CLI
node dist/cli.js doctor
```

### Testing locally

1. Initialize a brv project: `cd /your/project && brv init`
2. Build the bridge: `npm run build`
3. Install hooks (dev mode): `node dist/cli.js install`
4. Start a Claude session and make a few changes
5. Check `.brv/context-tree/_cc/` for ingested memories
6. Check `~/.claude/projects/.../memory/_brv_context.md` for synced context

## Project structure

```
src/
  cli.ts                      # Commander.js entry point
  cc-frontmatter.ts           # Claude Code memory YAML frontmatter parser
  memory-path.ts              # Full cc-ts memory path resolution (git root, worktrees, env vars)
  stdin.ts                    # Read + validate JSON from stdin
  bridge-command.ts           # Executable resolution + #brv-claude-plugin marker
  schemas/
    cc-hook-input.ts          # Zod schemas for PostToolUse and Stop hook input
    cc-settings.ts            # Raw JSON read/write for settings.json (lossless)
  commands/
    install.ts                # Install hooks into settings.json (per-hook dedupe, backup)
    uninstall.ts              # Remove bridge hooks (per-hook removal)
    ingest.ts                 # PostToolUse handler — Write/Edit split, brv curate
    sync.ts                   # Stop handler — _index.md copy, _brv_context.md, MEMORY.md pointer
    recall.ts                 # UserPromptSubmit handler — live brv query with user prompt
    doctor.ts                 # 6 diagnostic checks
```

## License

[Elastic License 2.0 (ELv2)](./LICENSE)
