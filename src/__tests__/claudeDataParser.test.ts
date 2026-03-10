import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  parseSessionContent,
  parseClaudeUsage,
  getTodayTokens,
  buildSummary,
  getProjectsDirs,
  ESTIMATED_DAILY_TOKEN_LIMIT,
  type SessionUsage,
} from "../claudeDataParser";

// ──────────────────────────────────────────────
// Helper to build JSONL lines
// ──────────────────────────────────────────────

function userLine(opts: { uuid?: string; timestamp?: string } = {}): string {
  return JSON.stringify({
    type: "user",
    uuid: opts.uuid ?? "u1",
    timestamp: opts.timestamp ?? "2026-03-09T10:00:00.000Z",
    message: { role: "user", content: "hello" },
  });
}

function assistantLine(opts: {
  msgId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreate?: number;
  cacheRead?: number;
  timestamp?: string;
} = {}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: opts.timestamp ?? "2026-03-09T10:00:01.000Z",
    message: {
      id: opts.msgId ?? "msg_001",
      model: opts.model ?? "claude-sonnet-4-6",
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      usage: {
        input_tokens: opts.inputTokens ?? 100,
        output_tokens: opts.outputTokens ?? 50,
        cache_creation_input_tokens: opts.cacheCreate ?? 200,
        cache_read_input_tokens: opts.cacheRead ?? 300,
      },
    },
  });
}

function queueLine(): string {
  return JSON.stringify({
    type: "queue-operation",
    operation: "enqueue",
    timestamp: "2026-03-09T09:59:59.000Z",
    sessionId: "sess-1",
    content: "hello",
  });
}

// ──────────────────────────────────────────────
// parseSessionContent
// ──────────────────────────────────────────────

describe("parseSessionContent", () => {
  it("parses a simple session with one user + one assistant message", () => {
    const content = [userLine(), assistantLine()].join("\n");
    const result = parseSessionContent(content, "sess-1", "-home-user-myproject");

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("sess-1");
    expect(result!.model).toBe("claude-sonnet-4-6");
    expect(result!.totalInputTokens).toBe(100);
    expect(result!.totalOutputTokens).toBe(50);
    expect(result!.cacheCreationTokens).toBe(200);
    expect(result!.cacheReadTokens).toBe(300);
    expect(result!.messageCount).toBe(2); // 1 user + 1 assistant
    expect(result!.projectPath).toBe("home/user/myproject");
  });

  it("deduplicates assistant messages with the same message ID", () => {
    // Same msgId "msg_001" appears 3 times (simulating thinking + text + tool_use blocks)
    const content = [
      userLine(),
      assistantLine({ msgId: "msg_001", inputTokens: 100, outputTokens: 50 }),
      assistantLine({ msgId: "msg_001", inputTokens: 100, outputTokens: 50 }),
      assistantLine({ msgId: "msg_001", inputTokens: 100, outputTokens: 50 }),
    ].join("\n");

    const result = parseSessionContent(content, "sess-1", "-proj");
    expect(result).not.toBeNull();
    // Should count tokens only once, not 3x
    expect(result!.totalInputTokens).toBe(100);
    expect(result!.totalOutputTokens).toBe(50);
    // 1 user + 1 unique assistant
    expect(result!.messageCount).toBe(2);
  });

  it("counts multiple distinct assistant messages separately", () => {
    const content = [
      userLine(),
      assistantLine({ msgId: "msg_001", inputTokens: 100, outputTokens: 50 }),
      userLine({ uuid: "u2", timestamp: "2026-03-09T10:01:00.000Z" }),
      assistantLine({
        msgId: "msg_002",
        inputTokens: 200,
        outputTokens: 80,
        timestamp: "2026-03-09T10:01:01.000Z",
      }),
    ].join("\n");

    const result = parseSessionContent(content, "sess-1", "-proj");
    expect(result).not.toBeNull();
    expect(result!.totalInputTokens).toBe(300);
    expect(result!.totalOutputTokens).toBe(130);
    expect(result!.messageCount).toBe(4); // 2 user + 2 assistant
  });

  it("returns null for empty content", () => {
    const result = parseSessionContent("", "sess-1", "-proj");
    expect(result).toBeNull();
  });

  it("returns null for content with only queue operations", () => {
    const content = [queueLine()].join("\n");
    const result = parseSessionContent(content, "sess-1", "-proj");
    expect(result).toBeNull();
  });

  it("skips malformed JSON lines gracefully", () => {
    const content = [
      userLine(),
      "this is not json",
      assistantLine(),
      "{broken json",
    ].join("\n");

    const result = parseSessionContent(content, "sess-1", "-proj");
    expect(result).not.toBeNull();
    expect(result!.totalInputTokens).toBe(100);
    expect(result!.messageCount).toBe(2);
  });

  it("tracks the latest timestamp as lastActivity", () => {
    const content = [
      userLine({ timestamp: "2026-03-09T10:00:00.000Z" }),
      assistantLine({ timestamp: "2026-03-09T10:00:01.000Z" }),
      userLine({ uuid: "u2", timestamp: "2026-03-09T12:00:00.000Z" }),
      assistantLine({
        msgId: "msg_002",
        timestamp: "2026-03-09T12:00:01.000Z",
      }),
    ].join("\n");

    const result = parseSessionContent(content, "sess-1", "-proj");
    expect(result!.lastActivity).toBe("2026-03-09T12:00:01.000Z");
  });

  it("picks the last model seen", () => {
    const content = [
      userLine(),
      assistantLine({ msgId: "msg_001", model: "claude-haiku-4-5-20251001" }),
      userLine({ uuid: "u2" }),
      assistantLine({ msgId: "msg_002", model: "claude-opus-4-6" }),
    ].join("\n");

    const result = parseSessionContent(content, "sess-1", "-proj");
    expect(result!.model).toBe("claude-opus-4-6");
  });

  it("handles assistant message without usage gracefully", () => {
    const noUsageLine = JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-09T10:00:01.000Z",
      message: {
        id: "msg_001",
        model: "claude-sonnet-4-6",
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        // no usage field
      },
    });

    const content = [userLine(), noUsageLine].join("\n");
    const result = parseSessionContent(content, "sess-1", "-proj");
    // user message counted, assistant not counted (no usage)
    expect(result).not.toBeNull();
    expect(result!.messageCount).toBe(1);
    expect(result!.totalInputTokens).toBe(0);
    expect(result!.model).toBe("claude-sonnet-4-6");
  });

  it("converts projectDir dashes to path separators", () => {
    const content = [userLine(), assistantLine()].join("\n");
    const result = parseSessionContent(content, "sess-1", "-Users-alice-projects-my-app");
    expect(result!.projectPath).toBe("Users/alice/projects/my/app");
  });
});

// ──────────────────────────────────────────────
// getTodayTokens
// ──────────────────────────────────────────────

describe("getTodayTokens", () => {
  it("sums tokens for sessions active today", () => {
    const today = new Date().toISOString().slice(0, 10);
    const sessions: SessionUsage[] = [
      {
        sessionId: "s1",
        model: "m",
        totalInputTokens: 100,
        totalOutputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        messageCount: 2,
        lastActivity: `${today}T10:00:00.000Z`,
        projectPath: "proj",
      },
      {
        sessionId: "s2",
        model: "m",
        totalInputTokens: 200,
        totalOutputTokens: 80,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        messageCount: 2,
        lastActivity: `${today}T11:00:00.000Z`,
        projectPath: "proj",
      },
    ];
    expect(getTodayTokens(sessions)).toBe(430);
  });

  it("excludes sessions from other days", () => {
    const sessions: SessionUsage[] = [
      {
        sessionId: "s1",
        model: "m",
        totalInputTokens: 100,
        totalOutputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        messageCount: 2,
        lastActivity: "2020-01-01T10:00:00.000Z",
        projectPath: "proj",
      },
    ];
    expect(getTodayTokens(sessions)).toBe(0);
  });

  it("returns 0 for empty sessions", () => {
    expect(getTodayTokens([])).toBe(0);
  });
});

// ──────────────────────────────────────────────
// buildSummary
// ──────────────────────────────────────────────

describe("buildSummary", () => {
  it("aggregates totals across sessions", () => {
    const sessions: SessionUsage[] = [
      {
        sessionId: "s1",
        model: "m",
        totalInputTokens: 100,
        totalOutputTokens: 50,
        cacheCreationTokens: 10,
        cacheReadTokens: 20,
        messageCount: 2,
        lastActivity: "2020-01-01T10:00:00.000Z",
        projectPath: "p1",
      },
      {
        sessionId: "s2",
        model: "m",
        totalInputTokens: 200,
        totalOutputTokens: 80,
        cacheCreationTokens: 30,
        cacheReadTokens: 40,
        messageCount: 4,
        lastActivity: "2020-01-02T10:00:00.000Z",
        projectPath: "p2",
      },
    ];
    const summary = buildSummary(sessions);

    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(130);
    expect(summary.totalCacheCreationTokens).toBe(40);
    expect(summary.totalCacheReadTokens).toBe(60);
    expect(summary.totalTokens).toBe(430);
    expect(summary.sessions).toHaveLength(2);
  });

  it("returns zero summary for empty sessions", () => {
    const summary = buildSummary([]);
    expect(summary.totalTokens).toBe(0);
    expect(summary.estimatedUsageRatio).toBe(0);
    expect(summary.sessions).toHaveLength(0);
  });

  it("caps estimatedUsageRatio at 1.0", () => {
    const today = new Date().toISOString().slice(0, 10);
    const sessions: SessionUsage[] = [
      {
        sessionId: "s1",
        model: "m",
        totalInputTokens: ESTIMATED_DAILY_TOKEN_LIMIT,
        totalOutputTokens: ESTIMATED_DAILY_TOKEN_LIMIT,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        messageCount: 2,
        lastActivity: `${today}T10:00:00.000Z`,
        projectPath: "proj",
      },
    ];
    const summary = buildSummary(sessions);
    expect(summary.estimatedUsageRatio).toBe(1.0);
  });
});

// ──────────────────────────────────────────────
// getProjectsDirs
// ──────────────────────────────────────────────

describe("getProjectsDirs", () => {
  const originalEnv = process.env.CLAUDE_CONFIG_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalEnv;
    }
  });

  it("includes legacy and config paths", () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    const dirs = getProjectsDirs();
    const home = os.homedir();
    expect(dirs).toContain(path.join(home, ".claude", "projects"));
    expect(dirs).toContain(path.join(home, ".config", "claude", "projects"));
  });

  it("includes CLAUDE_CONFIG_DIR when set", () => {
    process.env.CLAUDE_CONFIG_DIR = "/custom/claude";
    const dirs = getProjectsDirs();
    expect(dirs).toContain("/custom/claude/projects");
  });
});

// ──────────────────────────────────────────────
// parseClaudeUsage (integration with real temp files)
// ──────────────────────────────────────────────

describe("parseClaudeUsage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccusage-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses sessions from a temp directory structure", () => {
    const projDir = path.join(tmpDir, "-home-user-myproject");
    fs.mkdirSync(projDir, { recursive: true });

    const content = [
      userLine({ timestamp: "2026-03-09T10:00:00.000Z" }),
      assistantLine({
        msgId: "msg_001",
        inputTokens: 500,
        outputTokens: 200,
        cacheCreate: 1000,
        cacheRead: 2000,
        timestamp: "2026-03-09T10:00:01.000Z",
      }),
    ].join("\n");

    fs.writeFileSync(
      path.join(projDir, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
      content
    );

    const summary = parseClaudeUsage([tmpDir]);

    expect(summary.sessions).toHaveLength(1);
    expect(summary.sessions[0].totalInputTokens).toBe(500);
    expect(summary.sessions[0].totalOutputTokens).toBe(200);
    expect(summary.sessions[0].cacheCreationTokens).toBe(1000);
    expect(summary.sessions[0].cacheReadTokens).toBe(2000);
    expect(summary.totalTokens).toBe(700);
  });

  it("handles multiple projects and sessions", () => {
    const proj1 = path.join(tmpDir, "-home-proj1");
    const proj2 = path.join(tmpDir, "-home-proj2");
    fs.mkdirSync(proj1, { recursive: true });
    fs.mkdirSync(proj2, { recursive: true });

    fs.writeFileSync(
      path.join(proj1, "sess-1.jsonl"),
      [userLine(), assistantLine({ msgId: "m1", inputTokens: 100, outputTokens: 50 })].join("\n")
    );
    fs.writeFileSync(
      path.join(proj2, "sess-2.jsonl"),
      [userLine(), assistantLine({ msgId: "m2", inputTokens: 200, outputTokens: 80 })].join("\n")
    );

    const summary = parseClaudeUsage([tmpDir]);
    expect(summary.sessions).toHaveLength(2);
    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(130);
  });

  it("deduplicates sessions across multiple project dirs", () => {
    // Same session ID in two different directories
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "ccusage-d1-"));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "ccusage-d2-"));

    try {
      const proj1 = path.join(dir1, "-proj");
      const proj2 = path.join(dir2, "-proj");
      fs.mkdirSync(proj1, { recursive: true });
      fs.mkdirSync(proj2, { recursive: true });

      const content = [
        userLine(),
        assistantLine({ msgId: "m1", inputTokens: 100, outputTokens: 50 }),
      ].join("\n");

      fs.writeFileSync(path.join(proj1, "same-session.jsonl"), content);
      fs.writeFileSync(path.join(proj2, "same-session.jsonl"), content);

      const summary = parseClaudeUsage([dir1, dir2]);
      // Should only count once
      expect(summary.sessions).toHaveLength(1);
      expect(summary.totalInputTokens).toBe(100);
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("returns empty summary when directory does not exist", () => {
    const summary = parseClaudeUsage(["/nonexistent/path"]);
    expect(summary.sessions).toHaveLength(0);
    expect(summary.totalTokens).toBe(0);
  });

  it("sorts sessions by lastActivity descending", () => {
    const proj = path.join(tmpDir, "-proj");
    fs.mkdirSync(proj, { recursive: true });

    fs.writeFileSync(
      path.join(proj, "old.jsonl"),
      [
        userLine({ timestamp: "2026-03-01T10:00:00.000Z" }),
        assistantLine({ msgId: "m1", timestamp: "2026-03-01T10:00:01.000Z" }),
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(proj, "new.jsonl"),
      [
        userLine({ timestamp: "2026-03-09T10:00:00.000Z" }),
        assistantLine({ msgId: "m2", timestamp: "2026-03-09T10:00:01.000Z" }),
      ].join("\n")
    );

    const summary = parseClaudeUsage([tmpDir]);
    expect(summary.sessions[0].sessionId).toBe("new");
    expect(summary.sessions[1].sessionId).toBe("old");
  });

  it("skips non-jsonl files", () => {
    const proj = path.join(tmpDir, "-proj");
    fs.mkdirSync(proj, { recursive: true });

    fs.writeFileSync(path.join(proj, "sessions-index.json"), "{}");
    fs.writeFileSync(
      path.join(proj, "sess.jsonl"),
      [userLine(), assistantLine()].join("\n")
    );

    const summary = parseClaudeUsage([tmpDir]);
    expect(summary.sessions).toHaveLength(1);
  });
});
