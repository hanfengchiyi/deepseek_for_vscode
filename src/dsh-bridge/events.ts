/**
 * Batched subscription to DSH's `session/event` Cordis event.
 *
 * The DSH runtime exposes the session store as a service on the Cordis
 * root context (`ctx.sessions`). Session log appends are NOT a method on
 * `ctx.sessions` — they are emitted on the context's built-in event bus
 * as `session/event`, declared in
 * `@deepseek-ai/dsh-session/lib/types/index.d.ts`:
 *
 *   'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
 *
 * `ctx.on(name, listener)` is a mixin of the internal `ctx.events` service
 * (see Cordis `reflect.ts`), so the bridge subscribes via the context
 * itself — not via `ctx.sessions.on(...)`. The listener receives
 * `(session, event)`; the event envelope is `{ type, seq, time, data }`
 * where `data` is the typed payload from `SessionEventMap[type]`.
 *
 * Responsibilities of this module:
 *   1. Subscribe to `session/event` on the Cordis context.
 *   2. Translate the raw `SessionEvent` envelope into the wire-protocol
 *      `WebviewEvent` (see `mapSessionEvent` for the handled subset;
 *      unhandled types are dropped).
 *   3. Buffer events and flush them in batches on a 16ms interval
 *      (configurable via `options.flushIntervalMs`).
 *   4. Return an `EventSubscription` whose `close()` is idempotent and
 *      tears down the listener + flush timer.
 */
import type { DshCtx } from "./boot";
import type { WebviewEvent } from "../shared/protocol";

export interface EventSubscription {
  close(): void;
}

export interface SubscribeOptions {
  /** How often the buffer is flushed to the sink. Default 16ms. */
  flushIntervalMs?: number;
}

/**
 * The subset of the Cordis `ctx.on` signature we depend on. The real
 * `ctx.on<K extends keyof Events>(name: K, listener: Events[K])` is
 * generic over the `Events` augmentation, but for the bridge we only
 * need a structural shape: register a `(session, event)` listener for
 * the `"session/event"` channel, get a disposer back. Declaring it
 * structurally keeps the bridge decoupled from the upstream
 * `Events` interface merge so the file compiles even when a new
 * DSH version adds more event channels.
 */
interface CordisLikeCtx {
  on(
    name: string,
    listener: (session: { id: string }, event: { type: string; data: unknown }) => void,
  ): () => boolean;
}

/**
 * The raw `SessionEvent` envelope as emitted by `ctx.sessions`. The
 * `data` field is the typed payload from `SessionEventMap[type]`;
 * `mapSessionEvent` consumes the subset the webview renders.
 */
interface RawSessionEvent {
  type: string;
  data?: unknown;
}

/**
 * Subscribe to DSH's `session/event` stream and deliver batched
 * `WebviewEvent[]` to the sink. The bridge translates raw events to
 * `WebviewEvent`; this module only handles batching.
 */
export function subscribeDshEvents(
  ctx: DshCtx,
  sink: (events: WebviewEvent[]) => void,
  options: SubscribeOptions = {},
): EventSubscription {
  const flushMs = options.flushIntervalMs ?? 16;
  const buffer: WebviewEvent[] = [];
  let closed = false;

  // Subscribe to the context's event bus. Cordis registers the listener
  // on the current fiber; disposing the fiber (or calling the returned
  // disposer) unregisters it. We hold the disposer in `subs` so
  // `close()` can tear it down even if the host never disposes the
  // underlying fiber.
  const cordis = ctx as unknown as CordisLikeCtx;
  const subs: Array<() => boolean> = [];
  if (typeof cordis.on === "function") {
    subs.push(
      cordis.on("session/event", (session, raw) => {
        const mapped = mapSessionEvent(session.id, raw);
        if (mapped) buffer.push(mapped);
      }),
    );
  }

  const timer = setInterval(() => {
    if (closed || buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    sink(batch);
  }, flushMs);

  return {
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      for (const dispose of subs) {
        try {
          dispose();
        } catch {
          /* disposer is best-effort; the buffer/timer are already stopped */
        }
      }
    },
  };
}

/**
 * Map a raw DSH `session/event` envelope to a `WebviewEvent`. Handled:
 *   - `assistant/chunk` → `stream.chunk`: `text-delta` fills `delta`,
 *     `reasoning-delta` fills `thinking`; other chunk kinds
 *     (`block-start` / `tool-call-delta` / …) are ignored at this
 *     layer — tool activity reaches the webview via the complete
 *     `tool/call` / `tool/result` events instead.
 *   - `step/end` → `stream.end` (closes the current streaming message).
 *   - `tool/call` → `tool.call` (raw arguments JSON, unparsed).
 *   - `tool/result` → `tool.result` (flattened text; `ok` reflects both
 *     the event's `error` identity and the result block's `isError`).
 *   - `assistant/message` → `message.usage` when the adapter reported
 *     token accounting.
 *   - `turn/end` → `turn.end` (drives the webview's busy/stop state;
 *     covers cancel, failure, and multi-step completion alike).
 *
 * All other event types (`turn/start`, `user/message`, `todo/write`, …)
 * are dropped here; a later milestone can add mappings as needed.
 */
function mapSessionEvent(
  sessionId: string,
  raw: RawSessionEvent,
): WebviewEvent | null {
  const data = raw.data as
    | {
        turn?: number;
        step?: number;
        chunk?: { type: string; text?: string; index?: number };
        callId?: string;
        name?: string;
        arguments?: string;
        message?: {
          source?: { kind?: string; callId?: string };
          content?: Array<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }>;
        };
        error?: { name: string; code: string };
        usage?: {
          inputTokens: number;
          outputTokens: number;
          reasoningTokens?: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        };
        reason?: { kind?: string; error?: { message?: string; code?: string } };
      }
    | undefined;
  if (!data) return null;

  // The Cordis `session/event` envelope does not carry a stable
  // message id on every chunk; the webview pairs events through this
  // synthetic per-step id shared by `stream.chunk` / `stream.end` /
  // `tool.call` / `tool.result` / `message.usage`.
  const messageId = `step-${data.turn ?? 0}-${data.step ?? 0}`;

  switch (raw.type) {
    case "assistant/chunk": {
      const chunk = data.chunk;
      if (!chunk || typeof chunk.text !== "string") return null;
      if (chunk.type === "text-delta") {
        return { v: 1, type: "stream.chunk", sessionId, messageId, delta: chunk.text };
      }
      if (chunk.type === "reasoning-delta") {
        return { v: 1, type: "stream.chunk", sessionId, messageId, delta: "", thinking: chunk.text };
      }
      return null;
    }
    case "step/end": {
      return { v: 1, type: "stream.end", sessionId, messageId };
    }
    case "tool/call": {
      if (typeof data.callId !== "string" || typeof data.name !== "string") return null;
      return {
        v: 1,
        type: "tool.call",
        sessionId,
        messageId,
        callId: data.callId,
        name: data.name,
        arguments: typeof data.arguments === "string" ? data.arguments : "",
      };
    }
    case "tool/result": {
      // Unlike `tool/call`, the result event has no top-level `callId`;
      // correlation lives on the carried message's source
      // (`data.message.source.callId`, see SessionEventMap).
      const callId = data.message?.source?.callId;
      if (typeof callId !== "string") return null;
      const block = data.message?.content?.[0];
      const isError = Boolean(data.error) || Boolean(block?.isError);
      const content = (block?.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n");
      return {
        v: 1,
        type: "tool.result",
        sessionId,
        messageId,
        callId,
        ok: !isError,
        content: content || (data.error ? `${data.error.name}: ${data.error.code}` : ""),
      };
    }
    case "assistant/message": {
      if (!data.usage) return null;
      return { v: 1, type: "message.usage", sessionId, messageId, usage: data.usage };
    }
    case "turn/end": {
      const kind = typeof data.reason?.kind === "string" ? data.reason.kind : "unknown";
      const detail = data.reason?.error?.message;
      return {
        v: 1,
        type: "turn.end",
        sessionId,
        reason: kind,
        ...(kind === "error" && typeof detail === "string" ? { error: detail } : null),
      };
    }
    default:
      return null;
  }
}
