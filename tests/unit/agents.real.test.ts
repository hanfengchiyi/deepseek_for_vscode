/**
 * Real-stack regression test for the "send message" path:
 * bootDsh → getOrCreateSession → agent.followup.
 *
 * Guards against booting without the agent driver stack (`AgentLoop`
 * and its `tools` / `systemPrompt` injects): without them,
 * `AgentRegistry.create()` throws "no agent factory registered" and
 * every chat.send in the webview errors out.
 *
 * Uses the REAL upstream plugins (like boot.real.test.ts), no mocks.
 * `followup` only enqueues the message; the driver's LLM call is
 * expected to fail asynchronously without credentials, which is fine —
 * this test asserts creation and enqueueing, not the reply.
 */
import { describe, it, expect } from "vitest";
import { bootDsh } from "../../src/dsh-bridge/boot";
import { pushUserMessage } from "../../src/dsh-bridge/agents";

describe("pushUserMessage (real agent stack)", () => {
  it("creates an agent and enqueues a user message without throwing", async () => {
    const handle = await bootDsh();
    try {
      await expect(
        pushUserMessage(handle.ctx, "sess-real-send", "hello"),
      ).resolves.toBeUndefined();
    } finally {
      await handle.dispose();
    }
  }, 30000);
});
