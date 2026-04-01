# @byterover/claude-bridge

Native bridge between [ByteRover](https://www.byterover.dev) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Enriches Claude's auto-memory with BM25-ranked knowledge from the brv context tree — giving Claude persistent, cross-referenced context that improves over time.

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

Claude Code has a built-in auto-memory system — it saves observations across sessions as flat markdown files. ByteRover has a richer context tree with BM25 indexing, importance scoring, and lifecycle management. This bridge connects the two:

1. **Ingesting memories** — when Claude's extraction agent writes a memory file, a hook fires and sends the content to `brv curate`, which enriches it with tags, keywords, scoring metadata, and stores it in the context tree
2. **Syncing context** — after each turn, a hook queries ByteRover for ranked knowledge and writes a cross-reference file that Claude's recall system can pick up
3. **Zero workflow change** — you use `claude` exactly as before. The bridge runs in the background via Claude Code's hook system

The result: Claude's memories are indexed, scored, and searchable alongside the rest of your project knowledge in ByteRover.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- Node.js 20+
- [brv CLI](https://www.byterover.dev) installed and available on your `PATH`. The brv path depends on how you installed it:
  - **curl**: the default path is `~/.brv-cli/bin/brv`
  - **npm**: run `which brv` to find the path
- A project with `.brv/` initialized (`brv init`)

## Quick start

### 1. Install the bridge

```bash
npm install -g @byterover/claude-bridge
```

### 2. Install hooks

```bash
brv-claude-bridge install
```

This adds three hooks to `~/.claude/settings.json`:

- **PostToolUse(Write)** — triggers `brv-claude-bridge ingest` when Claude writes a memory file
- **PostToolUse(Edit)** — triggers `brv-claude-bridge ingest` when Claude edits a memory file
- **Stop** — triggers `brv-claude-bridge sync` after each turn to refresh cross-references

Your existing settings and hooks are preserved. A backup is saved to `settings.json.brv-backup`.

### 3. Verify

```bash
brv-claude-bridge doctor
```

You should see all checks passing:

```
brv-claude-bridge doctor

  ✓ brv CLI — byterover-cli/2.5.0
  ✓ Context tree — /path/to/project/.brv/context-tree
  ✓ Claude settings — ~/.claude/settings.json
  ✓ Bridge hooks — PostToolUse + Stop hooks found
  ✓ Bridge executable — /usr/local/bin/brv-claude-bridge
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
brv-claude-bridge uninstall
```

Removes only bridge hooks. Your other hooks and settings are untouched.

## Commands

### `brv-claude-bridge install`

Installs hooks into Claude Code's `~/.claude/settings.json`.

| Option              | Description                                |
| ------------------- | ------------------------------------------ |
| `--dry-run`         | Show what would be written without saving  |
| `--settings-path`   | Override path to Claude Code settings.json |

Idempotent — safe to run multiple times. Deduplicates by checking for the `#brv-claude-bridge` marker in existing hooks.

### `brv-claude-bridge uninstall`

Removes bridge hooks from settings. Per-hook removal — if a matcher entry contains both a bridge hook and your own hook, only the bridge hook is deleted.

| Option              | Description                                |
| ------------------- | ------------------------------------------ |
| `--settings-path`   | Override path to Claude Code settings.json |

### `brv-claude-bridge ingest`

Called by the PostToolUse hook. Reads hook JSON from stdin, parses the memory file, and sends it to `brv curate --detach`.

- **Write tool**: reads content from `tool_input.content`
- **Edit tool**: reads the file from disk (Edit only carries `old_string`/`new_string`)
- Skips non-memory files, `MEMORY.md`, and `_brv_context.md`
- Always exits 0 — never blocks Claude

| Option    | Description              |
| --------- | ------------------------ |
| `--json`  | Output result as JSON    |

### `brv-claude-bridge sync`

Called by the Stop hook. Queries ByteRover for ranked knowledge and writes `_brv_context.md` in Claude's memory directory with a single pointer in `MEMORY.md`.

- On success: writes full cross-reference content
- On failure/timeout: writes a stub with "(sync pending)" so stale content isn't served
- Freshness is best-effort — runs async in the background

| Option           | Description                              |
| ---------------- | ---------------------------------------- |
| `--json`         | Output result as JSON                    |
| `--memory-dir`   | Override path to Claude memory directory |

### `brv-claude-bridge doctor`

Runs 6 diagnostic checks: brv CLI, context tree, settings file, installed hooks, bridge executable, and memory directory resolution.

## How it works

The bridge uses Claude Code's [hook system](https://docs.anthropic.com/en/docs/claude-code/hooks) to intercept memory operations without modifying Claude Code's source.

### Ingest flow (PostToolUse hook)

```
Claude writes ~/.claude/projects/.../memory/feedback_testing.md
  │
  ▼ PostToolUse hook fires, pipes JSON to stdin
brv-claude-bridge ingest
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
brv-claude-bridge sync
  │ brv query → ranked knowledge from _cc/ domain
  ▼
~/.claude/projects/.../memory/_brv_context.md
  (cross-references from ByteRover knowledge base)
```

### Memory path resolution

The bridge resolves Claude's memory directory using the same logic as Claude Code:

1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` env var (full override)
2. `autoMemoryDirectory` from settings (local → user, excluding project settings for security)
3. `~/.claude/projects/<sanitized-canonical-git-root>/memory/`

Git worktrees are resolved to their canonical root so all worktrees share one memory directory.

### Hook identification

Every stored hook command includes a `#brv-claude-bridge` shell comment marker. This marker — not the path text — is used by `install` (dedupe), `uninstall` (removal), and `doctor` (detection). A clone in any directory will work correctly.

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
  brv-process.ts              # brv CLI spawning (curate, query) with timeout/abort
  cc-frontmatter.ts           # Claude Code memory YAML frontmatter parser
  memory-path.ts              # Full cc-ts memory path resolution (git root, worktrees, env vars)
  stdin.ts                    # Read + validate JSON from stdin
  bridge-command.ts           # Executable resolution + #brv-claude-bridge marker
  schemas/
    cc-hook-input.ts          # Zod schemas for PostToolUse and Stop hook input
    cc-settings.ts            # Raw JSON read/write for settings.json (lossless)
  commands/
    install.ts                # Install hooks into settings.json (per-hook dedupe, backup)
    uninstall.ts              # Remove bridge hooks (per-hook removal)
    ingest.ts                 # PostToolUse handler — Write/Edit split, brv curate
    sync.ts                   # Stop handler — brv query, _brv_context.md, MEMORY.md pointer
    doctor.ts                 # 6 diagnostic checks
```

## License

MIT
