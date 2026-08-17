/**
 * Approval answerer: bridges the `approval/request` waterfall
 * (`dsh-user-approval`) to an approval card in the chat webview.
 *
 * When the preset gate (./permissions.ts) returns `ask` for a mutating
 * tool, ToolRuntime routes the question through `ctx.approval`, which
 * dispatches `approval/request` to composed answerers. This module's
 * listener claims the request when a webview sink is connected: it
 * parks a Promise, emits `approval.request` to the view, and settles
 * with the user's decision from {@link answerApproval}
 * (`allowed-once` / `rejected`). Without a sink it delegates to
 * `next()`, preserving the fail-closed default (`unavailable`).
 *
 * Cancellation: `req.signal` aborting (turn cancelled) settles the
 * parked Promise with `cancelled` — the service treats an aborted
 * request as withdrawn and discards late answers. `chat.cancel` also
 * rejects via {@link cancelSessionApprovals} so the card never strands.
 */
import type { DshCtx } from "./boot";
import type { WebviewEvent } from "../shared/protocol";

type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";

interface PendingApproval {
  sessionId: string;
  resolve: (outcome: ApprovalOutcome) => void;
  cleanup: () => void;
}

/** approvalId → parked answerer. Module-level like ./ask-user.ts: one
 *  runtime, one chat view per extension host. */
const pending = new Map<string, PendingApproval>();
let seq = 0;

let sink: ((ev: WebviewEvent) => void) | undefined;

export function setApprovalSink(fn: ((ev: WebviewEvent) => void) | undefined): void {
  sink = fn;
}

/** Settle the parked request. Unknown/stale ids are ignored. */
export function answerApproval(approvalId: string, allow: boolean): void {
  const entry = pending.get(approvalId);
  if (!entry) return;
  pending.delete(approvalId);
  entry.cleanup();
  entry.resolve(allow ? "allowed-once" : "rejected");
}

/** Settle every parked request of one session as cancelled (stop button). */
export function cancelSessionApprovals(sessionId: string): void {
  for (const [id, entry] of pending) {
    if (entry.sessionId !== sessionId) continue;
    pending.delete(id);
    entry.cleanup();
    entry.resolve("cancelled");
  }
}

interface ApprovalEventsCtx {
  on(
    name: string,
    listener: (
      req: {
        agent?: { session?: { id?: string } };
        toolName: string;
        callId?: string;
        reason?: string;
        signal?: AbortSignal;
      },
      next: () => Promise<ApprovalOutcome>,
    ) => Promise<ApprovalOutcome>,
  ): () => boolean;
}

/**
 * Claim `approval/request` whenever a webview is connected; delegate
 * otherwise. Returns a disposer that removes the listener and cancels
 * every parked request.
 */
export function registerApprovalAnswerer(ctx: DshCtx): () => void {
  const cordis = ctx as unknown as ApprovalEventsCtx;
  const dispose = cordis.on("approval/request", (req, next) => {
    if (!sink) return next();
    const sessionId = req.agent?.session?.id ?? "";
    const approvalId = `a-${Date.now().toString(36)}-${++seq}`;
    return new Promise<ApprovalOutcome>((resolve) => {
      const onAbort = () => {
        pending.delete(approvalId);
        resolve("cancelled");
      };
      req.signal?.addEventListener("abort", onAbort, { once: true });
      pending.set(approvalId, {
        sessionId,
        resolve,
        cleanup: () => req.signal?.removeEventListener("abort", onAbort),
      });
      sink?.({
        v: 1,
        type: "approval.request",
        sessionId,
        approvalId,
        toolName: req.toolName,
        ...(req.reason ? { reason: req.reason } : null),
      });
    });
  });

  return () => {
    dispose();
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.cleanup();
      entry.resolve("cancelled");
    }
  };
}
