import { describe, it, expect, vi } from "vitest";
import { installRouter } from "../../src/webview-host/router";
import type { WebviewEvent } from "../../src/shared/protocol";

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

function makeDsh() {
  const inbox: Array<{ type: string; text?: string }> = [];
  return {
    dsh: {
      ctx: { _stub: true },
      pushInbox: (item: { type: string; text?: string }) => inbox.push(item),
      inbox,
    } as any,
    inbox,
  };
}

describe("router", () => {
  it("routes chat.send to dsh.pushInbox", () => {
    const { panel } = makePanel();
    const { dsh, inbox } = makeDsh();
    const sub = installRouter(panel as any, dsh);
    const handler = (panel.onDidReceiveMessage as any).mock.calls[0][0];
    handler({ v: 1, type: "chat.send", sessionId: "s1", text: "hi" });
    expect(inbox).toEqual([{ type: "chat.send", sessionId: "s1", text: "hi" }]);
    sub.dispose();
  });

  it("ignores messages with a mismatched protocol version", () => {
    const { panel } = makePanel();
    const { dsh, inbox } = makeDsh();
    const sub = installRouter(panel as any, dsh);
    const handler = (panel.onDidReceiveMessage as any).mock.calls[0][0];
    handler({ v: 99, type: "chat.send", sessionId: "s1", text: "hi" });
    expect(inbox).toEqual([]);
    sub.dispose();
  });
});
