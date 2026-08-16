/**
 * Push a user message into the agent inbox of the given session.
 *
 * The brief assumed `ctx.agents.push({ session, text })` would deliver
 * the text. The real DSH 0.1.0-rc.6 API is more structured: the inbox
 * lives on the `Agent` (see
 * `node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts`),
 * and there is no `push` method on the registry. The canonical entry
 * point for a fresh user prompt is `agent.followup(userMessage)`, which
 * appends to the durable session log, queues the message as the sole
 * ordinary message of a new turn, and wakes the driver. The
 * `dsh-headless` one-shot runner uses exactly this pattern.
 *
 * The wire shape stays the same as the brief: `pushUserMessage(ctx,
 * sessionId, text)` resolves once the message has been enqueued. If the
 * runtime does not expose the expected `ctx.agents` registry, we fall
 * back to a warn-log (per the brief's "feature-detect and warn"
 * guidance) so the extension does not crash the host on a future DSH
 * version that renames the registry.
 */
import type { DshCtx } from "./boot";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { getOrCreateSession } from "./sessions";

/** Structural shape of the agent we depend on. The real `Agent` is
 *  richer; we only need the inbox method. */
interface AgentLike {
  followup?: (message: { id: string; role: "user"; content: unknown[]; source: { kind: "user" } }) => void;
}

/**
 * Deliver a webview-typed `text` payload into the durable session log
 * and the live agent inbox. Returns once the message has been enqueued
 * (the driver turn that consumes it is asynchronous and not awaited —
 * M1 only requires the message to be on the inbox; the response
 * streaming flows back through `subscribeDshEvents` in `events.ts`).
 */
export async function pushUserMessage(
  ctx: DshCtx,
  sessionId: string,
  text: string,
): Promise<void> {
  const session = await getOrCreateSession(ctx, sessionId);
  const agent = session.raw as AgentLike;
  if (typeof agent.followup !== "function") {
    // Fallback: log to host output. Integration test in Task 12 will
    // detect this — a real DSH build always has `agent.followup`.
    console.warn(
      "[dsh-bridge] agent.followup is not available on the live agent; " +
        "the message was not delivered to the agent loop.",
      { sessionId, text },
    );
    return;
  }
  // `createUserMessage` mints a stable MessageId and freezes the
  // payload so it is safe to share with the durable session log. The
  // `source: { kind: "user" }` tag is what the inbox and downstream
  // prompt assembly read to distinguish user prompts from tool
  // results and from system / plugin context.
  agent.followup(
    createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }) as never,
  );
}
