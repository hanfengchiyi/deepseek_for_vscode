/**
 * Real-boot test for `bootDsh` — the only test in this project that does
 * NOT mock `@deepseek-ai/dsh-headless`. It exercises the real
 * `@deepseek-ai/dsh-headless@0.1.0-rc.6` `apply` plugin against a real
 * Cordis root context, with the four peer-dep core services
 * (`@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-agent-default-model`,
 * `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-llm`) wired in by
 * `bootDsh` itself. If any of the three invariants the headless `apply`
 * enforces regresses (missing `ctx.appExit`, missing core services, boot
 * throwing during mount), this test catches it.
 *
 * The default `appExit` is a no-op, so the headless `apply`'s eventual
 * `io.exit(0)` / `io.exit(1)` does not call `process.exit`.
 */
import { describe, it, expect } from "vitest";
import { bootDsh } from "../../src/dsh-bridge/boot";

describe("bootDsh (real boot against the un-mocked headless plugin)", () => {
  it("real boot completes without throwing and exposes core services", async () => {
    const handle = await bootDsh({ profile: "headless" });
    expect(handle.ctx).toBeTruthy();
    expect(handle.fiber).toBeTruthy();
    expect((handle.ctx as { sessions?: unknown }).sessions).toBeDefined();
    expect((handle.ctx as { agents?: unknown }).agents).toBeDefined();
    await expect(handle.dispose()).resolves.toBeUndefined();
  });
});
