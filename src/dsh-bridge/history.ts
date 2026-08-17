/**
 * Per-project session history over the JSONL persistence backend.
 *
 * `ctx.sessionPersistence` (`dsh-session-persistence-jsonl`) files each
 * session's append-only log under a project directory derived from the
 * session's `meta.cwd` — `sessions.ts` stamps that with the VS Code
 * workspace root, so filtering `list()` by cwd yields exactly this
 * project's history.
 *
 *   - {@link listHistory} reads headers only (fast) and lazily inspects
 *     each log for its first user message to derive a display title.
 *   - {@link loadTranscript} reads one session's full event log and
 *     rebuilds the webview's message list with the same mapping rules
 *     the live event bridge uses (`events.ts`): chunk text/thinking
 *     aggregates per step, tool calls pair with their results, usage
 *     attaches to the step message.
 */
import type { DshCtx } from "./boot";
import { workspaceRoot } from "./workspace";
import { SessionStatsTracker } from "./stats";
import type { SessionStatsSnapshot } from "./stats";

/** Normalize a workspace path for comparison. The persisted header cwd
 *  and `workspaceRoot()` can differ in drive-letter case on Windows
 *  (`D:\…` from `process.cwd()` vs `d:\…` from `vscode.Uri.fsPath`);
 *  a strict `===` filter would then hide every past session. */
function sameWorkspace(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const norm = (p: string) =>
    process.platform === "win32" ? p.replace(/\//g, "\\").toLowerCase() : p;
  return norm(a) === norm(b);
}

/** One row of the history panel. */
export interface HistoryEntry {
  id: string;
  title: string;
  createdAt: number;
}

/** Webview-side message shape; structurally identical to the UI store's
 *  `ChatMessage` (kept redeclared so the bridge does not import UI code). */
export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: Array<{
    callId: string;
    name: string;
    arguments: string;
    result?: string;
    ok?: boolean;
  }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

interface SessionHeaderLike {
  id: string;
  createdAt: number;
  cwd?: string;
  /** The preset the session was created with (dsh-agent
   *  `CreateSessionOptions.meta.agentPreset`), persisted in the log
   *  header by the JSONL backend. Absent for older logs. */
  agentPreset?: string;
}

interface SessionEventLike {
  type: string;
  seq?: number;
  /** Unix epoch ms; drives the cold-log stats replay. */
  time?: number;
  data?: unknown;
}

interface PersistenceLike {
  list?: () => Promise<SessionHeaderLike[]>;
  inspect?: (id: string) => Promise<{ events: readonly SessionEventLike[] }>;
}

const HISTORY_LIMIT = 50;
const TITLE_LENGTH = 60;

function persistence(ctx: DshCtx): PersistenceLike {
  const svc = ctx.sessionPersistence as PersistenceLike | undefined;
  if (!svc || typeof svc.list !== "function") {
    throw new Error(
      "DSH ctx.sessionPersistence is not available — is the JSONL persistence plugin mounted?",
    );
  }
  return svc;
}

/** Extract the first user message's text from an event log. */
function firstUserText(events: readonly SessionEventLike[]): string | undefined {
  for (const ev of events) {
    if (ev.type !== "user/message") continue;
    const content = (ev.data as { content?: Array<{ type: string; text?: string }> })
      ?.content;
    const text = (content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return undefined;
}

/** List this workspace's persisted sessions, newest first, with titles
 *  derived from each session's first user message. */
export async function listHistory(ctx: DshCtx): Promise<HistoryEntry[]> {
  const svc = persistence(ctx);
  const root = workspaceRoot();
  const headers = (await svc.list!())
    .filter((h) => sameWorkspace(h.cwd, root))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, HISTORY_LIMIT);
  const entries: HistoryEntry[] = [];
  for (const header of headers) {
    let title = "(empty session)";
    try {
      const { events } = await svc.inspect!(header.id);
      const text = firstUserText(events);
      if (text) {
        title = text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH)}…` : text;
      }
    } catch {
      // A corrupt log should not sink the whole list; keep the row.
    }
    entries.push({ id: header.id, title, createdAt: header.createdAt });
  }
  return entries;
}

/**
 * Rebuild one persisted session's webview transcript. Live-stream state
 * (`streaming`) is meaningless for a cold log — every message is final.
 */
export async function loadTranscript(
  ctx: DshCtx,
  sessionId: string,
): Promise<TranscriptMessage[]> {
  const { events } = await persistence(ctx).inspect!(sessionId);
  return buildTranscript(events);
}

/** Read the preset a persisted session was created with, from its log
 *  header. Returns undefined for logs that predate preset support. */
export async function loadSessionPreset(
  ctx: DshCtx,
  sessionId: string,
): Promise<string | undefined> {
  const headers = (await persistence(ctx).list!()) ?? [];
  return headers.find((h) => h.id === sessionId)?.agentPreset;
}

/** Replay a persisted session's event log through the stats tracker to
 *  recover its cumulative stats (the cold-log counterpart of the live
 *  aggregation in `events.ts`). */
export async function loadSessionStats(
  ctx: DshCtx,
  sessionId: string,
): Promise<SessionStatsSnapshot> {
  const { events } = await persistence(ctx).inspect!(sessionId);
  const tracker = new SessionStatsTracker();
  for (const ev of events) tracker.observe(ev);
  return tracker.snapshot();
}

/** Pure mapping from a session event log to webview messages. Exported
 *  for unit tests; mirrors the handled subset of `mapSessionEvent` in
 *  `./events`. */
export function buildTranscript(
  events: readonly SessionEventLike[],
): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  const byStep = new Map<string, TranscriptMessage>();

  const stepMessage = (turn?: number, step?: number): TranscriptMessage => {
    const id = `step-${turn ?? 0}-${step ?? 0}`;
    let msg = byStep.get(id);
    if (!msg) {
      msg = { id, role: "assistant", content: "" };
      byStep.set(id, msg);
      messages.push(msg);
    }
    return msg;
  };

  for (const ev of events) {
    const data = ev.data as
      | {
          turn?: number;
          step?: number;
          content?: Array<{ type: string; text?: string }>;
          chunk?: { type: string; text?: string };
          callId?: string;
          name?: string;
          arguments?: string;
          message?: {
            source?: { kind?: string; callId?: string };
            content?: Array<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }>;
          };
          error?: { name: string; code: string };
          usage?: TranscriptMessage["usage"];
        }
      | undefined;
    if (!data) continue;

    switch (ev.type) {
      case "user/message": {
        const text = (data.content ?? [])
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("\n");
        if (text) {
          messages.push({ id: `u-${ev.seq ?? messages.length}`, role: "user", content: text });
        }
        break;
      }
      case "assistant/chunk": {
        const chunk = data.chunk;
        if (!chunk || typeof chunk.text !== "string") break;
        const msg = stepMessage(data.turn, data.step);
        if (chunk.type === "text-delta") msg.content += chunk.text;
        else if (chunk.type === "reasoning-delta") msg.thinking = (msg.thinking ?? "") + chunk.text;
        break;
      }
      case "tool/call": {
        if (typeof data.callId !== "string" || typeof data.name !== "string") break;
        const msg = stepMessage(data.turn, data.step);
        msg.toolCalls ??= [];
        if (!msg.toolCalls.some((c) => c.callId === data.callId)) {
          msg.toolCalls.push({
            callId: data.callId,
            name: data.name,
            arguments: typeof data.arguments === "string" ? data.arguments : "",
          });
        }
        break;
      }
      case "tool/result": {
        // No top-level `callId` here; correlation lives on the carried
        // message's source (`data.message.source.callId`).
        const callId = data.message?.source?.callId;
        if (typeof callId !== "string") break;
        const msg = stepMessage(data.turn, data.step);
        const call = msg.toolCalls?.find((c) => c.callId === callId);
        if (!call) break;
        const block = data.message?.content?.[0];
        call.ok = !data.error && !block?.isError;
        call.result =
          (block?.content ?? [])
            .filter((b) => b.type === "text" && typeof b.text === "string")
            .map((b) => b.text)
            .join("\n") ||
          (data.error ? `${data.error.name}: ${data.error.code}` : "");
        break;
      }
      case "assistant/message": {
        if (!data.usage) break;
        stepMessage(data.turn, data.step).usage = data.usage;
        break;
      }
      default:
        break;
    }
  }
  return messages;
}
