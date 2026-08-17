/**
 * Pure unit tests for `SessionStatsTracker` — hand-built event sequences
 * with explicit `time` values, covering turn/step counting, ttft
 * averaging, the llm/tool time split, token accumulation, tok/s and
 * cache-hit derivation. The same tracker backs both the live event
 * stream (`events.ts`) and the cold-log replay (`history.ts`), so the
 * replay path needs no separate test.
 */
import { describe, it, expect } from "vitest";
import { SessionStatsTracker } from "../../src/dsh-bridge/stats";

/** Shorthand for building a raw envelope with a timestamp. */
function ev(type: string, time: number, data?: unknown) {
  return { type, time, data };
}

describe("SessionStatsTracker", () => {
  it("counts turns and steps", () => {
    const t = new SessionStatsTracker();
    t.observe(ev("turn/start", 0));
    t.observe(ev("step/end", 1000));
    t.observe(ev("step/end", 2000));
    t.observe(ev("turn/end", 2000));
    t.observe(ev("turn/start", 3000));
    t.observe(ev("step/end", 4000));
    t.observe(ev("turn/end", 4000));
    const s = t.snapshot();
    expect(s.turns).toBe(2);
    expect(s.steps).toBe(3);
  });

  it("averages time-to-first-token per turn", () => {
    const t = new SessionStatsTracker();
    t.observe(ev("turn/start", 0));
    t.observe(ev("assistant/chunk", 1900, { chunk: { type: "text-delta", text: "a" } }));
    // Later chunks of the same turn must not double-count.
    t.observe(ev("assistant/chunk", 2500, { chunk: { type: "text-delta", text: "b" } }));
    t.observe(ev("turn/end", 3000));
    t.observe(ev("turn/start", 4000));
    t.observe(ev("assistant/chunk", 6100, { chunk: { type: "reasoning-delta", text: "r" } }));
    t.observe(ev("turn/end", 7000));
    expect(t.snapshot().ttftMs).toEqual({ avg: 2000, count: 2 });
  });

  it("splits step time into llm and tool time", () => {
    const t = new SessionStatsTracker();
    t.observe(ev("turn/start", 0));
    t.observe(ev("tool/call", 1000, { callId: "c1", name: "bash" }));
    t.observe(
      ev("tool/result", 3000, { message: { source: { kind: "tool", callId: "c1" } } }),
    );
    t.observe(ev("step/end", 5000));
    t.observe(ev("turn/end", 5000));
    const s = t.snapshot();
    expect(s.toolMs).toBe(2000);
    // Step spans 0→5000; 2000ms of it was the tool call.
    expect(s.llmMs).toBe(3000);
  });

  it("accumulates usage and derives tok/s and cache hit", () => {
    const t = new SessionStatsTracker();
    t.observe(ev("turn/start", 0));
    t.observe(ev("step/end", 2000));
    t.observe(ev("assistant/message", 2000, {
      usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 800 },
    }));
    t.observe(ev("turn/end", 2000));
    const s = t.snapshot();
    expect(s.inputTokens).toBe(1000);
    expect(s.outputTokens).toBe(100);
    expect(s.cacheHitPct).toBe(80);
    // 100 tokens over 2000ms of llm time → 50 tok/s.
    expect(s.outputTokensPerSec).toBe(50);
  });

  it("clamps llm time at zero when tools overran the step window", () => {
    const t = new SessionStatsTracker();
    t.observe(ev("turn/start", 0));
    // Tool starts before the step window we measure and ends inside it.
    t.observe(ev("tool/call", 0, { callId: "c1" }));
    t.observe(
      ev("tool/result", 9000, { message: { source: { callId: "c1" } } }),
    );
    t.observe(ev("step/end", 5000));
    t.observe(ev("turn/end", 5000));
    expect(t.snapshot().llmMs).toBe(0);
  });

  it("reports nulls before any timing or usage data exists", () => {
    const s = new SessionStatsTracker().snapshot();
    expect(s).toEqual({
      turns: 0,
      steps: 0,
      llmMs: 0,
      toolMs: 0,
      ttftMs: null,
      outputTokensPerSec: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheHitPct: null,
    });
  });

  it("falls back to observation time when events carry no timestamp", () => {
    const t = new SessionStatsTracker();
    t.observe({ type: "turn/start" });
    t.observe({ type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "a" } } });
    t.observe({ type: "turn/end" });
    const s = t.snapshot();
    expect(s.turns).toBe(1);
    expect(s.ttftMs).not.toBeNull();
    expect(s.ttftMs!.avg).toBeGreaterThanOrEqual(0);
  });

  it("ignores unrelated events and orphan tool results", () => {
    const t = new SessionStatsTracker();
    expect(t.observe(ev("user/message", 0))).toBe(false);
    expect(
      t.observe(ev("tool/result", 1000, { message: { source: { callId: "nope" } } })),
    ).toBe(false);
    expect(t.snapshot().toolMs).toBe(0);
  });
});
