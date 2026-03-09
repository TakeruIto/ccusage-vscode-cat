import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface SessionUsage {
  sessionId: string;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  messageCount: number;
  lastActivity: string;
  projectPath: string;
}

export interface ClaudeUsageSummary {
  sessions: SessionUsage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalTokens: number;
  /** Estimated usage ratio (0.0 - 1.0) based on token volume heuristic */
  estimatedUsageRatio: number;
}

// Rough daily token limit heuristic for display purposes
export const ESTIMATED_DAILY_TOKEN_LIMIT = 5_000_000;

/**
 * Returns all candidate directories where Claude Code stores project data.
 * Supports both legacy (~/.claude) and newer (~/.config/claude) paths,
 * as well as the CLAUDE_CONFIG_DIR environment variable override.
 */
export function getProjectsDirs(): string[] {
  const dirs: string[] = [];
  const home = os.homedir();

  // Environment variable override
  const envDir = process.env.CLAUDE_CONFIG_DIR;
  if (envDir) {
    dirs.push(path.join(envDir, "projects"));
  }

  // Legacy path
  dirs.push(path.join(home, ".claude", "projects"));

  // XDG / newer path
  dirs.push(path.join(home, ".config", "claude", "projects"));

  return dirs;
}

export function parseClaudeUsage(
  projectsDirs?: string[]
): ClaudeUsageSummary {
  const sessions: SessionUsage[] = [];
  const seenSessionIds = new Set<string>();
  const dirs = projectsDirs ?? getProjectsDirs();

  for (const projectsDir of dirs) {
    if (!fs.existsSync(projectsDir)) {
      continue;
    }

    let projectDirNames: string[];
    try {
      projectDirNames = fs.readdirSync(projectsDir);
    } catch {
      continue;
    }

    for (const projDir of projectDirNames) {
      const projPath = path.join(projectsDir, projDir);
      try {
        if (!fs.statSync(projPath).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      const files = fs.readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));

      for (const file of files) {
        const sessionId = file.replace(".jsonl", "");
        if (seenSessionIds.has(sessionId)) {
          continue;
        }
        seenSessionIds.add(sessionId);

        const filePath = path.join(projPath, file);
        const session = parseSessionFile(filePath, sessionId, projDir);
        if (session) {
          sessions.push(session);
        }
      }
    }
  }

  // Sort by last activity descending
  sessions.sort(
    (a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );

  return buildSummary(sessions);
}

export function buildSummary(sessions: SessionUsage[]): ClaudeUsageSummary {
  const totalInputTokens = sessions.reduce(
    (sum, s) => sum + s.totalInputTokens,
    0
  );
  const totalOutputTokens = sessions.reduce(
    (sum, s) => sum + s.totalOutputTokens,
    0
  );
  const totalCacheCreationTokens = sessions.reduce(
    (sum, s) => sum + s.cacheCreationTokens,
    0
  );
  const totalCacheReadTokens = sessions.reduce(
    (sum, s) => sum + s.cacheReadTokens,
    0
  );

  const todayTokens = getTodayTokens(sessions);
  const totalTokens = totalInputTokens + totalOutputTokens;
  const estimatedUsageRatio = Math.min(
    todayTokens / ESTIMATED_DAILY_TOKEN_LIMIT,
    1.0
  );

  return {
    sessions,
    totalInputTokens,
    totalOutputTokens,
    totalCacheCreationTokens,
    totalCacheReadTokens,
    totalTokens,
    estimatedUsageRatio,
  };
}

export function getTodayTokens(sessions: SessionUsage[]): number {
  const today = new Date().toISOString().slice(0, 10);
  return sessions
    .filter((s) => s.lastActivity.startsWith(today))
    .reduce(
      (sum, s) => sum + s.totalInputTokens + s.totalOutputTokens,
      0
    );
}

export function parseSessionFile(
  filePath: string,
  sessionId: string,
  projectDir: string
): SessionUsage | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return parseSessionContent(content, sessionId, projectDir);
  } catch {
    return null;
  }
}

/**
 * Parse session JSONL content string into a SessionUsage.
 * Exported for direct testing without filesystem dependency.
 */
export function parseSessionContent(
  content: string,
  sessionId: string,
  projectDir: string
): SessionUsage | null {
  const lines = content.trim().split("\n");

  let model = "unknown";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let messageCount = 0;
  let lastActivity = "";

  // Deduplicate by message ID: the same assistant response is split across
  // multiple JSONL lines (one per content block) but they all share the same
  // message.id and identical usage object. Only count each message ID once.
  const seenMessageIds = new Set<string>();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      if (entry.timestamp) {
        lastActivity = entry.timestamp;
      }

      if (entry.type === "user") {
        messageCount++;
      }

      if (entry.type === "assistant" && entry.message) {
        const msgId: string | undefined = entry.message.id;
        const usage = entry.message.usage;

        if (msgId && !seenMessageIds.has(msgId) && usage) {
          seenMessageIds.add(msgId);
          totalInputTokens += usage.input_tokens || 0;
          totalOutputTokens += usage.output_tokens || 0;
          cacheCreationTokens += usage.cache_creation_input_tokens || 0;
          cacheReadTokens += usage.cache_read_input_tokens || 0;
          messageCount++;
        }

        if (entry.message.model) {
          model = entry.message.model;
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (messageCount === 0) {
    return null;
  }

  return {
    sessionId,
    model,
    totalInputTokens,
    totalOutputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    messageCount,
    lastActivity,
    projectPath: projectDir.replace(/-/g, "/").replace(/^\//, ""),
  };
}
