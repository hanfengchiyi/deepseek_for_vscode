import { describe, it, expect, vi, beforeEach } from "vitest";
import { installRouter } from "../../src/webview-host/router";
import { resetModelSelection } from "../../src/dsh-bridge/models";
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
  const cancel = vi.fn();
  const credentialSet = vi.fn(async () => {});
  const ctx = {
    agents: {
      get: (_id: string) => ({ followup, cancel }),
    },
    // Minimal `ctx.llm` + `ctx.agentDefaultModel` surface consumed by
    // the model catalog routes (see ../../src/dsh-bridge/models).
    llm: {
      listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
      listModels: async () => [{ id: "deepseek-chat", name: "DeepSeek Chat" }],
      resolveModelInfo: async () => ({ context: { contextWindow: 128000 } }),
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: "deepseek-official", model: "deepseek-chat" }),
    },
    credentials: {
      describe: async () => ({ configured: true, writable: true }),
      set: credentialSet,
    },
    // Minimal `ctx.sessionPersistence` consumed by the history routes
    // (see ../../src/dsh-bridge/history). The cwd matches the bridge's
    // workspaceRoot() fallback (process.cwd()) so the filter keeps it.
    sessionPersistence: {
      list: async () => [
        { id: "s-old", createdAt: 1000, cwd: process.cwd() },
        { id: "s-other-ws", createdAt: 2000, cwd: "/elsewhere" },
      ],
      inspect: async (id: string) => ({
        events:
          id === "s-old"
            ? [
                {
                  type: "user/message",
                  seq: 1,
                  data: { content: [{ type: "text", text: "old question" }] },
                },
              ]
            : [],
      }),
    },
  } as unknown as DshCtx;
  return { ctx, followup, cancel, credentialSet };
}

beforeEach(() => resetModelSelection());

function makePanel() {
  const sent: WebviewEvent[] = [];
  return {
    panel: {
      webview: {
        postMessage: vi.fn(async (msg: WebviewEvent) => {
          sent.push(msg);
        }),
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
    },
    sent,
  };
}

describe("router", () => {
  it("routes chat.send to the live agent's followup", async () => {
    const { panel } = makePanel();
    const { ctx, followup } = makeCtx();
    const sub = installRouter(panel as any, { ctx });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 1, type: "chat.send", sessionId: "s1", text: "hi" });
    expect(followup).toHaveBeenCalledTimes(1);
    const message = followup.mock.calls[0][0];
    expect(message.role).toBe("user");
    expect(message.source).toEqual({ kind: "user" });
    expect(message.content).toEqual([{ type: "text", text: "hi" }]);
    sub.dispose();
  });

  it("routes chat.cancel to the live agent's cancel", async () => {
    const { panel } = makePanel();
    const { ctx, cancel } = makeCtx();
    const sub = installRouter(panel as any, { ctx });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 1, type: "chat.cancel", sessionId: "s1" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith({ kind: "user" });
    sub.dispose();
  });

  it("answers model.list with a model.catalog event", async () => {
    const { panel, sent } = makePanel();
    const { ctx } = makeCtx();
    const sub = installRouter(panel as any, { ctx });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 1, type: "model.list" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "model.catalog",
      current: { provider: "deepseek-official", model: "deepseek-chat" },
      contextWindow: 128000,
    });
    sub.dispose();
  });

  it("routes model.select and replies with the refreshed catalog", async () => {
    const { panel, sent } = makePanel();
    const { ctx } = makeCtx();
    const sub = installRouter(panel as any, { ctx });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({
      v: 1,
      type: "model.select",
      sessionId: "s1",
      provider: "deepseek-official",
      model: "deepseek-reasoner",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "model.catalog",
      current: { provider: "deepseek-official", model: "deepseek-reasoner" },
    });
    sub.dispose();
  });

  it("stores a prompted API key and replies with the refreshed catalog", async () => {
    const { panel, sent } = makePanel();
    const { ctx, credentialSet } = makeCtx();
    const promptSecret = vi.fn(async () => "sk-test");
    const sub = installRouter(panel as any, { ctx }, { promptSecret });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 1, type: "credential.set" });
    expect(credentialSet).toHaveBeenCalledWith("DEEPSEEK_API_KEY", "sk-test");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "model.catalog", hasCredential: true });
    sub.dispose();
  });

  it("stays silent when the credential prompt is cancelled", async () => {
    const { panel, sent } = makePanel();
    const { ctx, credentialSet } = makeCtx();
    const promptSecret = vi.fn(async () => undefined);
    const sub = installRouter(panel as any, { ctx }, { promptSecret });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 1, type: "credential.set" });
    expect(credentialSet).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    sub.dispose();
  });

  it("reports an error when the host cannot prompt for credentials", async () => {
    const { panel, sent } = makePanel();
    const { ctx } = makeCtx();
    const sub = installRouter(panel as any, { ctx });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 1, type: "credential.set" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "error" });
    sub.dispose();
  });

  it("answers ready with the catalog, the session history, the plugin catalog, and the permission state", async () => {
    const { panel, sent } = makePanel();
    const { ctx } = makeCtx();
    const plugins = [{ id: "demo.js", path: "/plugins/demo.js", status: "loaded" as const }];
    const sub = installRouter(panel as any, { ctx, plugins });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 1, type: "ready" });
    expect(sent.map((m) => m.type)).toEqual([
      "model.catalog",
      "session.history",
      "plugin.catalog",
      "permission.state",
    ]);
    const history = sent[1] as Extract<WebviewEvent, { type: "session.history" }>;
    // Only this workspace's sessions are listed (cwd filter).
    expect(history.sessions.map((s) => s.id)).toEqual(["s-old"]);
    expect(history.sessions[0].title).toBe("old question");
    const catalog = sent[2] as Extract<WebviewEvent, { type: "plugin.catalog" }>;
    expect(catalog.plugins).toEqual(plugins);
    expect(sent[3]).toMatchObject({ type: "permission.state", preset: "workspace-write" });
    sub.dispose();
  });

  it("answers session.list with this workspace's history only", async () => {
    const { panel, sent } = makePanel();
    const { ctx } = makeCtx();
    const sub = installRouter(panel as any, { ctx });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 1, type: "session.list" });
    expect(sent).toHaveLength(1);
    const history = sent[0] as Extract<WebviewEvent, { type: "session.history" }>;
    expect(history.sessions.map((s) => s.id)).toEqual(["s-old"]);
    sub.dispose();
  });

  it("answers session.open with the rebuilt transcript", async () => {
    const { panel, sent } = makePanel();
    const { ctx } = makeCtx();
    const sub = installRouter(panel as any, { ctx });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 1, type: "session.open", sessionId: "s-old" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "session.transcript",
      sessionId: "s-old",
      messages: [{ role: "user", content: "old question" }],
    });
    sub.dispose();
  });

  it("answers session.new with a refreshed history", async () => {
    const { panel, sent } = makePanel();
    const { ctx } = makeCtx();
    const sub = installRouter(panel as any, { ctx });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
    await handler({ v: 1, type: "session.new" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "session.history" });
    sub.dispose();
  });

  it("ignores messages with a mismatched protocol version", async () => {
    const { panel, sent } = makePanel();
    const { ctx, followup } = makeCtx();
    const sub = installRouter(panel as any, { ctx });
    const handler = (panel.webview.onDidReceiveMessage as any).mock.calls[0][0];
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
