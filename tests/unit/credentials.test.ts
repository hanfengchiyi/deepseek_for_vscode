/**
 * API-key bridge over the Cordis `credentials` service. The service is
 * mocked; the real file-backed provider is `dsh-credentials-local`,
 * mounted in boot.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { API_KEY_REF, hasApiKey, setApiKey } from "../../src/dsh-bridge/credentials";
import type { DshCtx } from "../../src/dsh-bridge/boot";

function makeCtx(credentials?: unknown): DshCtx {
  return { credentials } as unknown as DshCtx;
}

describe("hasApiKey", () => {
  it("returns true when any credential layer is configured", async () => {
    const ctx = makeCtx({ describe: async () => ({ configured: true, writable: true }) });
    await expect(hasApiKey(ctx)).resolves.toBe(true);
  });

  it("returns false when nothing is configured", async () => {
    const ctx = makeCtx({ describe: async () => ({ configured: false, writable: true }) });
    await expect(hasApiKey(ctx)).resolves.toBe(false);
  });

  it("returns false when the service is missing or describe throws", async () => {
    await expect(hasApiKey(makeCtx())).resolves.toBe(false);
    const ctx = makeCtx({ describe: async () => Promise.reject(new Error("io")) });
    await expect(hasApiKey(ctx)).resolves.toBe(false);
  });
});

describe("setApiKey", () => {
  it("stores the trimmed key under the adapter's reference", async () => {
    const set = vi.fn(async () => {});
    await setApiKey(makeCtx({ set }), "  sk-test  ");
    expect(set).toHaveBeenCalledWith(API_KEY_REF, "sk-test");
  });

  it("rejects an empty key", async () => {
    const set = vi.fn(async () => {});
    await expect(setApiKey(makeCtx({ set }), "   ")).rejects.toThrow("empty");
    expect(set).not.toHaveBeenCalled();
  });

  it("guides toward the environment variable when the service is absent", async () => {
    await expect(setApiKey(makeCtx(), "sk-test")).rejects.toThrow(API_KEY_REF);
  });
});
