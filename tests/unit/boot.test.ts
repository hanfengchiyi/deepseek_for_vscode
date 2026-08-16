/**
 * Shape-only boot tests. Boot no longer mounts any plugin that runs a
 * task on its own (the old `dsh-headless` mount auto-executed its
 * `task` config on every boot), so these tests use the REAL stack — boot
 * without a workspace is cheap and touches no network.
 */
import { describe, it, expect } from "vitest";
import { bootDsh } from "../../src/dsh-bridge/boot";

describe("bootDsh", () => {
  it("returns a handle whose ctx exposes the core services", async () => {
    const handle = await bootDsh();
    try {
      expect(handle.ctx).toBeTruthy();
      for (const key of [
        "llm",
        "agents",
        "sessions",
        "tools",
        "systemPrompt",
        "credentials",
        "sessionPersistence",
      ]) {
        expect(handle.ctx[key], `ctx.${key}`).toBeDefined();
      }
    } finally {
      await handle.dispose();
    }
  }, 30000);

  it("dispose() is idempotent and resolves cleanly", async () => {
    const handle = await bootDsh();
    await handle.dispose();
    await expect(handle.dispose()).resolves.toBeUndefined();
  }, 30000);
});
