/**
 * Cumulative per-session statistics, derived purely from the raw session
 * event stream.
 *
 * The same tracker serves both paths that produce `session.stats`:
 *   - LIVE: `events.ts` feeds every raw `session/event` envelope through
 *     {@link SessionStatsTracker.observe} before mapping it to a wire
 *     event, and pushes a fresh snapshot into the same 16ms batch.
 *   - COLD: `history.ts` replays a persisted JSONL log through a new
 *     tracker to recover the stats of a resumed session.
 *
 * Timing relies on the envelope's `time` field (Unix epoch ms, see
 * `dsh-session/lib/types/types.d.ts`); events without it fall back to
 * the observation time, so a partially timestamped stream still yields
 * sane (if slightly fuzzier) numbers.
 *
 * Definitions:
 *   - turns / steps: counts of `turn/end` / `step/end`.
 *   - ttft: per turn, `turn/start` → first `assistant/chunk`.
 *   - tool time: `tool/call` → matching `tool/result` (paired by callId).
 *   - llm time: sum of step durations (turn start / previous `step/end`
 *     → `step/end`) minus tool time, clamped at zero.
 *   - tok/s: cumulative output tokens over llm time.
 *   - cache hit: cumulative cacheReadTokens over inputTokens.
 */
import type { SessionStats } from "../shared/protocol";

export type SessionStatsSnapshot = SessionStats["stats"];

/** The subset of the raw `SessionEvent` envelope the tracker reads. */
export interface StatsEvent {
  type: string;
  time?: number;
  data?: unknown;
}

interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

export class SessionStatsTracker {
  private turns = 0;
  private steps = 0;
  private stepMs = 0;
  private toolMs = 0;
  private ttftSum = 0;
  private ttftCount = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;

  /** `turn/start` time of the in-flight turn; null between turns. */
  private turnStart: number | null = null;
  /** Whether the in-flight turn already produced its first chunk. */
  private ttftSeen = false;
  /** Start of the in-flight step: turn start or the previous `step/end`. */
  private stepStart: number | null = null;
  /** In-flight tool calls: callId → `tool/call` time. */
  private pendingTools = new Map<string, number>();

  /** Feed one raw event. Returns true when the snapshot changed, i.e.
   *  a `session.stats` push is worthwhile. */
  observe(event: StatsEvent): boolean {
    const t = event.time ?? Date.now();
    const data = event.data as
      | {
          callId?: string;
          chunk?: { type?: string };
          message?: { source?: { callId?: string } };
          usage?: UsageLike;
        }
      | undefined;

    switch (event.type) {
      case "turn/start":
        this.turnStart = t;
        this.ttftSeen = false;
        this.stepStart ??= t;
        return true;
      case "assistant/chunk": {
        if (this.turnStart === null || this.ttftSeen) return false;
        const kind = data?.chunk?.type;
        if (kind !== "text-delta" && kind !== "reasoning-delta") return false;
        this.ttftSum += Math.max(0, t - this.turnStart);
        this.ttftCount += 1;
        this.ttftSeen = true;
        return true;
      }
      case "tool/call": {
        if (typeof data?.callId !== "string") return false;
        this.pendingTools.set(data.callId, t);
        return false; // Tool time only materializes at `tool/result`.
      }
      case "tool/result": {
        // `tool/result` carries no top-level callId; correlation lives on
        // the result message's source (same rule as `events.ts`).
        const callId = data?.message?.source?.callId;
        const start = typeof callId === "string" ? this.pendingTools.get(callId) : undefined;
        if (start === undefined) return false;
        this.pendingTools.delete(callId!);
        this.toolMs += Math.max(0, t - start);
        return true;
      }
      case "step/end": {
        this.steps += 1;
        if (this.stepStart !== null) {
          this.stepMs += Math.max(0, t - this.stepStart);
        }
        this.stepStart = t;
        return true;
      }
      case "turn/end":
        this.turns += 1;
        this.turnStart = null;
        this.stepStart = null;
        return true;
      case "assistant/message": {
        const usage = data?.usage;
        if (!usage) return false;
        this.inputTokens += usage.inputTokens ?? 0;
        this.outputTokens += usage.outputTokens ?? 0;
        this.cacheReadTokens += usage.cacheReadTokens ?? 0;
        return true;
      }
      default:
        return false;
    }
  }

  snapshot(): SessionStatsSnapshot {
    const llmMs = Math.max(0, this.stepMs - this.toolMs);
    return {
      turns: this.turns,
      steps: this.steps,
      llmMs,
      toolMs: this.toolMs,
      ttftMs:
        this.ttftCount > 0
          ? { avg: Math.round(this.ttftSum / this.ttftCount), count: this.ttftCount }
          : null,
      outputTokensPerSec:
        llmMs > 0 && this.outputTokens > 0
          ? Math.round(this.outputTokens / (llmMs / 1000))
          : null,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheHitPct:
        this.inputTokens > 0
          ? Math.round((this.cacheReadTokens / this.inputTokens) * 100)
          : null,
    };
  }
}
