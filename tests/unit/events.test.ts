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
});
