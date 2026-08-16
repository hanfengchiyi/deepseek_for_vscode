import type * as vscode from "vscode";
import type { HostCommand, WebviewEvent } from "../shared/protocol";
import type { DshHandle } from "../dsh-bridge/boot";
import { pushUserMessage } from "../dsh-bridge/agents";

/** Shape of the panel we need; keeps the router testable without VS Code. */
export interface WebviewPanelLike {
  webview: { postMessage: (msg: WebviewEvent) => Thenable<boolean> };
  onDidReceiveMessage: (
    handler: (msg: HostCommand) => void,
  ) => vscode.Disposable;
}

/** Bridge handle the router needs. The router only depends on the
 *  Cordis-shaped `ctx`; the inbox push is delegated to
 *  `pushUserMessage` in `../dsh-bridge/agents`. */
export interface RouterDsh {
  ctx: DshHandle["ctx"];
}

export function installRouter(
  panel: WebviewPanelLike,
  dsh: RouterDsh,
): vscode.Disposable {
  return panel.onDidReceiveMessage(async (msg) => {
    if (!msg || msg.v !== 1) {
      await panel.webview.postMessage({
        v: 1,
        type: "error",
        message: `Protocol mismatch: expected v=1, got v=${(msg as { v?: number })?.v}`,
        recoverable: true,
      });
      return;
    }
    try {
      switch (msg.type) {
        case "chat.send":
          await pushUserMessage(dsh.ctx, msg.sessionId, msg.text);
          break;
        case "chat.cancel":
          // Wired in a later milestone.
          break;
        case "ready":
          // Snapshot in a later milestone.
          break;
      }
    } catch (err) {
      await panel.webview.postMessage({
        v: 1,
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
    }
  });
}
