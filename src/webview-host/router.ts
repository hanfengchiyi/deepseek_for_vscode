import type * as vscode from "vscode";
import * as path from "node:path";
import type { HostCommand, PluginCatalogEntry, WebviewEvent } from "../shared/protocol";
import type { DshHandle, RuntimePluginInfo } from "../dsh-bridge/boot";
import type { PluginInfo } from "../dsh-bridge/plugins";
import { cancelTurn, pushUserMessage } from "../dsh-bridge/agents";
import { answerApproval, cancelSessionApprovals } from "../dsh-bridge/approvals";
import { answerQuestion, cancelSessionQuestions } from "../dsh-bridge/ask-user";
import { dshHome } from "../dsh-bridge/boot";
import { listHostCommands, runHostCommand } from "../dsh-bridge/commands";
import { setApiKey } from "../dsh-bridge/credentials";
import { findSessionLog } from "../dsh-bridge/export-log";
import { listHistory, loadSessionPreset, loadSessionStats, loadTranscript } from "../dsh-bridge/history";
import { getModelCatalog, selectModel } from "../dsh-bridge/models";
import { getPreset, setPreset } from "../dsh-bridge/permissions";
import { readDisabledPlugins, setPluginEnabled } from "../dsh-bridge/plugin-config";
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
  /** Boot-time user-plugin load outcomes; drives the plugin panel. */
  plugins?: PluginInfo[];
  /** Boot outcomes of the runtime plugin set; drives the plugin panel. */
  runtimePlugins?: RuntimePluginInfo[];
  /** Workspace root; stamps session export lookups with the right
   *  project directory. */
  workspaceRoot?: string;
}

/** Host capabilities the router needs beyond the webview channel.
 *  `promptSecret` shows a native (host-side) secret input so key
 *  material never transits the webview DOM. `openPluginsDir` reveals
 *  the plugins directory in the OS file manager. `pickFiles` shows a
 *  native file picker and reads the chosen text files; binary or
 *  oversize picks are named in `skipped`. `saveFile` copies `sourcePath`
 *  to a destination chosen through a native save dialog (returns false
 *  when cancelled). `reloadWindow` reloads the extension host window. */
export interface RouterDeps {
  promptSecret?: (title: string) => Promise<string | undefined>;
  openPluginsDir?: () => void;
  pickFiles?: () => Promise<{
    files: Array<{ name: string; content: string }>;
    skipped?: string[];
  }>;
  saveFile?: (defaultName: string, sourcePath: string) => Promise<boolean>;
  reloadWindow?: () => void;
}

/** Merge the runtime set (with live enabled flags from the config file)
 *  and the user-plugin outcomes into one wire catalog. */
async function buildPluginCatalog(dsh: RouterDsh): Promise<PluginCatalogEntry[]> {
  const disabled = await readDisabledPlugins(dshHome());
  const runtime: PluginCatalogEntry[] = (dsh.runtimePlugins ?? []).map((p) => ({
    scope: "runtime",
    id: p.id,
    name: p.name,
    description: p.description,
    required: p.required,
    enabled: p.required || !disabled.has(p.id),
    status: p.status,
    ...(p.error ? { error: p.error } : null),
  }));
  const user: PluginCatalogEntry[] = (dsh.plugins ?? []).map((p) => ({
    scope: "user",
    id: p.id,
    path: p.path,
    status: p.status,
    ...(p.error ? { error: p.error } : null),
  }));
  return [...runtime, ...user];
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
      const handle = await dsh;
      const { ctx } = handle;
      switch (msg.type) {
        case "chat.send": {
          // Inline attachments ahead of the user's text so the agent
          // sees file contents as ordinary message context.
          const parts = (msg.attachments ?? []).map(
            (a) => `File: ${a.name}\n\`\`\`\n${a.content}\n\`\`\``,
          );
          parts.push(msg.text);
          await pushUserMessage(ctx, msg.sessionId, parts.join("\n\n"), msg.agentPreset);
          break;
        }
        case "chat.cancel":
          // Reject parked ask_user questions and approval cards first
          // so their tool executions unwind even if the upstream abort
          // lags.
          cancelSessionQuestions(msg.sessionId);
          cancelSessionApprovals(msg.sessionId);
          await cancelTurn(ctx, msg.sessionId);
          break;
        case "question.answer":
          answerQuestion(msg.questionId, msg.answer);
          break;
        case "approval.answer":
          answerApproval(msg.approvalId, msg.allow);
          break;
        case "permission.set":
          await view.webview.postMessage({
            v: 1,
            type: "permission.state",
            preset: setPreset(msg.preset),
          });
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
          // Populate the model picker, the history panel, and the
          // plugin panel on first open; the transcript arrives via
          // `session.open` / chat.
          await view.webview.postMessage(await getModelCatalog(ctx));
          await view.webview.postMessage({
            v: 1,
            type: "session.history",
            sessions: await listHistory(ctx),
          });
          await view.webview.postMessage({
            v: 1,
            type: "plugin.catalog",
            plugins: await buildPluginCatalog(handle),
          });
          await view.webview.postMessage({
            v: 1,
            type: "permission.state",
            preset: getPreset(),
          });
          break;
        case "plugin.list":
          await view.webview.postMessage({
            v: 1,
            type: "plugin.catalog",
            plugins: await buildPluginCatalog(handle),
          });
          break;
        case "plugin.setEnabled": {
          await setPluginEnabled(dshHome(), msg.id, msg.enabled);
          await view.webview.postMessage({
            v: 1,
            type: "plugin.catalog",
            plugins: await buildPluginCatalog(handle),
          });
          await view.webview.postMessage({
            v: 1,
            type: "command.result",
            sessionId: "",
            ok: true,
            text: `Plugin "${msg.id}" ${msg.enabled ? "enabled" : "disabled"} — reload the window to apply.`,
          });
          break;
        }
        case "host.reload":
          deps.reloadWindow?.();
          break;
        case "command.list":
          await view.webview.postMessage({
            v: 1,
            type: "command.catalog",
            sessionId: msg.sessionId,
            commands: listHostCommands(ctx, msg.sessionId),
          });
          break;
        case "command.run": {
          const outcome = await runHostCommand(ctx, msg.sessionId, msg.line);
          await view.webview.postMessage({
            v: 1,
            type: "command.result",
            sessionId: msg.sessionId,
            ok: outcome.ok,
            text: outcome.text,
          });
          break;
        }
        case "session.export": {
          const located = await findSessionLog(
            path.join(dshHome(), "sessions"),
            msg.sessionId,
            handle.workspaceRoot,
          );
          if (!located) {
            await view.webview.postMessage({
              v: 1,
              type: "command.result",
              sessionId: msg.sessionId,
              ok: false,
              text: "Nothing to export yet — this session has not been persisted.",
            });
            break;
          }
          const saved = deps.saveFile
            ? await deps.saveFile(located.fileName, located.path)
            : false;
          if (saved) {
            await view.webview.postMessage({
              v: 1,
              type: "command.result",
              sessionId: msg.sessionId,
              ok: true,
              text: `Session log exported (${located.fileName}).`,
            });
          }
          break;
        }
        case "plugin.openDir":
          deps.openPluginsDir?.();
          break;
        case "file.pick": {
          const picked = (await deps.pickFiles?.()) ?? { files: [] };
          await view.webview.postMessage({
            v: 1,
            type: "file.picked",
            files: picked.files,
            ...(picked.skipped?.length ? { skipped: picked.skipped } : null),
          });
          break;
        }
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
          const agentPreset = await loadSessionPreset(ctx, msg.sessionId);
          await view.webview.postMessage({
            v: 1,
            type: "session.transcript",
            sessionId: msg.sessionId,
            ...(agentPreset ? { agentPreset } : null),
            messages: await loadTranscript(ctx, msg.sessionId),
          });
          // Recover the session's cumulative stats from the cold log so
          // the stats bar matches what the live stream would have shown.
          await view.webview.postMessage({
            v: 1,
            type: "session.stats",
            sessionId: msg.sessionId,
            stats: await loadSessionStats(ctx, msg.sessionId),
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
