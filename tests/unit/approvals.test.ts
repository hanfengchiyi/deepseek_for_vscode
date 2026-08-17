/**
 * Tests for the approval answerer (`src/dsh-bridge/approvals.ts`).
 *
 * The answerer is an `approval/request` waterfall listener registered
 * through a mocked `ctx.on` (same posture as events.test.ts). The
 * captured listener is invoked directly with a hand-made request
 * envelope; `next()` is a stub so tests can tell delegation apart from
 * the answerer's own outcomes.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  answerApproval,
  cancelSessionApprovals,
  registerApprovalAnswerer,
  setApprovalSink,
} from "../../src/dsh-bridge/approvals";
import type { DshCtx } from "../../src/dsh-bridge/boot";
import type { WebviewEvent } from "../../src/shared/protocol";

type Outcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";

interface Req {
  agent?: { session?: { id?: string } };
  toolName: string;
  callId?: string;
  reason?: string;
  signal?: AbortSignal;
}

type Listener = (req: Req, next: () => Promise<Outcome>) => Promise<Outcome>;

function makeCtx() {
  let captured: Listener | undefined;
  const ctx = {
    on: (name: string, fn: Listener) => {
      if (name !== "approval/request") throw new Error(`unexpected event: ${name}`);
      captured = fn;
      return () => true;
    },
  } as unknown as DshCtx;
  return {
    ctx,
    answerer() {
      if (!captured) throw new Error("answerer was not registered");
      return captured;
    },
  };
}

function makeReq(sessionId = "sess-1") {
  const controller = new AbortController();
  return {
    req: {
      agent: { session: { id: sessionId } },
      toolName: "write_file",
      reason: "needs to write",
      signal: controller.signal,
    } satisfies Req,
    abort: () => controller.abort(),
  };
}

/** Extract the approvalId of the request the sink captured. */
function approvalIdOf(sink: ReturnType<typeof vi.fn>, call = 0): string {
  const ev = sink.mock.calls[call]?.[0] as WebviewEvent;
  if (ev.type !== "approval.request") throw new Error("no approval.request emitted");
  return ev.approvalId;
}

afterEach(() => {
  setApprovalSink(undefined);
});

describe("registerApprovalAnswerer", () => {
  it("delegates to next() when no webview sink is connected", async () => {
    const { ctx, answerer } = makeCtx();
    registerApprovalAnswerer(ctx);
    const next = vi.fn().mockResolvedValue("unavailable" as Outcome);
    await expect(answerer()(makeReq().req, next)).resolves.toBe("unavailable");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("emits approval.request and resolves allowed-once on allow", async () => {
    const { ctx, answerer } = makeCtx();
    registerApprovalAnswerer(ctx);
    const sink = vi.fn();
    setApprovalSink(sink);

    const outcome = answerer()(makeReq().req, () => Promise.resolve("unavailable" as Outcome));

    expect(sink).toHaveBeenCalledTimes(1);
    const ev = sink.mock.calls[0][0] as WebviewEvent;
    expect(ev).toMatchObject({
      v: 1,
      type: "approval.request",
      sessionId: "sess-1",
      toolName: "write_file",
      reason: "needs to write",
    });

    answerApproval(approvalIdOf(sink), true);
    await expect(outcome).resolves.toBe("allowed-once");
  });

  it("resolves rejected on reject", async () => {
    const { ctx, answerer } = makeCtx();
    registerApprovalAnswerer(ctx);
    const sink = vi.fn();
    setApprovalSink(sink);

    const outcome = answerer()(makeReq().req, () => Promise.resolve("unavailable" as Outcome));
    answerApproval(approvalIdOf(sink), false);
    await expect(outcome).resolves.toBe("rejected");
  });

  it("ignores answers for unknown ids", async () => {
    const { ctx, answerer } = makeCtx();
    registerApprovalAnswerer(ctx);
    const sink = vi.fn();
    setApprovalSink(sink);

    answerApproval("a-nope-0", true); // must not throw
    const outcome = answerer()(makeReq().req, () => Promise.resolve("unavailable" as Outcome));
    answerApproval(approvalIdOf(sink), true);
    await expect(outcome).resolves.toBe("allowed-once");
  });

  it("resolves cancelled when the request signal aborts", async () => {
    const { ctx, answerer } = makeCtx();
    registerApprovalAnswerer(ctx);
    const sink = vi.fn();
    setApprovalSink(sink);

    const { req, abort } = makeReq();
    const outcome = answerer()(req, () => Promise.resolve("unavailable" as Outcome));
    abort();
    await expect(outcome).resolves.toBe("cancelled");
  });

  it("cancelSessionApprovals cancels only that session's requests", async () => {
    const { ctx, answerer } = makeCtx();
    registerApprovalAnswerer(ctx);
    const sink = vi.fn();
    setApprovalSink(sink);

    const next = () => Promise.resolve("unavailable" as Outcome);
    const first = answerer()(makeReq("sess-1").req, next);
    const second = answerer()(makeReq("sess-2").req, next);

    cancelSessionApprovals("sess-1");
    await expect(first).resolves.toBe("cancelled");

    // sess-2's request is still parked; answering it settles normally.
    answerApproval(approvalIdOf(sink, 1), false);
    await expect(second).resolves.toBe("rejected");
  });

  it("disposer cancels parked requests", async () => {
    const { ctx, answerer } = makeCtx();
    const dispose = registerApprovalAnswerer(ctx);
    const sink = vi.fn();
    setApprovalSink(sink);

    const outcome = answerer()(makeReq().req, () => Promise.resolve("unavailable" as Outcome));
    dispose();
    await expect(outcome).resolves.toBe("cancelled");

    // A late answer for the torn-down request is ignored, not a crash.
    answerApproval(approvalIdOf(sink), true);
  });
});
