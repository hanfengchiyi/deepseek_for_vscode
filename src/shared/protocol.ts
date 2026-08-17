/**
 * Wire protocol between the WebView and the extension host.
 *
 * Both directions are versioned with a `v` field. Bump `v` only for breaking
 * changes; additive fields on existing types are fine.
 *
 * Messages are JSON-serializable. Optional fields are genuinely optional;
 * `undefined` is preserved through `JSON.stringify` -> `JSON.parse` only when
 * the value was missing on the wire, which the receiver should treat as
 * "field not present".
 */

export const PROTOCOL_VERSION = 1 as const;

/** Selectable agent presets, stamped into `meta.agentPreset` when the
 *  host creates a session (the upstream harness interprets the value;
 *  the extension only records and displays it). A session's preset is
 *  chosen while the conversation is still empty and cannot change
 *  afterwards. */
export const AGENT_PRESETS: Array<{ id: string; label: string; description: string }> = [
  {
    id: "standard",
    label: "标准模式",
    description: "功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。",
  },
  {
    id: "ptc",
    label: "PTC 模式",
    description: "具备标准模式的全部能力，并通过 CodeModeSDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。",
  },
  {
    id: "minimal",
    label: "极简模式",
    description: "仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。",
  },
  {
    id: "creative",
    label: "创造模式",
    description: "用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。",
  },
];

/** Resolve a preset id to its display label; unknown ids display raw. */
export function agentPresetLabel(id: string): string {
  return AGENT_PRESETS.find((p) => p.id === id)?.label ?? id;
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ Inbound (webview 鈫?host) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface ChatSend {
  v: 1;
  type: "chat.send";
  sessionId: string;
  text: string;
  /** Text file attachments picked via `file.pick`; the host inlines
   *  their contents ahead of `text` before the agent sees them. */
  attachments?: Array<{ name: string; content: string }>;
  /** Agent preset chosen for this session (see {@link AGENT_PRESETS}).
   *  Only used when the host CREATES the agent (first `chat.send` of a
   *  fresh session); ignored once the session exists — a session's
   *  preset is immutable after creation. */
  agentPreset?: string;
}

export interface ChatCancel {
  v: 1;
  type: "chat.cancel";
  sessionId: string;
}

export interface ModelListRequest {
  v: 1;
  type: "model.list";
}

export interface ModelSelect {
  v: 1;
  type: "model.select";
  sessionId: string;
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** Ask the host to prompt for the provider API key and store it in the
 *  credentials service. Carries no key material — the host shows a
 *  native password input. */
export interface CredentialSet {
  v: 1;
  type: "credential.set";
}

export interface Ready {
  v: 1;
  type: "ready";
}

/** Ask the host for this workspace's persisted session history. */
export interface SessionList {
  v: 1;
  type: "session.list";
}

/** Resume a persisted session and load its transcript into the view. */
export interface SessionOpen {
  v: 1;
  type: "session.open";
  sessionId: string;
}

/** Start a fresh conversation. The host only acknowledges it — the new
 *  session id is minted webview-side and the agent is created lazily on
 *  the first `chat.send`. */
export interface SessionNew {
  v: 1;
  type: "session.new";
}

/** The user's answer to a `question.request` raised by the `ask_user`
 *  tool. `answer` is the picked option label or the free-text reply. */
export interface QuestionAnswer {
  v: 1;
  type: "question.answer";
  questionId: string;
  answer: string;
}

/** Ask the host for the user-plugin load outcomes from boot. */
export interface PluginListRequest {
  v: 1;
  type: "plugin.list";
}

/** Ask the host to reveal the plugins directory in the OS file manager. */
export interface PluginDirOpen {
  v: 1;
  type: "plugin.openDir";
}

/** The user's decision on an `approval.request` for a mutating tool. */
export interface ApprovalAnswer {
  v: 1;
  type: "approval.answer";
  approvalId: string;
  allow: boolean;
}

/** Switch the permission preset (read-only / workspace-write / full-access). */
export interface PermissionSet {
  v: 1;
  type: "permission.set";
  preset: string;
}

/** Ask the host to show a native file picker and read the chosen text
 *  files; the result returns via `file.picked`. */
export interface FilePick {
  v: 1;
  type: "file.pick";
}

/** Ask the host for the slash commands registered on the runtime command
 *  plane (`ctx.commands`) for this session's agent. */
export interface CommandListRequest {
  v: 1;
  type: "command.list";
  sessionId: string;
}

/** Execute one slash command line ("/compact") on the host command
 *  plane; the outcome returns via `command.result`. */
export interface CommandRun {
  v: 1;
  type: "command.run";
  sessionId: string;
  line: string;
}

/** Export this session's raw JSONL event log via a native save dialog;
 *  the outcome returns via `command.result`. */
export interface SessionExport {
  v: 1;
  type: "session.export";
  sessionId: string;
}

/** Enable or disable one runtime plugin. Persists to
 *  `$DSH_HOME/vscode-extension.json`; takes effect on window reload. */
export interface PluginSetEnabled {
  v: 1;
  type: "plugin.setEnabled";
  id: string;
  enabled: boolean;
}

/** Reload the extension host window (after plugin toggles). */
export interface HostReload {
  v: 1;
  type: "host.reload";
}

export type HostCommand =
  | ChatSend
  | ChatCancel
  | ModelListRequest
  | ModelSelect
  | CredentialSet
  | Ready
  | SessionList
  | SessionOpen
  | SessionNew
  | QuestionAnswer
  | PluginListRequest
  | PluginDirOpen
  | ApprovalAnswer
  | PermissionSet
  | FilePick
  | CommandListRequest
  | CommandRun
  | SessionExport
  | PluginSetEnabled
  | HostReload;

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ Outbound (host 鈫?webview) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface StreamChunk {
  v: 1;
  type: "stream.chunk";
  sessionId: string;
  /** Monotonically increasing per-session. The webview appends to the
   *  currently streaming assistant message with this id. */
  messageId: string;
  delta: string;
  thinking?: string;
}

export interface StreamEnd {
  v: 1;
  type: "stream.end";
  sessionId: string;
  messageId: string;
}

export interface SessionSnapshot {
  v: 1;
  type: "session.snapshot";
  sessionId: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
  }>;
}

export interface ErrorEvent {
  v: 1;
  type: "error";
  message: string;
  recoverable: boolean;
}

export interface ToolCall {
  v: 1;
  type: "tool.call";
  sessionId: string;
  /** Same synthetic id scheme as `StreamChunk` / `StreamEnd`; the call
   *  is rendered on the assistant message of the step that produced it. */
  messageId: string;
  /** Pairs this call with its `tool.result`. */
  callId: string;
  name: string;
  /** Raw JSON arguments string exactly as the model produced it. */
  arguments: string;
}

export interface ToolResult {
  v: 1;
  type: "tool.result";
  sessionId: string;
  /** Same synthetic id scheme as `StreamChunk` / `StreamEnd`. */
  messageId: string;
  callId: string;
  ok: boolean;
  /** Flattened text of the tool result message. */
  content: string;
}

export interface MessageUsage {
  v: 1;
  type: "message.usage";
  sessionId: string;
  /** Same synthetic id scheme as `StreamChunk` / `StreamEnd`. */
  messageId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

/** Cumulative per-session statistics, aggregated host-side from the raw
 *  session event stream (live) or replayed from the JSONL log (resumed
 *  sessions). Sent whenever the numbers change (live, batched with the
 *  16ms flush) and once after `session.transcript` on `session.open`. */
export interface SessionStats {
  v: 1;
  type: "session.stats";
  sessionId: string;
  stats: {
    /** Completed turns (`turn/end` count). */
    turns: number;
    /** Completed steps (`step/end` count). */
    steps: number;
    /** Wall time attributed to the model: step durations minus tool time. */
    llmMs: number;
    /** Wall time spent inside tool calls (`tool/call` → `tool/result`). */
    toolMs: number;
    /** Time-to-first-token per turn (`turn/start` → first chunk). */
    ttftMs: { avg: number; count: number } | null;
    /** outputTokens / llmMs, null until both are known. */
    outputTokensPerSec: number | null;
    inputTokens: number;
    outputTokens: number;
    /** cacheReadTokens / inputTokens in percent, null until known. */
    cacheHitPct: number | null;
  };
}

export interface TurnEnd {
  v: 1;
  type: "turn.end";
  sessionId: string;
  /** `TurnEndReason.kind` upstream: completed / aborted / error / … */
  reason: string;
  /** Human-readable failure detail when `reason === "error"`. */
  error?: string;
}

/** Raised by the `ask_user` tool while it waits for the user. The
 *  webview shows a question card; the answer returns via
 *  `question.answer` and becomes the tool result. */
export interface QuestionRequest {
  v: 1;
  type: "question.request";
  sessionId: string;
  /** Pairs this request with its `question.answer`. */
  questionId: string;
  question: string;
  /** Predefined choices; absent means free-text only. */
  options?: string[];
}

/** One entry of the plugin panel. Runtime plugins are the fixed set the
 *  extension boots (toggleable via `plugin.setEnabled` unless required);
 *  user plugins are loose Cordis modules from `$DSH_HOME/plugins`. */
export type PluginCatalogEntry =
  | {
      scope: "runtime";
      id: string;
      name: string;
      description: string;
      /** Required plugins cannot be disabled. */
      required: boolean;
      /** Configured state; takes effect on the next boot. */
      enabled: boolean;
      /** What actually happened this boot. */
      status: "mounted" | "disabled" | "error";
      error?: string;
    }
  | {
      scope: "user";
      id: string;
      path: string;
      status: "loaded" | "error";
      error?: string;
    };

/** Boot-time state of every runtime plugin plus the load outcome of
 *  every user plugin; mirrors `RuntimePluginInfo` in
 *  `dsh-bridge/boot.ts` and `PluginInfo` in `dsh-bridge/plugins.ts`. */
export interface PluginCatalog {
  v: 1;
  type: "plugin.catalog";
  plugins: PluginCatalogEntry[];
}

/** A mutating tool call is paused awaiting the user's decision. The
 *  webview shows an approval card; the answer returns via
 *  `approval.answer`. */
export interface ApprovalRequestEvent {
  v: 1;
  type: "approval.request";
  sessionId: string;
  /** Pairs this request with its `approval.answer`. */
  approvalId: string;
  toolName: string;
  reason?: string;
}

/** Current permission preset; sent on `ready` and after every
 *  `permission.set`. */
export interface PermissionState {
  v: 1;
  type: "permission.state";
  preset: string;
}

/** Answer to `file.pick`: the text files the user chose, read host-side.
 *  Binary or oversize files are named in `skipped`. */
export interface FilePicked {
  v: 1;
  type: "file.picked";
  files: Array<{ name: string; content: string }>;
  skipped?: string[];
}

/** Slash commands available on the host command plane (`/compact`, plus
 *  anything user plugins registered), answer to `command.list`. */
export interface CommandCatalog {
  v: 1;
  type: "command.catalog";
  sessionId: string;
  commands: Array<{ name: string; description: string }>;
}

/** Outcome of a host-side action (`command.run`, `session.export`,
 *  `plugin.setEnabled`); rendered as a system bubble in the chat. */
export interface CommandResultEvent {
  v: 1;
  type: "command.result";
  sessionId: string;
  ok: boolean;
  text: string;
}

export interface ModelCatalog {
  v: 1;
  type: "model.catalog";  /** Registered provider routes and their advertised models. A provider
   *  whose catalog could not be fetched (offline, missing credential)
   *  is listed with an empty `models` array. */
  providers: Array<{
    id: string;
    name: string;
    models: Array<{ id: string; name: string }>;
  }>;
  /** The selection new agents will boot with and the live agent of the
   *  current session switches to on its next step. */
  current: { provider: string; model: string; reasoningEffort?: string };
  /** Context capacity of the current exact route, when the adapter knows it. */
  contextWindow?: number;
  /** Selectable reasoning efforts of the current route, when exposed. */
  efforts?: Array<{ id: string; name: string }>;
  /** Whether the provider API key is configured in any credential layer. */
  hasCredential: boolean;
}

/** This workspace's persisted sessions, newest first. */
export interface SessionHistory {
  v: 1;
  type: "session.history";
  sessions: Array<{
    id: string;
    /** First user message, truncated; "(empty session)" when none. */
    title: string;
    createdAt: number;
  }>;
}

/** Full rebuilt transcript of one (resumed) session. Replaces the
 *  webview's current message list. */
export interface SessionTranscript {
  v: 1;
  type: "session.transcript";
  sessionId: string;
  /** The preset this session was created with (read from the persisted
   *  log header); absent for sessions that predate preset support. */
  agentPreset?: string;
  messages: Array<{
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
  }>;
}

export type WebviewEvent =
  | StreamChunk
  | StreamEnd
  | SessionSnapshot
  | ErrorEvent
  | ToolCall
  | ToolResult
  | MessageUsage
  | SessionStats
  | TurnEnd
  | QuestionRequest
  | ModelCatalog
  | SessionHistory
  | SessionTranscript
  | PluginCatalog
  | ApprovalRequestEvent
  | PermissionState
  | FilePicked
  | CommandCatalog
  | CommandResultEvent;
