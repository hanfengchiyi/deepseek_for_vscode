import * as vscode from "vscode";

/**
 * Reveals the chat view's container. The view itself boots the DSH
 * runtime lazily when it resolves (see `ChatViewProvider`).
 */
export async function openChatCommand(): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.dsh");
}
