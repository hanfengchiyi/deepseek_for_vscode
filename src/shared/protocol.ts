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

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ Inbound (webview 鈫?host) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface ChatSend {
  v: 1;
  type: "chat.send";
  sessionId: string;
  text: string;
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
  | PluginDirOpen;

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

/** Boot-time load outcome of every user plugin found in the plugins
 *  directory; mirrors `PluginInfo` in `dsh-bridge/plugins.ts`. */
export interface PluginCatalog {
  v: 1;
  type: "plugin.catalog";
  plugins: Array<{
    id: string;
    path: string;
    status: "loaded" | "error";
    error?: string;
  }>;
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
  | TurnEnd
  | QuestionRequest
  | ModelCatalog
  | SessionHistory
  | SessionTranscript
  | PluginCatalog;
