import * as vscode from "vscode";
import { openChatCommand } from "./commands/openChat";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("dsh.openChat", () => openChatCommand(context)),
  );
}

export function deactivate(): void {
  // The DshHandle dispose is wired through the openChatCommand's subscription.
}
