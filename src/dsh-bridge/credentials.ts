/**
 * API-key bridge over the Cordis `credentials` service.
 *
 * The DeepSeek adapter resolves its key by reference (`DEEPSEEK_API_KEY`)
 * through `ctx.credentials` — a layered store: process env wins, then the
 * managed file (`$DSH_HOME/.credentials.yaml`), then `.env` fallbacks.
 * Writing through `set()` lands in the managed file, so a key entered in
 * the webview persists across restarts without touching the environment.
 */
import type { DshCtx } from "./boot";

/** Credential reference the `deepseek-official` adapter resolves. */
export const API_KEY_REF = "DEEPSEEK_API_KEY";

interface CredentialsLike {
  describe?: (ref: string) => Promise<{ configured: boolean; writable: boolean }>;
  set?: (ref: string, value: string) => Promise<void>;
}

function service(ctx: DshCtx): CredentialsLike | undefined {
  return ctx.credentials as CredentialsLike | undefined;
}

/** Whether the adapter will find a key, from any layer (env or file). */
export async function hasApiKey(ctx: DshCtx): Promise<boolean> {
  try {
    const status = await service(ctx)?.describe?.(API_KEY_REF);
    return status?.configured ?? false;
  } catch {
    return false;
  }
}

/**
 * Store a key entered in the UI. Throws when the credentials service is
 * not mounted — the caller surfaces the message in the webview.
 */
export async function setApiKey(ctx: DshCtx, key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key is empty");
  const svc = service(ctx);
  if (typeof svc?.set !== "function") {
    throw new Error(
      `credentials service unavailable; export ${API_KEY_REF} in the launching environment instead`,
    );
  }
  await svc.set(API_KEY_REF, trimmed);
}
