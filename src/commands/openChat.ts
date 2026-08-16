import * as vscode from "vscode";
import { ChatPanel } from "../webview-host/panel";
import { bootDsh, type DshHandle } from "../dsh-bridge/boot";

let dshHandle: DshHandle | undefined;

export async function openChatCommand(context: vscode.ExtensionContext): Promise<void> {
  if (!dshHandle) {
    try {
      dshHandle = await bootDsh({ profile: "headless" });
    } catch (err) {
      // Surface the boot failure with a remediation hint. A dedicated
      // welcome webview with the full error log lands in a later milestone;
      // for M1 a notification is enough to unblock the user.
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(
        vscode.l10n.t("DeepSeek Harness failed to start: {0}", message),
        vscode.l10n.t("Open Output"),
      ).then((choice) => {
        if (choice === vscode.l10n.t("Open Output")) {
          vscode.commands.executeCommand("workbench.action.output.grabFocus");
        }
      });
      return;
    }
    context.subscriptions.push({
      dispose: () => {
        void dshHandle?.dispose();
        dshHandle = undefined;
      },
    });
  }
  ChatPanel.createOrShow(context.extensionUri, dshHandle);
}
