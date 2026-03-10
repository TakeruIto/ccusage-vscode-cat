# CLAUDE.md

## Project Overview

VSCode extension that displays Claude Code token usage from local `~/.claude` directory with an animated running cat.

## Architecture

- `src/claudeDataParser.ts` — Parses `.claude/projects/` JSONL session files. Deduplicates tokens by `message.id` (same assistant response spans multiple JSONL lines).
- `src/webviewContent.ts` — Generates the Webview HTML with stats cards, usage bar, session table, and ASCII cat animation.
- `src/extension.ts` — VSCode extension entry point. Registers command and manages Webview panel lifecycle.

## Key Decisions

- Token counts are deduplicated by `message.id` because Claude Code writes one JSONL line per content block (thinking, text, tool_use) with identical `usage` data.
- Supports `~/.claude/`, `~/.config/claude/`, and `CLAUDE_CONFIG_DIR` env var.
- Daily usage ratio is a heuristic against an estimated 5M token limit.

## Commands

- `npm run compile` — TypeScript compilation
- `npm test` — Run vitest test suite
- `npm run test:watch` — Watch mode

## Review Guidelines

When reviewing PRs, focus on:
1. Token parsing correctness (deduplication, field mapping)
2. No double-counting across content blocks or config directories
3. Test coverage for parser edge cases
4. Webview security (no unsafe innerHTML, proper escaping)
