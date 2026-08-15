import * as vscode from "vscode";

/**
 * M1 stub. In M1 this only shows an information message.
 * Later milestones will create / focus the chat WebView panel.
 */
export function openChatCommand(): Thenable<void> {
  return vscode.window.showInformationMessage(
    vscode.l10n.t("DeepSeek Harness chat will open here."),
  );
}
