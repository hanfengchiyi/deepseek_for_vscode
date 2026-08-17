import * as vscode from "vscode";
import * as path from "node:path";
import { installRouter } from "./router";
import type { WebviewEvent } from "../shared/protocol";
import { setApprovalSink } from "../dsh-bridge/approvals";
import { setAskUserSink } from "../dsh-bridge/ask-user";
import { bootDsh, dshHome, type DshHandle } from "../dsh-bridge/boot";
import { subscribeDshEvents } from "../dsh-bridge/events";

export const CHAT_VIEW_TYPE = "dsh.chatView";

/**
 * Provides the chat webview as a sidebar view (contributed under the
 * `dsh` view container). Users can drag it to the secondary sidebar or
 * the panel; VS Code persists the placement.
 *
 * The DSH runtime is booted lazily on first resolve so the extension
 * activates cheaply; the boot failure is surfaced inside the webview as
 * a protocol `error` event.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private dsh: DshHandle | undefined;
  private booting: Promise<DshHandle> | undefined;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "src", "ui", "dist"),
      ],
    };
    webviewView.webview.html = renderHtml(this.extensionUri, webviewView.webview);
    void this.attach(webviewView);
  }

  public dispose(): void {
    void this.dsh?.dispose();
    this.dsh = undefined;
    this.booting = undefined;
  }

  private async attach(view: vscode.WebviewView): Promise<void> {
    // Boot the runtime and install the message router IMMEDIATELY with
    // the boot promise. The webview script sends `ready` as soon as it
    // loads — typically before boot finishes — and VS Code drops any
    // message posted before `onDidReceiveMessage` is registered. Router
    // handlers await the promise, so early commands stall instead of
    // disappearing (a dropped `ready` used to leave the model bar and
    // history panel permanently empty).
    const ws = vscode.workspace.workspaceFolders?.[0];
    const pluginsDir = path.join(dshHome(), "plugins");
    this.booting ??= bootDsh({
      workspace: ws ? { root: ws.uri.fsPath, name: ws.name } : undefined,
      pluginsDir,
    });
    const routerDsh = this.booting.then((dsh) => ({ ctx: dsh.ctx, plugins: dsh.plugins }));
    // The router consumes `routerDsh` only when a message arrives; if
    // boot fails before that, this keeps the rejection from going
    // unhandled (the router's own await still sees it).
    routerDsh.catch(() => {});
    const routerSub = installRouter(view, routerDsh, {
      // Native password input; the key never enters the webview DOM.
      // Stored via the credentials service at $DSH_HOME/.credentials.yaml.
      promptSecret: (title) =>
        Promise.resolve(
          vscode.window.showInputBox({
            title,
            prompt: "Stored in $DSH_HOME/.credentials.yaml",
            placeHolder: "sk-…",
            password: true,
            ignoreFocusOut: true,
          }),
        ),
      // Reveal $DSH_HOME/plugins so the user can drop Cordis plugins in.
      // Create it first — the folder doesn't exist until the first
      // plugin is added, and revealFileInOS fails on missing paths.
      openPluginsDir: () => {
        void vscode.workspace.fs
          .createDirectory(vscode.Uri.file(pluginsDir))
          .then(() =>
            vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(pluginsDir)),
          );
      },
    });
    view.onDidDispose(() => {
      setAskUserSink(undefined);
      setApprovalSink(undefined);
      routerSub.dispose();
    });

    let dsh: DshHandle;
    try {
      dsh = await this.booting;
      this.dsh = dsh;
    } catch (err) {
      // Allow a later resolve (or view reload) to retry the boot.
      this.booting = undefined;
      const message = err instanceof Error ? err.message : String(err);
      void view.webview.postMessage({
        v: 1,
        type: "error",
        message: vscode.l10n.t("DeepSeek Harness failed to start: {0}", message),
        recoverable: true,
      });
      return;
    }

    const eventSub = subscribeDshEvents(dsh.ctx, (events) => {
      for (const ev of events) {
        void view.webview.postMessage(ev);
      }
    });
    // `ask_user` executions and approval requests park until the
    // webview answers; the sinks carry their events into this view.
    const webviewSink = (ev: WebviewEvent) => void view.webview.postMessage(ev);
    setAskUserSink(webviewSink);
    setApprovalSink(webviewSink);
    view.onDidDispose(() => {
      eventSub.close();
    });
  }
}

function renderHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string {
  // Points at the webview bundle built by `pnpm run build:webview`; the
  // host fails gracefully if the file is missing.
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
