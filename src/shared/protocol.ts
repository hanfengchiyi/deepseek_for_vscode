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

export interface Ready {
  v: 1;
  type: "ready";
}

export type HostCommand = ChatSend | ChatCancel | Ready;

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

export type WebviewEvent = StreamChunk | StreamEnd | SessionSnapshot | ErrorEvent;
