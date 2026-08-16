/**
 * Model catalog and live model selection for the bridge.
 *
 * Why the bridge owns this state instead of delegating to
 * `ctx.agentDefaultModel.saveSelection()`: that method only writes to a
 * mounted settings service, and the headless boot in `boot.ts` mounts no
 * settings plugin — a save would silently leave `currentSelection()`
 * unchanged. So the bridge keeps:
 *
 *   1. a module-level `override` consulted when NEW agents are created
 *      (see `getOrCreateSession` in `./sessions`), and
 *   2. one mutable `ModelSelectionRef` per live session, installed into
 *      the agent scope at creation; mutating `ref.current` switches the
 *      model from the agent's next step (upstream contract, see
 *      `@deepseek-ai/dsh-agent/lib/types/model-selection.d.ts`).
 *
 * Nothing here is persisted: reloading the extension host falls back to
 * the boot-time default.
 */
import type { DshCtx } from "./boot";
import type { ModelCatalog } from "../shared/protocol";
import { hasApiKey } from "./credentials";

export interface Selection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** Mutable selection ref coupled to an agent scope via
 *  `installModelSelection`. Shape mirrors `ModelSelectionRef` upstream;
 *  declared structurally so the bridge compiles across DSH bumps. */
export interface SelectionRef {
  current: Selection | undefined;
  assembled: Selection | undefined;
}

let override: Selection | undefined;
const selectionRefs = new Map<string, SelectionRef>();

/** Test-only: clear the override and all registered refs so specs stay
 *  isolated. Not called by production code. */
export function resetModelSelection(): void {
  override = undefined;
  selectionRefs.clear();
}

/** The selection a newly created agent should boot with: the bridge
 *  override if the user picked one, else the configured default. */
export function getEffectiveSelection(ctx: DshCtx): Selection | undefined {
  if (override) return { ...override };
  const svc = ctx.agentDefaultModel as
    | { currentSelection?: () => Selection | undefined }
    | undefined;
  return svc?.currentSelection?.();
}

/** Register the live selection ref installed into an agent's scope so
 *  `selectModel` can switch it later. Called by `getOrCreateSession`. */
export function registerSelectionRef(sessionId: string, ref: SelectionRef): void {
  selectionRefs.set(sessionId, ref);
}

interface LlmLike {
  listProviders?: () => Array<{ id: string; name: string }>;
  listModels?: (provider: string) => Promise<ReadonlyArray<{ id: string; name: string }>>;
  resolveModelInfo?: (
    provider: string,
    model: string,
  ) => Promise<{
    context?: { contextWindow: number };
    reasoning?: { efforts?: ReadonlyArray<{ id: string; name: string }> };
  }>;
}

/**
 * Assemble the model catalog event for the webview: registered
 * providers and their advertised models, plus context capacity and
 * reasoning efforts of the CURRENT route. Every upstream call is
 * individually fault-isolated — a provider whose catalog fails
 * (offline, missing credential) degrades to an empty model list, and a
 * failed `resolveModelInfo` just omits `contextWindow`/`efforts`.
 */
export async function getModelCatalog(ctx: DshCtx): Promise<ModelCatalog> {
  const llm = ctx.llm as LlmLike | undefined;
  const providers: ModelCatalog["providers"] = [];
  for (const p of llm?.listProviders?.() ?? []) {
    let models: Array<{ id: string; name: string }> = [];
    try {
      models = [...(await llm?.listModels?.(p.id) ?? [])];
    } catch {
      models = [];
    }
    providers.push({ id: p.id, name: p.name, models });
  }

  const current = getEffectiveSelection(ctx);
  if (!current) {
    throw new Error("no model selection available (agentDefaultModel missing)");
  }

  const catalog: ModelCatalog = {
    v: 1,
    type: "model.catalog",
    providers,
    current,
    hasCredential: await hasApiKey(ctx),
  };
  try {
    const info = await llm?.resolveModelInfo?.(current.provider, current.model);
    if (info?.context?.contextWindow) catalog.contextWindow = info.context.contextWindow;
    if (info?.reasoning?.efforts?.length) {
      catalog.efforts = info.reasoning.efforts.map((e) => ({ id: e.id, name: e.name }));
    }
  } catch {
    // Capability lookup is advisory; the picker still works without it.
  }
  return catalog;
}

/**
 * Switch the model: records the override for future agents and, when the
 * session already has a live agent, mutates its selection ref so the
 * switch takes effect on the agent's next step. Returns the refreshed
 * catalog (now including the new route's context window and efforts).
 */
export async function selectModel(
  ctx: DshCtx,
  sessionId: string,
  sel: Selection,
): Promise<ModelCatalog> {
  override = { ...sel };
  const ref = selectionRefs.get(sessionId);
  if (ref) {
    ref.current = { ...sel };
  }
  return getModelCatalog(ctx);
}
