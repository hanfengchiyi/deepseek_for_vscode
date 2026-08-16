/**
 * Model catalog assembly and live selection switching.
 *
 * These tests mock the two upstream surfaces the bridge consumes:
 *   - `ctx.llm` (listProviders / listModels / resolveModelInfo), and
 *   - `ctx.agentDefaultModel.currentSelection()`.
 * `resetModelSelection()` clears the module-level override between specs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getEffectiveSelection,
  getModelCatalog,
  registerSelectionRef,
  resetModelSelection,
  selectModel,
} from "../../src/dsh-bridge/models";
import type { DshCtx } from "../../src/dsh-bridge/boot";

function makeCtx(overrides: { failListModelsFor?: string; failResolve?: boolean } = {}) {
  const llm = {
    listProviders: () => [
      { id: "deepseek-official", name: "DeepSeek" },
      { id: "backup", name: "Backup" },
    ],
    listModels: async (provider: string) => {
      if (provider === overrides.failListModelsFor) throw new Error("offline");
      return provider === "deepseek-official"
        ? [
            { id: "deepseek-chat", name: "DeepSeek Chat" },
            { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
          ]
        : [{ id: "backup-1", name: "Backup One" }];
    },
    resolveModelInfo: async (provider: string, model: string) => {
      if (overrides.failResolve) throw new Error("no capability data");
      void provider;
      void model;
      return {
        context: { contextWindow: 128000 },
        reasoning: { efforts: [{ id: "low", name: "Low" }, { id: "high", name: "High" }] },
      };
    },
  };
  const ctx = {
    llm,
    agentDefaultModel: {
      currentSelection: () => ({ provider: "deepseek-official", model: "deepseek-chat" }),
    },
  } as unknown as DshCtx;
  return ctx;
}

beforeEach(() => resetModelSelection());

describe("getModelCatalog", () => {
  it("assembles providers, current selection, context window and efforts", async () => {
    const catalog = await getModelCatalog(makeCtx());
    expect(catalog.type).toBe("model.catalog");
    expect(catalog.providers).toHaveLength(2);
    expect(catalog.providers[0].models.map((m) => m.id)).toEqual([
      "deepseek-chat",
      "deepseek-reasoner",
    ]);
    expect(catalog.current).toEqual({ provider: "deepseek-official", model: "deepseek-chat" });
    expect(catalog.contextWindow).toBe(128000);
    expect(catalog.efforts?.map((e) => e.id)).toEqual(["low", "high"]);
    // No credentials service in this mock → reported as not configured.
    expect(catalog.hasCredential).toBe(false);
  });

  it("degrades a failing provider to an empty model list", async () => {
    const catalog = await getModelCatalog(makeCtx({ failListModelsFor: "backup" }));
    expect(catalog.providers[1]).toEqual({ id: "backup", name: "Backup", models: [] });
    expect(catalog.providers[0].models).toHaveLength(2);
  });

  it("omits contextWindow and efforts when capability lookup fails", async () => {
    const catalog = await getModelCatalog(makeCtx({ failResolve: true }));
    expect(catalog.contextWindow).toBeUndefined();
    expect(catalog.efforts).toBeUndefined();
  });
});

describe("selectModel", () => {
  it("records the override consulted by getEffectiveSelection", async () => {
    const ctx = makeCtx();
    await selectModel(ctx, "sess-1", { provider: "deepseek-official", model: "deepseek-reasoner" });
    expect(getEffectiveSelection(ctx)).toEqual({
      provider: "deepseek-official",
      model: "deepseek-reasoner",
    });
  });

  it("mutates the live selection ref of an existing session", async () => {
    const ctx = makeCtx();
    const ref = { current: getEffectiveSelection(ctx), assembled: undefined };
    registerSelectionRef("sess-1", ref);
    await selectModel(ctx, "sess-1", {
      provider: "deepseek-official",
      model: "deepseek-reasoner",
      reasoningEffort: "high",
    });
    expect(ref.current).toEqual({
      provider: "deepseek-official",
      model: "deepseek-reasoner",
      reasoningEffort: "high",
    });
  });

  it("returns the refreshed catalog for the new selection", async () => {
    const ctx = makeCtx();
    const catalog = await selectModel(ctx, "sess-1", {
      provider: "deepseek-official",
      model: "deepseek-reasoner",
    });
    expect(catalog.current.model).toBe("deepseek-reasoner");
    expect(catalog.contextWindow).toBe(128000);
  });
});
