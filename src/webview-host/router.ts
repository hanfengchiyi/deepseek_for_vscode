import type * as vscode from "vscode";
import type { HostCommand, WebviewEvent } from "../shared/protocol";
import type { DshHandle } from "../dsh-bridge/boot";

/** Shape of the panel we need; keeps the router testable without VS Code. */
export interface WebviewPanelLike {
  webview: { postMessage: (msg: WebviewEvent) => Thenable<boolean> };
  onDidReceiveMessage: (
    handler: (msg: HostCommand) => void,
  ) => vscode.Disposable;
}

/** Bridge handle the router needs. We extend DshHandle with whatever M1 needs
 *  to do: push to inbox. Real DSH integration is wired in M2. */
export interface RouterDsh {
  ctx: DshHandle["ctx"];
  pushInbox(item: { type: string; sessionId: string; text?: string }): void;
}

export function installRouter(
  panel: WebviewPanelLike,
  dsh: RouterDsh,
): vscode.Disposable {
  const sub = panel.onDidReceiveMessage(async (msg) => {
    if (!msg || msg.v !== 1) {
      await panel.webview.postMessage({
        v: 1,
        type: "error",
        message: `Protocol mismatch: expected v=1, got v=${(msg as { v?: number })?.v}`,
        recoverable: true,
      });
      return;
    }
    switch (msg.type) {
      case "chat.send":
        dsh.pushInbox({ type: "chat.send", sessionId: msg.sessionId, text: msg.text });
        break;
      case "chat.cancel":
        // Wired in a later milestone.
        break;
      case "ready":
        // The webview signals it has mounted and is ready to receive events.
        // M1 does not need a snapshot, but later milestones will.
        break;
    }
  });
  return sub;
}
