import { describe, it, expect, vi } from "vitest";
import { installRouter } from "../../src/webview-host/router";
import type { WebviewEvent } from "../../src/shared/protocol";
import type { DshCtx } from "../../src/dsh-bridge/boot";

/**
 * Build a minimal Cordis-like ctx whose `ctx.agents.get(id)` returns
 * a pre-registered mock agent. The mock's `followup` is a `vi.fn` we
 * can assert on, mirroring the real DSH 0.1.0-rc.6 API surface
 * (`Agent.followup(userMessage)` — see
 * `node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts`).
 */
function makeCtx() {
  const followup = vi.fn();
  const ctx = {
    agents: {
      get: (_id: string) => ({ followup }),
    },
  } as unknown as DshCtx;
  return { ctx, followup };
}

function makePanel() {
  const sent: WebviewEvent[] = [];
  return {
    panel: {
      webview: {
        postMessage: vi.fn(async (msg: WebviewEvent) => {
          sent.push(msg);
        }),
      },
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    },
    sent,
  };
}

describe("router", () => {
  it("routes chat.send to the live agent's followup", async () => {
    const { panel } = makePanel();
    const { ctx, followup } = makeCtx();
    const sub = installRouter(panel as any, { ctx });
    const handler = (panel.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 1, type: "chat.send", sessionId: "s1", text: "hi" });
    expect(followup).toHaveBeenCalledTimes(1);
    const message = followup.mock.calls[0][0];
    expect(message.role).toBe("user");
    expect(message.source).toEqual({ kind: "user" });
    expect(message.content).toEqual([{ type: "text", text: "hi" }]);
    sub.dispose();
  });

  it("ignores messages with a mismatched protocol version", async () => {
    const { panel, sent } = makePanel();
    const { ctx, followup } = makeCtx();
    const sub = installRouter(panel as any, { ctx });
    const handler = (panel.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 99, type: "chat.send", sessionId: "s1", text: "hi" });
    expect(followup).not.toHaveBeenCalled();
    expect(sent).toEqual([
      {
        v: 1,
        type: "error",
        message: "Protocol mismatch: expected v=1, got v=99",
        recoverable: true,
      },
    ]);
    sub.dispose();
  });
});
