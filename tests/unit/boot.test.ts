import { describe, it, expect, vi, afterEach } from "vitest";

// Mock the DSH packages so the test does not need a real profile.
// `@deepseek-ai/dsh-headless` exports a Cordis `apply` plugin (not a
// `createHeadlessApp` factory as the brief assumed). The real boot wires
// that plugin into a Cordis root context, so we mock both modules.
vi.mock("@deepseek-ai/dsh-headless", () => ({
  apply: vi.fn(),
  name: "headless-runner",
  inject: [] as string[],
  Config: undefined,
  internals: {
    stdout: { write: (_chunk: string) => undefined },
    stderr: { write: (_chunk: string) => undefined },
  },
}));

import { bootDsh } from "../../src/dsh-bridge/boot";
import * as headless from "@deepseek-ai/dsh-headless";

describe("bootDsh", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a handle whose ctx is non-null", async () => {
    const handle = await bootDsh({ profile: "headless" });
    expect(handle.ctx).toBeTruthy();
    await handle.dispose();
  });

  it("the handle carries the requested profile", async () => {
    // The headless plugin's `apply` is registered as a Cordis plugin with
    // the profile passed through as its `task` config field. Asserting on
    // the handle's profile keeps the test honest: if boot.ts ever stops
    // honoring `opts.profile`, this fails.
    const handle = await bootDsh({ profile: "headless" });
    expect(handle.app.profile).toBe("headless");
    expect(headless.apply).toHaveBeenCalled();
    await handle.dispose();
  });

  it("dispose() is idempotent and resolves cleanly", async () => {
    const handle = await bootDsh({ profile: "headless" });
    await handle.dispose();
    await expect(handle.dispose()).resolves.toBeUndefined();
  });
});
