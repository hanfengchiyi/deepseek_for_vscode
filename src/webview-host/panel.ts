import * as vscode from "vscode";
import * as path from "node:path";
import { installRouter, type WebviewPanelLike } from "./router";
import type { DshHandle } from "../dsh-bridge/boot";
import { subscribeDshEvents } from "../dsh-bridge/events";

const VIEW_TYPE = "dsh.chatPanel";

let singleton: ChatPanel | undefined;

export class ChatPanel {
  public static readonly viewType = VIEW_TYPE;

  public static createOrShow(extensionUri: vscode.Uri, dsh: DshHandle): ChatPanel {
    if (singleton) {
      singleton.panel.reveal();
      return singleton;
    }
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      "DeepSeek Harness",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "src", "ui", "dist")],
      },
    );
    singleton = new ChatPanel(panel, extensionUri, dsh);
    return singleton;
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly eventSub: { close(): void };

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    dsh: DshHandle,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.renderHtml(extensionUri, panel.webview);
    this.eventSub = subscribeDshEvents(dsh.ctx, (events) => {
      for (const ev of events) {
        void this.panel.webview.postMessage(ev);
      }
    });
    this.disposables.push(
      installRouter(this.panel as WebviewPanelLike, { ctx: dsh.ctx }),
      this.panel.onDidDispose(() => this.dispose(), null, this.disposables),
    );
  }

  public reveal(): void {
    this.panel.reveal();
  }

  public dispose(): void {
    if (singleton === this) singleton = undefined;
    this.eventSub.close();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      try {
        d?.dispose();
      } catch {
        /* ignore */
      }
    }
    this.panel.dispose();
  }

  private renderHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string {
    // The webview bundle will be created in Task 7. For now, we point at the
    // expected output file; the host fails gracefully if it is missing.
    const scriptPath = vscode.Uri.joinPath(
      extensionUri,
      "src",
      "ui",
      "dist",
      "assets",
      "index.js",
    );
    const scriptUri = webview.asWebviewUri(scriptPath);
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "src", "ui", "dist", "assets", "index.css"),
    );
    const csp = webview.cspSource;
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp};" />
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
