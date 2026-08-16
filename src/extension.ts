import * as vscode from "vscode";
import { openChatCommand } from "./commands/openChat";
import { ChatViewProvider, CHAT_VIEW_TYPE } from "./webview-host/view";

console.log("[dsh] extension module loaded");

export function activate(context: vscode.ExtensionContext): void {
  try {
    console.log("[dsh] activate() called");
    const chatProvider = new ChatViewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.commands.registerCommand("dsh.openChat", () => openChatCommand()),
      vscode.window.registerWebviewViewProvider(CHAT_VIEW_TYPE, chatProvider, {
        // Keep the webview (and its in-DOM chat state) alive when the
        // sidebar is hidden; without this, collapsing the view destroys
        // the page and the conversation UI resets.
        webviewOptions: { retainContextWhenHidden: true },
      }),
      chatProvider,
    );
    console.log("[dsh] chat view provider registered:", CHAT_VIEW_TYPE);
  } catch (err) {
    console.error("[dsh] activate() failed:", err);
    throw err;
  }
}

export function deactivate(): void {
  // Disposal is wired through context.subscriptions (including the
  // ChatViewProvider, which tears down the DSH handle).
}
