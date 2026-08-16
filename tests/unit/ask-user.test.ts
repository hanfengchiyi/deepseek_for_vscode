/**
 * Tests for the `ask_user` bridge tool (`src/dsh-bridge/ask-user.ts`).
 *
 * The tool is registered through a mocked `ctx.tools.register` (same
 * posture as the workspace-tool tests); the captured definition's
 * `execute` is invoked directly with a hand-made `ToolRunContext`
 * (`signal` + `agent.session.id` are all the tool reads).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  answerQuestion,
  cancelSessionQuestions,
  registerAskUser,
  setAskUserSink,
} from "../../src/dsh-bridge/ask-user";
import type { DshCtx } from "../../src/dsh-bridge/boot";
import type { WebviewEvent } from "../../src/shared/protocol";

interface CapturedDefinition {
  name: string;
  execute: (args: unknown, exec: unknown) => Promise<unknown>;
}

function makeCtx() {
  let captured: CapturedDefinition | undefined;
  const ctx = {
    tools: {
      register: (def: CapturedDefinition) => {
        captured = def;
        return vi.fn();
      },
    },
  } as unknown as DshCtx;
  return {
    ctx,
    /** Lazy on purpose: only valid AFTER `registerAskUser(ctx)` ran. */
    definition() {
      if (!captured) throw new Error("ask_user was not registered");
      return captured;
    },
  };
}

function makeExec(sessionId = "sess-1") {
  const controller = new AbortController();
  return {
    exec: {
      signal: controller.signal,
      agent: { session: { id: sessionId } },
    },
    abort: () => controller.abort(),
  };
}

/** Extract the questionId of the request the sink captured. */
function questionIdOf(sink: ReturnType<typeof vi.fn>): string {
  const ev = sink.mock.calls[0]?.[0] as WebviewEvent;
  if (ev.type !== "question.request") throw new Error("no question.request emitted");
  return ev.questionId;
}

afterEach(() => {
  setAskUserSink(undefined);
});

describe("registerAskUser", () => {
  it("fails fast when no webview sink is connected", async () => {
    const handle = makeCtx();
    registerAskUser(handle.ctx);
    const { exec } = makeExec();
    await expect(
      handle.definition().execute({ question: "pick one" }, exec),
    ).rejects.toThrow("no chat view");
  });

  it("emits question.request and resolves with the answer", async () => {
    const handle = makeCtx();
    registerAskUser(handle.ctx);
    const sink = vi.fn();
    setAskUserSink(sink);

    const { exec } = makeExec();
    const result = handle.definition().execute(
      { question: "which env?", options: ["staging", "prod"] },
      exec,
    );

    expect(sink).toHaveBeenCalledTimes(1);
    const ev = sink.mock.calls[0][0] as WebviewEvent;
    expect(ev).toMatchObject({
      v: 1,
      type: "question.request",
      sessionId: "sess-1",
      question: "which env?",
      options: ["staging", "prod"],
    });

    answerQuestion(questionIdOf(sink), "prod");
    await expect(result).resolves.toBe("prod");
  });

  it("rejects when the turn aborts mid-question", async () => {
    const handle = makeCtx();
    registerAskUser(handle.ctx);
    const sink = vi.fn();
    setAskUserSink(sink);

    const { exec, abort } = makeExec();
    const result = handle.definition().execute({ question: "go on?" }, exec);
    // Attach the rejection expectation before aborting so the rejection
    // is never unhandled.
    const expectation = expect(result).rejects.toThrow("aborted");
    abort();
    await expectation;
  });

  it("cancelSessionQuestions rejects only that session's questions", async () => {
    const handle = makeCtx();
    registerAskUser(handle.ctx);
    const sink = vi.fn();
    setAskUserSink(sink);

    const definition = handle.definition();
    const first = definition.execute({ question: "q1" }, makeExec("sess-1").exec);
    const second = definition.execute({ question: "q2" }, makeExec("sess-2").exec);
    const firstExpectation = expect(first).rejects.toThrow("cancelled by the user");

    cancelSessionQuestions("sess-1");
    await firstExpectation;

    // sess-2's question is still parked; answering it settles normally.
    // (calls[0] was sess-1's request, already rejected above.)
    const ev = sink.mock.calls[1][0] as WebviewEvent;
    if (ev.type !== "question.request") throw new Error("no second question.request");
    answerQuestion(ev.questionId, "answer-2");
    await expect(second).resolves.toBe("answer-2");
  });

  it("disposer rejects parked questions and unregisters the tool", async () => {
    const handle = makeCtx();
    const dispose = registerAskUser(handle.ctx);
    const sink = vi.fn();
    setAskUserSink(sink);

    const result = handle.definition().execute({ question: "q" }, makeExec().exec);
    const expectation = expect(result).rejects.toThrow("unregistered");
    dispose();
    await expectation;

    // A late answer for the torn-down question is ignored, not a crash.
    answerQuestion(questionIdOf(sink), "too late");
  });
});
