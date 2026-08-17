/**
 * Live-session facade over the DSH agent registry.
 *
 * The durable `Session` object is a SIDE EFFECT of
 * `ctx.agents.create({ sessionId, ... })`, which mints both the session
 * and the live `Agent` together (see
 * `node_modules/@deepseek-ai/dsh-agent/lib/types/index.d.ts` —
 * `AgentRegistry.create({ sessionId })` → `{ agent, dispose }`).
 *
 * The relevant inbox APIs (`followup`, `steer`, `inject`, `send`) live
 * on the `Agent`, not on the bare `Session`, so the bridge's handle is
 * really an agent handle.
 *
 * New sessions are stamped with `meta.cwd = workspaceRoot()` so the
 * JSONL persistence backend groups their logs under the project
 * directory — that is what makes per-project history possible.
 *
 * A persisted session (from a previous run of the extension) is brought
 * back with {@link resumeSession}, which delegates to
 * `AgentRegistry.resume({ resumeSessionId })` — the factory loads the
 * log through `ctx.sessionPersistence` and rebuilds the live agent on
 * the reconstructed session.
 *
 * If the runtime does not expose `ctx.agents` at all (i.e. `bootDsh`
 * was not called), the function throws — the caller should not be
 * running the bridge without a booted DSH context.
 */
import type { DshCtx } from "./boot";
import { SessionId } from "@deepseek-ai/dsh-session";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { getEffectiveSelection, registerSelectionRef } from "./models";
import { workspaceRoot } from "./workspace";

/** Structural shape of `ctx.agents` we depend on. Kept loose so the
 *  bridge compiles across DSH version bumps that may add more
 *  methods; the real `AgentRegistry` is richer. */
interface AgentsLike {
  get?: (id: string) => unknown;
  create?: (options: {
    sessionId: ReturnType<typeof SessionId>;
    meta?: { cwd?: string; agentPreset?: string };
    agentOptions?: { provider: string; model: string };
    setup?: (agentCtx: unknown) => unknown;
  }) => Promise<{ agent: unknown }>;
  resume?: (options: {
    resumeSessionId: ReturnType<typeof SessionId>;
    agentOptions?: { provider: string; model: string };
    setup?: (agentCtx: unknown) => unknown;
  }) => Promise<{ agent: unknown }>;
}

export interface SessionHandle {
  id: string;
  /** The live `Agent` on the registry; its `session` property is the
   *  durable `Session` object. Type is intentionally loose; callers must
   *  narrow it (see `pushUserMessage` in `./agents`). */
  raw: unknown;
}

function agentsOf(ctx: DshCtx): AgentsLike {
  const agents = ctx.agents as AgentsLike | undefined;
  if (!agents || typeof agents.get !== "function") {
    throw new Error("DSH ctx.agents is not available — did bootDsh run?");
  }
  return agents;
}

/** Shared creation options for create/resume: effective model selection
 *  plus the setup callback that installs it in the agent-scoped context
 *  so `system-prompt/assemble` and `agent/request` pick up
 *  provider/model. The mutable ref is registered with `./models` so
 *  `selectModel` can switch the live agent from its next step. */
function creationOptions(ctx: DshCtx, sessionId: string) {
  const selection = getEffectiveSelection(ctx);
  if (!selection) {
    throw new Error(
      "DSH ctx.agentDefaultModel is not available; cannot derive agent provider/model",
    );
  }
  const selectionRef = { current: selection, assembled: undefined };
  registerSelectionRef(sessionId, selectionRef);
  return {
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx: unknown) => {
      installModelSelection(agentCtx as never, selectionRef as never);
    },
  };
}

export async function getOrCreateSession(
  ctx: DshCtx,
  sessionId: string,
  agentPreset?: string,
): Promise<SessionHandle> {
  const agents = agentsOf(ctx);
  // Fast path: the live agent is already registered under this id.
  const existing = agents.get?.(sessionId);
  if (existing) return { id: sessionId, raw: existing };

  if (typeof agents.create !== "function") {
    throw new Error(
      "DSH ctx.agents has neither get nor create; upstream API mismatch?",
    );
  }

  // Slow path: mint a new session+agent together. `meta.cwd` is the
  // workspace root (not the VS Code launcher's cwd) so the JSONL
  // persistence backend files the log under the project directory and
  // history can filter by project. `meta.agentPreset` records the
  // user-chosen agent preset; it is fixed at creation and persisted in
  // the log header, so resumed sessions keep their original preset.
  const created = await agents.create({
    sessionId: SessionId(sessionId),
    meta: { cwd: workspaceRoot(), ...(agentPreset ? { agentPreset } : null) },
    ...creationOptions(ctx, sessionId),
  });
  return { id: sessionId, raw: created.agent };
}

/**
 * Resume a persisted session as a live agent. No-op fast path when the
 * id is already live. Throws when the session was never persisted or
 * `ctx.agents` predates the `resume` API.
 */
export async function resumeSession(
  ctx: DshCtx,
  sessionId: string,
): Promise<SessionHandle> {
  const agents = agentsOf(ctx);
  const existing = agents.get?.(sessionId);
  if (existing) return { id: sessionId, raw: existing };
  if (typeof agents.resume !== "function") {
    throw new Error("DSH ctx.agents has no resume; upstream API mismatch?");
  }
  const resumed = await agents.resume({
    resumeSessionId: SessionId(sessionId),
    ...creationOptions(ctx, sessionId),
  });
  return { id: sessionId, raw: resumed.agent };
}
