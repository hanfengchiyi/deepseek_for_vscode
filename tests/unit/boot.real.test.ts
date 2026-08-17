/**
 * Real-boot regression tests for the headless-driver removal.
 *
 * `bootDsh` used to mount `@deepseek-ai/dsh-headless` — the one-shot CLI
 * driver that creates an agent on mount and runs `config.task` to
 * completion. The profile name "headless" was passed as the task text,
 * so every view open auto-ran a bogus "headless" prompt against the
 * workspace (tools firing, tokens burning, unprompted answers).
 *
 * The fix drops that plugin entirely: boot now only registers services
 * and must be inert until the webview sends a message. These tests pin
 * that invariant against the real, un-mocked stack.
 */
import { describe, it, expect } from "vitest";
import { bootDsh } from "../../src/dsh-bridge/boot";

describe("bootDsh (real stack, no headless driver)", () => {
  it("boots without creating any session or agent", async () => {
    const handle = await bootDsh();
    try {
      const sessions = handle.ctx.sessions as { list(): unknown[] };
      // THE regression assertion: an idle boot must not start a turn.
      expect(sessions.list()).toEqual([]);
    } finally {
      await handle.dispose();
    }
  }, 30000);

  it("registers the deepseek-official provider route with its model catalog", async () => {
    const handle = await bootDsh();
    try {
      const llm = handle.ctx.llm as {
        listProviders(): Array<{ id: string }>;
        listModels(provider: string): Promise<Array<{ id: string }>>;
      };
      expect(llm.listProviders().map((p) => p.id)).toContain("deepseek-official");
      const models = await llm.listModels("deepseek-official");
      expect(models.map((m) => m.id)).toContain("deepseek-v4-flash");
    } finally {
      await handle.dispose();
    }
  }, 30000);

  it("mounts the JSONL session persistence service", async () => {
    const handle = await bootDsh();
    try {
      const persistence = handle.ctx.sessionPersistence as {
        list(): Promise<unknown[]>;
      };
      expect(typeof persistence.list).toBe("function");
    } finally {
      await handle.dispose();
    }
  }, 30000);

  it("honors a custom model catalog and endpoint from BootOptions.llm", async () => {
    // The `dsh.llm.*` VS Code settings land here via view.ts. A custom
    // catalog replaces the built-in DeepSeek entries in the picker; no
    // network is touched at boot, so a loopback URL is fine.
    const handle = await bootDsh({
      model: "grok-4",
      llm: {
        baseURL: "http://localhost:3010",
        models: [{ id: "grok-4", name: "Grok 4", contextWindow: 256000, maxTokens: 8192 }],
      },
    });
    try {
      const llm = handle.ctx.llm as {
        listModels(provider: string): Promise<Array<{ id: string; name: string }>>;
      };
      const models = await llm.listModels("deepseek-official");
      expect(models.map((m) => m.id)).toEqual(["grok-4"]);
      expect(models[0]!.name).toBe("Grok 4");
    } finally {
      await handle.dispose();
    }
  }, 30000);
});
