import type * as vscode from "vscode";
import type { HostCommand, WebviewEvent } from "../shared/protocol";
import type { DshHandle } from "../dsh-bridge/boot";
import { cancelTurn, pushUserMessage } from "../dsh-bridge/agents";
import { answerQuestion, cancelSessionQuestions } from "../dsh-bridge/ask-user";
import { setApiKey } from "../dsh-bridge/credentials";
import { listHistory, loadTranscript } from "../dsh-bridge/history";
import { getModelCatalog, selectModel } from "../dsh-bridge/models";
import { resumeSession } from "../dsh-bridge/sessions";

/** Shape of the webview view we need; keeps the router testable without
 *  VS Code. Mirrors the real `vscode.WebviewView` API. */
export interface WebviewViewLike {
  webview: {
    postMessage: (msg: WebviewEvent) => Thenable<boolean>;
    onDidReceiveMessage: (
      handler: (msg: HostCommand) => void,
    ) => vscode.Disposable;
  };
}

/** Bridge handle the router needs. The router only depends on the
 *  Cordis-shaped `ctx`; the inbox push and turn cancel are delegated to
 *  `pushUserMessage` / `cancelTurn` in `../dsh-bridge/agents`.
 *
 *  Accepted as a promise too: the webview script typically sends its
 *  first commands (`ready`, even `chat.send`) while the DSH boot is
 *  still in flight, and `onDidReceiveMessage` only starts delivering
 *  after the router is installed. Handlers await the promise, so early
 *  commands stall until boot completes instead of being dropped. */
export interface RouterDsh {
  ctx: DshHandle["ctx"];
}

/** Host capabilities the router needs beyond the webview channel.
 *  `promptSecret` shows a native (host-side) secret input so key
 *  material never transits the webview DOM. */
export interface RouterDeps {
  promptSecret?: (title: string) => Promise<string | undefined>;
}

export function installRouter(
  view: WebviewViewLike,
  dsh: RouterDsh | Promise<RouterDsh>,
  deps: RouterDeps = {},
): vscode.Disposable {
  return view.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || msg.v !== 1) {
      await view.webview.postMessage({
        v: 1,
        type: "error",
        message: `Protocol mismatch: expected v=1, got v=${(msg as { v?: number })?.v}`,
        recoverable: true,
      });
      return;
    }
    try {
      // Await the (possibly still booting) DSH handle. Boot failure
      // rejects here and surfaces as a protocol error event below.
      const { ctx } = await dsh;
      switch (msg.type) {
        case "chat.send":
          await pushUserMessage(ctx, msg.sessionId, msg.text);
          break;
        case "chat.cancel":
          // Reject parked ask_user questions first so their tool
          // executions unwind even if the upstream abort lags.
          cancelSessionQuestions(msg.sessionId);
          await cancelTurn(ctx, msg.sessionId);
          break;
        case "question.answer":
          answerQuestion(msg.questionId, msg.answer);
          break;
        case "model.list":
          await view.webview.postMessage(await getModelCatalog(ctx));
          break;
        case "model.select":
          await view.webview.postMessage(
            await selectModel(ctx, msg.sessionId, {
              provider: msg.provider,
              model: msg.model,
              reasoningEffort: msg.reasoningEffort,
            }),
          );
          break;
        case "credential.set": {
          if (!deps.promptSecret) {
            await view.webview.postMessage({
              v: 1,
              type: "error",
              message: "Host cannot prompt for credentials",
              recoverable: true,
            });
            break;
          }
          const key = await deps.promptSecret("DeepSeek API Key");
          if (key === undefined) break; // User cancelled the prompt.
          await setApiKey(ctx, key);
          await view.webview.postMessage(await getModelCatalog(ctx));
          break;
        }
        case "ready":
          // Populate the model picker and the history panel on first
          // open; the transcript arrives via `session.open` / chat.
          await view.webview.postMessage(await getModelCatalog(ctx));
          await view.webview.postMessage({
            v: 1,
            type: "session.history",
            sessions: await listHistory(ctx),
          });
          break;
        case "session.list":
          await view.webview.postMessage({
            v: 1,
            type: "session.history",
            sessions: await listHistory(ctx),
          });
          break;
        case "session.open": {
          // Bring the persisted session back as a live agent (so the user
          // can continue it), then rebuild the view from its event log.
          await resumeSession(ctx, msg.sessionId);
          await view.webview.postMessage({
            v: 1,
            type: "session.transcript",
            sessionId: msg.sessionId,
            messages: await loadTranscript(ctx, msg.sessionId),
          });
          break;
        }
        case "session.new":
          // The new id is minted webview-side and the agent is created
          // lazily on the first chat.send; just refresh the history list
          // so the panel reflects the latest state.
          await view.webview.postMessage({
            v: 1,
            type: "session.history",
            sessions: await listHistory(ctx),
          });
          break;
      }
    } catch (err) {
      await view.webview.postMessage({
        v: 1,
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
    }
  });
}
