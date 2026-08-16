/**
 * Look up (or create) a live DSH session for a given webview-side id.
 *
 * The brief assumed `ctx.sessions.get(id)` / `ctx.sessions.create({id})`
 * for a session facade. The real DSH 0.1.0-rc.6 API is structured
 * differently: the durable `Session` object is a SIDE EFFECT of
 * `ctx.agents.create({ sessionId, ... })`, which mints both the session
 * and the live `Agent` together (see
 * `node_modules/@deepseek-ai/dsh-agent/lib/types/index.d.ts` —
 * `AgentRegistry.create({ sessionId })` → `{ agent, dispose }`).
 *
 * The relevant inbox APIs (`followup`, `steer`, `inject`, `send`) live
 * on the `Agent`, not on the bare `Session`, so the bridge's handle is
 * really an agent handle. We keep the brief's name `SessionHandle` and
 * the loose `raw: any` type so the contract is stable for M1; M2
 * tightens `raw` to `Agent` once the feature-detect goes away.
 *
 * On first call for a given `sessionId` we mirror the headless-runner's
 * creation pattern (see `node_modules/@deepseek-ai/dsh-headless/lib/index.js`):
 *   1. brand the string id via `SessionId(...)`,
 *   2. read the configured default model from `ctx.agentDefaultModel`,
 *   3. create the agent with that provider/model and a `setup` callback
 *      that installs the model selection in the agent-scoped context.
 * On every subsequent call for the same `sessionId` we just return the
 * live agent from `ctx.agents.get(id)`.
 *
 * If the runtime does not expose `ctx.agents` at all (i.e. `bootDsh`
 * was not called or the headless profile was not mounted), the function
 * throws — the caller should not be running the bridge without a booted
 * DSH context.
 */
import type { DshCtx } from "./boot";
import { SessionId } from "@deepseek-ai/dsh-session";
import { installModelSelection } from "@deepseek-ai/dsh-agent";

/** Structural shape of `ctx.agents` we depend on. Kept loose so the
 *  bridge compiles across DSH version bumps that may add more
 *  methods; the real `AgentRegistry` is richer. */
interface AgentsLike {
  get?: (id: string) => unknown;
  create?: (options: {
    sessionId: ReturnType<typeof SessionId>;
    meta?: { cwd?: string };
    agentOptions?: { provider: string; model: string };
    setup?: (agentCtx: unknown) => unknown;
  }) => Promise<{ agent: unknown }>;
}

export interface SessionHandle {
  id: string;
  /** DSH's session facade. The real handle is the live `Agent` on the
   *  registry; its `session` property is the durable `Session` object.
   *  Type is intentionally loose for M1; tightened in M2. */
  raw: any;
}

export async function getOrCreateSession(
  ctx: DshCtx,
  sessionId: string,
): Promise<SessionHandle> {
  const agents = ctx.agents as AgentsLike | undefined;
  if (!agents) {
    throw new Error(
      "DSH ctx.agents is not available — did bootDsh run with the headless profile?",
    );
  }
  // Fast path: the live agent is already registered under this id.
  const existing = agents.get?.(sessionId);
  if (existing) return { id: sessionId, raw: existing };

  if (typeof agents.create !== "function") {
    throw new Error(
      "DSH ctx.agents has neither get nor create; upstream API mismatch?",
    );
  }

  // Slow path: mint a new session+agent together. We read the default
  // model from the configured `agentDefaultModel` service so the agent
  // has a real provider/model; without it the system prompt and request
  // routing have no model to bind to.
  const defaultModel = (ctx as {
    agentDefaultModel?: { currentSelection: () => { provider: string; model: string } };
  }).agentDefaultModel;
  const selection = defaultModel?.currentSelection();
  if (!selection) {
    throw new Error(
      "DSH ctx.agentDefaultModel is not available; cannot derive agent provider/model",
    );
  }

  // Mirror `dsh-headless/lib/index.js`: create the session+agent, and
  // install the default model selection in the agent's scoped context
  // so `system-prompt/assemble` and `agent/request` pick up
  // provider/model. `process.cwd()` is the VS Code launcher's cwd,
  // which `dsh-session` requires to be absolute.
  const created = await agents.create({
    sessionId: SessionId(sessionId),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx: unknown) => {
      installModelSelection(agentCtx as never, {
        current: selection,
        assembled: undefined,
      });
    },
  });
  return { id: sessionId, raw: created.agent };
}
