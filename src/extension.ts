import * as vscode from "vscode";
import { parseClaudeUsage } from "./claudeDataParser";
import { getWebviewContent } from "./webviewContent";

let panel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand("ccusage-cat.show", () => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.One);
      refreshPanel();
      return;
    }

    panel = vscode.window.createWebviewPanel(
      "ccusageCat",
      "Claude Code Usage Cat",
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    refreshPanel();

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      if (panel) {
        refreshPanel();
      }
    }, 30_000);

    panel.onDidDispose(() => {
      panel = undefined;
      clearInterval(interval);
    });
  });

  context.subscriptions.push(disposable);
}

function refreshPanel() {
  if (!panel) {
    return;
  }
  try {
    const summary = parseClaudeUsage();
    panel.webview.html = getWebviewContent(summary);
  } catch (err) {
    panel.webview.html = `<body style="padding:20px;color:#fff">
      <h2>Error loading Claude usage data</h2>
      <pre>${err}</pre>
    </body>`;
  }
}

export function deactivate() {
  // no-op
}
