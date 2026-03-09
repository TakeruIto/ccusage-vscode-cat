import { describe, it, expect } from "vitest";
import { getWebviewContent } from "../webviewContent";
import type { ClaudeUsageSummary } from "../claudeDataParser";

function makeSummary(
  overrides: Partial<ClaudeUsageSummary> = {}
): ClaudeUsageSummary {
  return {
    sessions: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalTokens: 0,
    estimatedUsageRatio: 0,
    ...overrides,
  };
}

describe("getWebviewContent", () => {
  it("returns valid HTML with DOCTYPE", () => {
    const html = getWebviewContent(makeSummary());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("displays token counts", () => {
    const html = getWebviewContent(
      makeSummary({
        totalInputTokens: 12345,
        totalOutputTokens: 6789,
        totalCacheCreationTokens: 1000,
        totalCacheReadTokens: 2000,
        totalTokens: 19134,
      })
    );
    expect(html).toContain("12,345");
    expect(html).toContain("6,789");
    expect(html).toContain("1,000");
    expect(html).toContain("2,000");
    expect(html).toContain("19,134");
  });

  it("shows usage percentage", () => {
    const html = getWebviewContent(makeSummary({ estimatedUsageRatio: 0.42 }));
    expect(html).toContain("42%");
  });

  it("shows 0% for zero usage", () => {
    const html = getWebviewContent(makeSummary({ estimatedUsageRatio: 0 }));
    expect(html).toContain("0%");
  });

  it("shows 100% for max usage", () => {
    const html = getWebviewContent(makeSummary({ estimatedUsageRatio: 1.0 }));
    expect(html).toContain("100%");
  });

  it("shows sleeping label for low usage", () => {
    const html = getWebviewContent(makeSummary({ estimatedUsageRatio: 0.05 }));
    expect(html).toContain("sleeping");
  });

  it("shows SPRINTING label for high usage", () => {
    const html = getWebviewContent(makeSummary({ estimatedUsageRatio: 0.9 }));
    expect(html).toContain("SPRINTING");
  });

  it("renders session table rows", () => {
    const html = getWebviewContent(
      makeSummary({
        sessions: [
          {
            sessionId: "sess-1",
            model: "claude-opus-4-6",
            totalInputTokens: 500,
            totalOutputTokens: 200,
            cacheCreationTokens: 100,
            cacheReadTokens: 50,
            messageCount: 4,
            lastActivity: "2026-03-09T10:00:00.000Z",
            projectPath: "home/user/myproject",
          },
        ],
      })
    );
    expect(html).toContain("claude-opus-4-6");
    expect(html).toContain("myproject");
    expect(html).toContain("500");
    expect(html).toContain("200");
  });

  it("shows 'No sessions found' when no sessions", () => {
    const html = getWebviewContent(makeSummary({ sessions: [] }));
    expect(html).toContain("No sessions found");
  });

  it("uses red color for usage bar above 80%", () => {
    const html = getWebviewContent(makeSummary({ estimatedUsageRatio: 0.85 }));
    expect(html).toContain("#ef4444");
  });

  it("uses orange color for usage bar between 50-80%", () => {
    const html = getWebviewContent(makeSummary({ estimatedUsageRatio: 0.65 }));
    expect(html).toContain("#f97316");
  });

  it("uses green color for usage bar below 50%", () => {
    const html = getWebviewContent(makeSummary({ estimatedUsageRatio: 0.3 }));
    expect(html).toContain("#22c55e");
  });

  it("includes cat animation script", () => {
    const html = getWebviewContent(makeSummary());
    expect(html).toContain("animateCat");
    expect(html).toContain("catFrames");
  });

  it("limits session display to 20", () => {
    const sessions = Array.from({ length: 25 }, (_, i) => ({
      sessionId: `sess-${i}`,
      model: "claude-sonnet-4-6",
      totalInputTokens: 100,
      totalOutputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      messageCount: 2,
      lastActivity: `2026-03-09T${String(i).padStart(2, "0")}:00:00.000Z`,
      projectPath: `proj-${i}`,
    }));

    const html = getWebviewContent(makeSummary({ sessions }));
    // Count table rows (each session generates a <tr>)
    const trCount = (html.match(/<tr>/g) || []).length;
    // 1 header <tr> + 20 data <tr> = 21
    expect(trCount).toBeLessThanOrEqual(21);
  });
});
