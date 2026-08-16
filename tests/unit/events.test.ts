/**
 * Batched subscription to DSH's `session/event` Cordis event.
 *
 * The DSH runtime registers `ctx.sessions` as a service on the Cordis root
 * context, but session events are emitted on the context's built-in event
 * bus — `ctx.on("session/event", listener)`, NOT `ctx.sessions.on(...)`.
 * `ctx.on()` is a mixin of the internal `ctx.events` service (see Cordis
 * `reflect.ts`), so it lives on the context itself. The listener receives
 * `(session, event)` where `event.type` is one of the SessionEventMap keys
 * and `event.data` carries the typed payload.
 *
 * These tests mock `ctx.on` to keep the bridge test independent of the
 * upstream runtime — the real boot is exercised separately in
 * `boot.real.test.ts`.
 */
import { describe, it, expect, vi } from "vitest";
import { subscribeDshEvents } from "../../src/dsh-bridge/events";
import type { DshCtx } from "../../src/dsh-bridge/boot";

/**
 * Build a minimal Cordis-like ctx whose `ctx.on(name, listener)` records
 * every registration and returns a disposer that removes that registration
 * from the listener list. Tests invoke registered listeners directly to
 * simulate DSH dispatching a `session/event` for a given session.
 *
 * The real Cordis listener signature is `(session, event)`, so the mock
 * passes the two args through. The DSH session id is the bridge's only
 * carry-over from the `session` argument into the WebviewEvent.
 */
function makeCtx() {
  type Listener = (
    session: { id: string },
    event: { type: string; data?: unknown },
  ) => void;
  const listeners: Listener[] = [];
  const ctx = {
    on: (_name: string, fn: Listener) => {
      listeners.push(fn);
      return () => {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  } as unknown as DshCtx;
  return { ctx, listeners };
}

describe("subscribeDshEvents", () => {
  it("batches multiple events into a single sink call", async () => {
    const { ctx, listeners } = makeCtx();
    const sink = vi.fn();
    const sub = subscribeDshEvents(ctx, sink, { flushIntervalMs: 16 });

    // Simulate the DSH runtime dispatching two `assistant/chunk` events
    // for the same session. The bridge translates the raw
    // `{ type, data }` envelope into a `stream.chunk` WebviewEvent and
    // buffers it.
    const session = { id: "sess-1" };
    listeners.forEach((l) =>
      l(session, {
        type: "assistant/chunk",
        data: { turn: 1, step: 1, chunk: { type: "text-delta", text: "hi" } },
      } as any),
    );
    listeners.forEach((l) =>
      l(session, {
        type: "assistant/chunk",
        data: { turn: 1, step: 1, chunk: { type: "text-delta", text: " there" } },
      } as any),
    );

    // Wait past one flush interval; both events must be batched into ONE
    // sink call carrying a 2-element array.
    await new Promise((r) => setTimeout(r, 30));
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].length).toBe(2);
    sub.close();
  });

  it("close() stops further flushes", async () => {
    const { ctx, listeners } = makeCtx();
    const sink = vi.fn();
    const sub = subscribeDshEvents(ctx, sink, { flushIntervalMs: 10 });
    // Close immediately: no listener should ever reach the sink.
    sub.close();
    listeners.forEach((l) =>
      l(
        { id: "sess-2" },
        { type: "step/end", data: { turn: 1, step: 1 } } as any,
      ),
    );
    await new Promise((r) => setTimeout(r, 25));
    expect(sink).not.toHaveBeenCalled();
  });

  // Dispatch one raw `session/event` and return the single mapped
  // WebviewEvent from the next flush.
  async function dispatch(
    event: { type: string; data?: unknown },
  ): Promise<unknown> {
    const { ctx, listeners } = makeCtx();
    const sink = vi.fn();
    const sub = subscribeDshEvents(ctx, sink, { flushIntervalMs: 5 });
    listeners.forEach((l) => l({ id: "sess-1" }, event as any));
    await new Promise((r) => setTimeout(r, 20));
    sub.close();
    expect(sink).toHaveBeenCalledTimes(1);
    return sink.mock.calls[0][0][0];
  }

  it("maps reasoning-delta chunks to stream.chunk thinking", async () => {
    const ev = await dispatch({
      type: "assistant/chunk",
      data: { turn: 2, step: 1, chunk: { type: "reasoning-delta", text: "hmm" } },
    });
    expect(ev).toEqual({
      v: 1,
      type: "stream.chunk",
      sessionId: "sess-1",
      messageId: "step-2-1",
      delta: "",
      thinking: "hmm",
    });
  });

  it("maps tool/call to tool.call", async () => {
    const ev = await dispatch({
      type: "tool/call",
      data: { turn: 1, step: 1, callId: "c1", name: "bash", arguments: '{"cmd":"ls"}' },
    });
    expect(ev).toEqual({
      v: 1,
      type: "tool.call",
      sessionId: "sess-1",
      messageId: "step-1-1",
      callId: "c1",
      name: "bash",
      arguments: '{"cmd":"ls"}',
    });
  });

  it("maps tool/result to tool.result with flattened text", async () => {
    const ev = await dispatch({
      type: "tool/result",
      data: {
        turn: 1,
        step: 1,
        message: {
          source: { kind: "tool", callId: "c1" },
          content: [{ content: [{ type: "text", text: "file.txt" }] }],
        },
      },
    });
    expect(ev).toEqual({
      v: 1,
      type: "tool.result",
      sessionId: "sess-1",
      messageId: "step-1-1",
      callId: "c1",
      ok: true,
      content: "file.txt",
    });
  });

  it("maps tool/result with error identity to ok=false", async () => {
    const ev = await dispatch({
      type: "tool/result",
      data: {
        turn: 1,
        step: 1,
        message: {
          source: { kind: "tool", callId: "c1" },
          content: [{ content: [], isError: true }],
        },
        error: { name: "ToolError", code: "E_FAIL" },
      },
    });
    expect(ev).toMatchObject({ type: "tool.result", ok: false, content: "ToolError: E_FAIL" });
  });

  it("maps assistant/message with usage to message.usage", async () => {
    const ev = await dispatch({
      type: "assistant/message",
      data: {
        turn: 1,
        step: 1,
        message: {},
        usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 3, cacheReadTokens: 8 },
      },
    });
    expect(ev).toEqual({
      v: 1,
      type: "message.usage",
      sessionId: "sess-1",
      messageId: "step-1-1",
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 3, cacheReadTokens: 8 },
    });
  });

  it("maps turn/end to turn.end with the reason kind", async () => {
    const ev = await dispatch({
      type: "turn/end",
      data: { turn: 1, reason: { kind: "completed" } },
    });
    expect(ev).toEqual({ v: 1, type: "turn.end", sessionId: "sess-1", reason: "completed" });
  });

  it("maps turn/end error reasons to turn.end with the failure detail", async () => {
    const ev = await dispatch({
      type: "turn/end",
      data: {
        turn: 1,
        reason: { kind: "error", error: { message: "invalid API key", code: "INVALID_CREDENTIAL" } },
      },
    });
    expect(ev).toEqual({
      v: 1,
      type: "turn.end",
      sessionId: "sess-1",
      reason: "error",
      error: "invalid API key",
    });
  });
});
