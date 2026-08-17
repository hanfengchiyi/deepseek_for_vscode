/**
 * Tests for the permission preset gate (`src/dsh-bridge/permissions.ts`).
 *
 * The gate is a `tools/pre-execute` waterfall listener registered through
 * a mocked `ctx.on` (same posture as events.test.ts). The captured
 * listener is invoked directly with a fake exec envelope; `next()` is a
 * stub that resolves to a recognizable "allowed" marker so tests can tell
 * delegation apart from the gate's own verdicts.
 *
 * The preset is module-level state; every test that moves it resets to
 * the `workspace-write` default afterwards.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  MUTATING_TOOLS,
  getPreset,
  registerPermissionGate,
  setPreset,
} from "../../src/dsh-bridge/permissions";
import type { DshCtx } from "../../src/dsh-bridge/boot";

interface Verdict {
  kind: string;
  reason?: string;
}

type Listener = (exec: { name: string }, next: () => Promise<Verdict>) => Promise<Verdict>;

function makeCtx() {
  let captured: Listener | undefined;
  const ctx = {
    on: (name: string, fn: Listener) => {
      if (name !== "tools/pre-execute") throw new Error(`unexpected event: ${name}`);
      captured = fn;
      return () => true;
    },
  } as unknown as DshCtx;
  return {
    ctx,
    gate() {
      if (!captured) throw new Error("gate was not registered");
      return captured;
    },
  };
}

const ALLOWED: Verdict = { kind: "allowed" };
const next = () => Promise.resolve(ALLOWED);

afterEach(() => {
  setPreset("workspace-write");
});

describe("setPreset", () => {
  it("accepts the three known presets", () => {
    expect(setPreset("read-only")).toBe("read-only");
    expect(getPreset()).toBe("read-only");
    expect(setPreset("full-access")).toBe("full-access");
    expect(getPreset()).toBe("full-access");
  });

  it("rejects unknown presets without changing state", () => {
    expect(() => setPreset("yolo")).toThrow("unknown permission preset");
    expect(getPreset()).toBe("workspace-write");
  });
});

describe("registerPermissionGate", () => {
  it("delegates read-only tools regardless of preset", async () => {
    const { ctx, gate } = makeCtx();
    registerPermissionGate(ctx);
    setPreset("read-only");
    await expect(gate()({ name: "read_file" }, next)).resolves.toBe(ALLOWED);
    expect(MUTATING_TOOLS.has("read_file")).toBe(false);
  });

  it("read-only preset denies mutating tools with an explanation", async () => {
    const { ctx, gate } = makeCtx();
    registerPermissionGate(ctx);
    setPreset("read-only");
    const verdict = await gate()({ name: "write_file" }, next);
    expect(verdict.kind).toBe("deny");
    expect(verdict.reason).toContain("write_file");
    expect(verdict.reason).toContain("read-only");
  });

  it("workspace-write preset asks for approval", async () => {
    const { ctx, gate } = makeCtx();
    registerPermissionGate(ctx);
    const verdict = await gate()({ name: "run_command" }, next);
    expect(verdict).toEqual({ kind: "ask" });
  });

  it("full-access preset delegates mutating tools", async () => {
    const { ctx, gate } = makeCtx();
    registerPermissionGate(ctx);
    setPreset("full-access");
    await expect(gate()({ name: "write_file" }, next)).resolves.toBe(ALLOWED);
  });
});
