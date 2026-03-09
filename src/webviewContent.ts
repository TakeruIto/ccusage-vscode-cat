import { ClaudeUsageSummary } from "./claudeDataParser";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function getWebviewContent(summary: ClaudeUsageSummary): string {
  const usagePercent = Math.round(summary.estimatedUsageRatio * 100);
  // Cat animation speed: higher usage = faster cat (shorter duration)
  // Range: 2.0s (max usage) to 8.0s (no usage)
  const animDuration = Math.max(2.0, 8.0 - summary.estimatedUsageRatio * 6.0);
  const catFrameInterval = Math.max(80, 400 - summary.estimatedUsageRatio * 320);

  const sessionsHtml = summary.sessions
    .slice(0, 20)
    .map(
      (s) => `
      <tr>
        <td class="session-path" title="${s.projectPath}">${s.projectPath.split("/").pop() || s.projectPath}</td>
        <td><span class="model-badge">${s.model}</span></td>
        <td class="num">${formatNumber(s.totalInputTokens)}</td>
        <td class="num">${formatNumber(s.totalOutputTokens)}</td>
        <td class="num">${s.messageCount}</td>
        <td class="time">${new Date(s.lastActivity).toLocaleString()}</td>
      </tr>`
    )
    .join("");

  return /*html*/ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --accent: #f97316;
    --border: var(--vscode-widget-border, #333);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    color: var(--fg);
    background: var(--bg);
    padding: 20px;
  }
  h1 { font-size: 1.5em; margin-bottom: 8px; }
  h2 { font-size: 1.1em; margin: 20px 0 10px; color: var(--accent); }

  /* Cat animation area */
  .cat-area {
    position: relative;
    width: 100%;
    height: 120px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 16px 0;
    background: linear-gradient(to bottom, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
  }
  .ground {
    position: absolute;
    bottom: 0;
    width: 100%;
    height: 20px;
    background: #2d4a22;
  }
  .cat-container {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
  }
  .cat-sprite {
    font-size: 32px;
    line-height: 1;
    white-space: pre;
    font-family: monospace;
  }
  .stars {
    position: absolute;
    top: 8px;
    left: 0;
    width: 100%;
    height: 60px;
    pointer-events: none;
  }
  .star {
    position: absolute;
    color: #ffd700;
    font-size: 10px;
    animation: twinkle 2s ease-in-out infinite alternate;
  }
  @keyframes twinkle {
    from { opacity: 0.3; }
    to { opacity: 1; }
  }
  .speed-label {
    position: absolute;
    top: 6px;
    right: 12px;
    font-size: 11px;
    color: #ffd700;
    opacity: 0.8;
  }
  /* Scrolling ground lines */
  .ground-lines {
    position: absolute;
    bottom: 0;
    width: 200%;
    height: 20px;
    background: repeating-linear-gradient(
      90deg,
      transparent 0px,
      transparent 40px,
      #3a5a2e 40px,
      #3a5a2e 60px
    );
    animation: scroll-ground ${animDuration}s linear infinite;
  }
  @keyframes scroll-ground {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }

  /* Stats cards */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin: 16px 0;
  }
  .stat-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
    text-align: center;
  }
  .stat-value {
    font-size: 1.6em;
    font-weight: bold;
    color: var(--accent);
  }
  .stat-label {
    font-size: 0.85em;
    opacity: 0.7;
    margin-top: 4px;
  }

  /* Usage bar */
  .usage-bar-container {
    width: 100%;
    height: 24px;
    background: #222;
    border-radius: 12px;
    overflow: hidden;
    margin: 8px 0 4px;
    position: relative;
  }
  .usage-bar {
    height: 100%;
    border-radius: 12px;
    background: ${usagePercent > 80 ? "#ef4444" : usagePercent > 50 ? "#f97316" : "#22c55e"};
    transition: width 0.5s ease;
    width: ${usagePercent}%;
  }
  .usage-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 12px;
    font-weight: bold;
    color: white;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  }

  /* Table */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85em;
  }
  th, td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  th { opacity: 0.7; font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .time { font-size: 0.85em; opacity: 0.7; }
  .session-path {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .model-badge {
    background: #2563eb22;
    color: #60a5fa;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.85em;
    font-family: monospace;
  }
</style>
</head>
<body>
  <h1>Claude Code Usage Cat</h1>

  <div class="cat-area">
    <div class="stars" id="stars"></div>
    <span class="speed-label" id="speedLabel"></span>
    <div class="cat-container">
      <div class="cat-sprite" id="catSprite"></div>
    </div>
    <div class="ground">
      <div class="ground-lines"></div>
    </div>
  </div>

  <h2>Estimated Daily Usage</h2>
  <div class="usage-bar-container">
    <div class="usage-bar"></div>
    <div class="usage-text">${usagePercent}%</div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${formatNumber(summary.totalInputTokens)}</div>
      <div class="stat-label">Input Tokens</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${formatNumber(summary.totalOutputTokens)}</div>
      <div class="stat-label">Output Tokens</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${formatNumber(summary.totalCacheCreationTokens)}</div>
      <div class="stat-label">Cache Creation Tokens</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${formatNumber(summary.totalCacheReadTokens)}</div>
      <div class="stat-label">Cache Read Tokens</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${formatNumber(summary.totalTokens)}</div>
      <div class="stat-label">Total Tokens</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${summary.sessions.length}</div>
      <div class="stat-label">Sessions</div>
    </div>
  </div>

  <h2>Recent Sessions</h2>
  <table>
    <thead>
      <tr>
        <th>Project</th>
        <th>Model</th>
        <th class="num">Input</th>
        <th class="num">Output</th>
        <th class="num">Messages</th>
        <th>Last Active</th>
      </tr>
    </thead>
    <tbody>
      ${sessionsHtml || '<tr><td colspan="6" style="text-align:center;opacity:0.5">No sessions found</td></tr>'}
    </tbody>
  </table>

  <script>
    // Cat ASCII animation frames - running cat
    const catFrames = [
      [
        "  /\\\\_/\\\\  ",
        " ( o.o ) ",
        "  > ^ <  ",
        " /|   |\\\\",
        "(_|   |_)"
      ],
      [
        "  /\\\\_/\\\\  ",
        " ( o.o ) ",
        "  > ^ <  ",
        "  |/ \\\\|  ",
        "  /   \\\\  "
      ],
      [
        "  /\\\\_/\\\\  ",
        " ( -.- ) ",
        "  > ^ <  ",
        " /|   |\\\\",
        "/ |   | \\\\"
      ],
      [
        "  /\\\\_/\\\\  ",
        " ( o.o ) ",
        "  > ^ <  ",
        "  |\\\\  /| ",
        "  \\\\ \\\\/  "
      ]
    ];

    // Speed-based running frames (faster cat has more dynamic poses)
    const runFrames = [
      [
        "   /\\\\_/\\\\   ",
        "  =( o.o )= ",
        "   > ^ <   ",
        "   /| |\\\\   ",
        "  (_| |_)  "
      ],
      [
        "   /\\\\_/\\\\~  ",
        "  =( >.< )=",
        "    > ^ <  ",
        "  _/ / \\\\ \\\\",
        "     ~     "
      ],
      [
        "  ~/\\\\_/\\\\   ",
        "  =( o.o )=",
        "    > ^ <  ",
        "  \\\\/ \\\\  /|",
        "   ~      "
      ],
      [
        "   /\\\\_/\\\\~~ ",
        "  =( ^.^ )=",
        "    > ^ <  ",
        "  /  |  |\\\\ ",
        " ~  /    \\\\ "
      ]
    ];

    const usageRatio = ${summary.estimatedUsageRatio};
    const frameInterval = ${catFrameInterval};
    const frames = usageRatio > 0.3 ? runFrames : catFrames;

    const catSprite = document.getElementById('catSprite');
    const speedLabel = document.getElementById('speedLabel');

    // Speed label
    let speedText = '';
    if (usageRatio < 0.1) speedText = 'zzz... (sleeping)';
    else if (usageRatio < 0.3) speedText = 'walking...';
    else if (usageRatio < 0.6) speedText = 'trotting!';
    else if (usageRatio < 0.8) speedText = 'running!!';
    else speedText = 'SPRINTING!!!';
    speedLabel.textContent = speedText;

    let frameIndex = 0;
    function animateCat() {
      catSprite.textContent = frames[frameIndex % frames.length].join('\\n');
      frameIndex++;
    }
    animateCat();
    setInterval(animateCat, frameInterval);

    // Generate stars
    const starsEl = document.getElementById('stars');
    for (let i = 0; i < 15; i++) {
      const star = document.createElement('span');
      star.className = 'star';
      star.textContent = Math.random() > 0.5 ? '.' : '*';
      star.style.left = Math.random() * 100 + '%';
      star.style.top = Math.random() * 100 + '%';
      star.style.animationDelay = Math.random() * 2 + 's';
      starsEl.appendChild(star);
    }
  </script>
</body>
</html>`;
}
