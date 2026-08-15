import * as vscode from "vscode";
import { openChatCommand } from "./commands/openChat";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("dsh.openChat", () => {
      vscode.window.showInformationMessage(
        vscode.l10n.t("DeepSeek Harness: openChat is not yet wired (M1 stub)."),
      );
      return openChatCommand();
    }),
  );
}

export function deactivate(): void {
  // no-op for M1; later milestones will dispose panel + DSH ctx
}
