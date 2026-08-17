/**
 * Runtime-plugin enable/disable configuration.
 *
 * The official DSH web UI shows every composed plugin with a toggle; its
 * inventory comes from unpublished internal packages, so this extension
 * manages only what it actually boots: the fixed runtime set declared in
 * {@link RUNTIME_PLUGINS} (mounted by ./boot.ts) plus the user plugins
 * in `$DSH_HOME/plugins` (./plugins.ts, unmanaged here).
 *
 * The disabled set is persisted to `$DSH_HOME/vscode-extension.json` and
 * read ONCE at boot — toggling a plugin therefore requires a window
 * reload to take effect (same semantics as the official preset switch).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface RuntimePluginMeta {
  id: string;
  name: string;
  description: string;
  /** Required plugins are listed but cannot be disabled — every agent
   *  turn depends on them. */
  required: boolean;
}

/** The runtime plugins boot.ts mounts, in mount order. Ids are stable —
 *  they are persisted in the config file. */
export const RUNTIME_PLUGINS: readonly RuntimePluginMeta[] = [
  { id: "llm", name: "llm", description: "LLM runtime (provider routing)", required: true },
  { id: "llm-deepseek", name: "llm-deepseek", description: "DeepSeek provider route", required: true },
  { id: "agents", name: "agent", description: "Agent registry", required: true },
  { id: "agent-default-model", name: "agent-default-model", description: "Default model selection", required: true },
  { id: "sessions", name: "session", description: "In-memory session store", required: true },
  { id: "session-persistence", name: "session-persistence-jsonl", description: "JSONL session logs under $DSH_HOME/sessions", required: true },
  { id: "system-prompt", name: "system-prompt", description: "System prompt assembly", required: true },
  { id: "tools", name: "tools", description: "Tool runtime", required: true },
  { id: "agent-loop", name: "agent-loop", description: "Agent driver loop", required: true },
  { id: "credentials", name: "credentials-local", description: "File-backed credential store", required: true },
  { id: "permissions", name: "user-approval", description: "Permission presets, approval cards, write tools", required: false },
  { id: "ask-user", name: "tool-ask-user", description: "Model can ask the user questions mid-turn", required: false },
  { id: "workspace", name: "workspace", description: "Workspace prompt section and read-only tools", required: false },
  { id: "commands", name: "commands", description: "Human command plane incl. /compact (compaction)", required: false },
  { id: "user-plugins", name: "user-plugins", description: "Cordis plugins from $DSH_HOME/plugins", required: false },
];

export interface RuntimePluginState extends RuntimePluginMeta {
  enabled: boolean;
}

function configPath(home: string): string {
  return path.join(home, "vscode-extension.json");
}

/** Read the disabled-plugin id set. A missing or malformed file means
 *  "everything enabled" — the file is only written on first toggle. */
export async function readDisabledPlugins(home: string): Promise<ReadonlySet<string>> {
  try {
    const raw = await fs.readFile(configPath(home), "utf8");
    const parsed = JSON.parse(raw) as { disabledPlugins?: unknown };
    if (!Array.isArray(parsed.disabledPlugins)) return new Set();
    return new Set(parsed.disabledPlugins.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

/** Toggle one runtime plugin. Unknown ids and required plugins are
 *  rejected so untrusted wire input can never disable the core. Takes
 *  effect on the next boot (window reload). */
export async function setPluginEnabled(
  home: string,
  id: string,
  enabled: boolean,
): Promise<void> {
  const meta = RUNTIME_PLUGINS.find((p) => p.id === id);
  if (!meta) throw new Error(`unknown runtime plugin: ${id}`);
  if (meta.required) throw new Error(`plugin "${id}" is required and cannot be disabled`);
  const disabled = new Set(await readDisabledPlugins(home));
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(
    configPath(home),
    JSON.stringify({ disabledPlugins: [...disabled].sort() }, null, 2) + "\n",
    "utf8",
  );
}

/** The full runtime list with current enabled state, for the panel. */
export async function listRuntimePlugins(home: string): Promise<RuntimePluginState[]> {
  const disabled = await readDisabledPlugins(home);
  return RUNTIME_PLUGINS.map((p) => ({ ...p, enabled: p.required || !disabled.has(p.id) }));
}
