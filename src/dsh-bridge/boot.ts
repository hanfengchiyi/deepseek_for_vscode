/**
 * Cordis wrapper that boots the DSH core services this extension needs.
 *
 * We deliberately do NOT mount `@deepseek-ai/dsh-headless`: that plugin is
 * the one-shot CLI driver — on mount it creates an agent and runs
 * `config.task` to completion. Passing the profile name as the task made
 * every view open auto-run a bogus "headless" prompt against the
 * workspace. This host drives agents itself through `ctx.agents` /
 * `ctx.sessions`, so boot here only registers services:
 *
 *   1. core services, always mounted (`required` in RUNTIME_PLUGINS):
 *      LlmRuntime, dsh-llm-deepseek (owns the `deepseek-official`
 *      provider route), AgentRegistry, AgentDefaultModelConfig,
 *      SessionStore, SessionPersistenceJsonl ($DSH_HOME/sessions,
 *      per-project directories keyed off `meta.cwd`), the agent driver
 *      stack (SystemPrompt, ToolRuntime, AgentLoop), and
 *      LocalCredentialProvider ($DSH_HOME/.credentials.yaml, 0600)
 *   2. optional groups, gated by `$DSH_HOME/vscode-extension.json`
 *      (`disabledPlugins`, see ./plugin-config.ts); each is isolated —
 *      a failure is reported on `DshHandle.runtimePlugins` instead of
 *      aborting the boot:
 *      - `permissions`: dsh-user-approval + the preset gate
 *        (./permissions.ts) + the webview approval answerer
 *        (./approvals.ts) + the mutating tools it gates
 *        (./write-tools.ts)
 *      - `ask-user`: the `ask_user` tool (./ask-user.ts)
 *      - `workspace`: prompt section + read-only tools (./workspace.ts)
 *      - `commands`: the human command plane — dsh-commands +
 *        dsh-token-meter + dsh-compaction-basic + dsh-command-compact
 *        (`/compact`)
 *      - `user-plugins`: Cordis plugins from `BootOptions.pluginsDir`
 *        (./plugins.ts)
 *
 * The returned {@link DshHandle} disposes every plugin fiber in reverse
 * mount order; `dispose()` is idempotent.
 */
import * as os from "node:os";
import * as path from "node:path";
import { Context, type Fiber } from "@deepseek-ai/cordis";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentDefaultModelConfig from "@deepseek-ai/dsh-agent-default-model";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import LocalCredentialProvider from "@deepseek-ai/dsh-credentials-local";
import SessionStore from "@deepseek-ai/dsh-session";
import SessionPersistenceJsonl from "@deepseek-ai/dsh-session-persistence-jsonl";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import * as DeepSeekLlm from "@deepseek-ai/dsh-llm-deepseek";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import UserApproval from "@deepseek-ai/dsh-user-approval";
import { CommandRuntime } from "@deepseek-ai/dsh-commands";
import TokenMeter from "@deepseek-ai/dsh-token-meter";
import CompactionBasic from "@deepseek-ai/dsh-compaction-basic";
import * as CommandCompact from "@deepseek-ai/dsh-command-compact";
import { registerApprovalAnswerer } from "./approvals";
import { registerAskUser } from "./ask-user";
import { registerPermissionGate } from "./permissions";
import { registerWorkspace, type WorkspaceInfo } from "./workspace";
import { registerWriteTools } from "./write-tools";
import { loadUserPlugins, type PluginInfo } from "./plugins";
import {
  RUNTIME_PLUGINS,
  readDisabledPlugins,
  type RuntimePluginState,
} from "./plugin-config";

export interface BootOptions {
  /** Optional model override for the default selection new agents boot
   *  with. Defaults to `deepseek-v4-flash` on `deepseek-official`. */
  model?: string;
  /** The VS Code workspace folder the agent should be aware of. When
   *  provided, a system-prompt section and the read-only workspace tools
   *  (`list_files`/`read_file`/`search_files`) are registered, and new
   *  sessions are stamped with this folder as `meta.cwd` so persistence
   *  groups them under the project. Omit for a plain context-free chat. */
  workspace?: WorkspaceInfo;
  /** Directory of user-level Cordis plugins to mount after the core
   *  services (convention: `$DSH_HOME/plugins`). Each `.js`/`.mjs`/
   *  `.cjs` file or `package.json`-bearing subdirectory is imported and
   *  mounted; failures are isolated per plugin and reported in
   *  {@link DshHandle.plugins}. Omit to skip user plugins. */
  pluginsDir?: string;
}

/** Minimal Cordis ctx surface we depend on. Deliberately narrow so the
 *  bridge compiles even when upstream adds more services. */
export interface DshCtx {
  [key: string]: unknown;
}

/** Boot-time state of one runtime plugin: its static metadata, the
 *  configured enabled flag, and what actually happened this boot. */
export interface RuntimePluginInfo extends RuntimePluginState {
  status: "mounted" | "disabled" | "error";
  error?: string;
}

export interface DshHandle {
  /** Typed view of the Cordis context's services. */
  ctx: DshCtx;
  /** Load outcome of every user plugin found in `BootOptions.pluginsDir`
   *  (empty when no pluginsDir was given). */
  plugins: PluginInfo[];
  /** Boot outcome of every runtime plugin in `RUNTIME_PLUGINS`. */
  runtimePlugins: RuntimePluginInfo[];
  /** Whether `dispose()` has been called. */
  disposed: boolean;
  /** Idempotent disposer; safe to call multiple times. */
  dispose(): Promise<void>;
}

/** `$DSH_HOME`, defaulting to `~/.dsh` — the same resolution the
 *  credentials provider documents for `$DSH_HOME/.credentials.yaml`. */
export function dshHome(): string {
  const fromEnv = process.env.DSH_HOME;
  return path.resolve(
    fromEnv && fromEnv.trim().length > 0 ? fromEnv : path.join(os.homedir(), ".dsh"),
  );
}

/** Boot the DSH core services and return a handle.
 *
 *  Nothing here starts a turn on its own: agents are created lazily by
 *  the bridge when the webview sends the first message of a session.
 *
 *  @param opts - {@link BootOptions}; all fields are optional.
 *  @returns a {@link DshHandle} whose `dispose()` is idempotent.
 */
export async function bootDsh(opts: BootOptions = {}): Promise<DshHandle> {
  const ctx = new Context();
  const fibers: Fiber[] = [];
  const mount = async (plugin: unknown, config?: unknown) => {
    fibers.push(await ctx.plugin(plugin as never, config as never));
  };

  // Plugin enable/disable state, read once per boot (toggling requires a
  // window reload). `on(id)` gates the optional groups below; required
  // plugins are always mounted and fail the boot when they fail.
  const disabled = await readDisabledPlugins(dshHome());
  const on = (id: string) => !disabled.has(id);
  const outcomes = new Map<string, RuntimePluginInfo["status"]>();
  const errors = new Map<string, string>();
  /** Mount an optional group when enabled; isolate its failure so one
   *  broken optional plugin never aborts the boot. */
  const mountOptional = async (id: string, fn: () => Promise<void>) => {
    if (!on(id)) {
      outcomes.set(id, "disabled");
      return;
    }
    try {
      await fn();
      outcomes.set(id, "mounted");
    } catch (err) {
      outcomes.set(id, "error");
      errors.set(id, err instanceof Error ? err.message : String(err));
    }
  };
  const required = (id: string) => outcomes.set(id, "mounted");

  // Core services. Each `ctx.plugin` resolves once the plugin is mounted;
  // the returned fibers are disposed in reverse order by the handle.
  await mount(LlmRuntime);
  required("llm");
  // The native DeepSeek adapter owns the `deepseek-official` provider
  // route (inject: ["llm"]). Without it the route does not exist and
  // every agent request fails downstream. The advertised catalog is
  // deepseek-v4-flash / deepseek-v4-pro.
  await mount(DeepSeekLlm);
  required("llm-deepseek");
  await mount(AgentRegistry);
  required("agents");
  await mount(AgentDefaultModelConfig, {
    provider: "deepseek-official",
    model: opts.model ?? "deepseek-v4-flash",
  });
  required("agent-default-model");
  await mount(SessionStore);
  required("sessions");

  // Durable session logs (`ctx.sessionPersistence`, inject: ["sessions"]).
  // The backend subscribes to `session/event` and writes append-only JSONL
  // per session, grouped under per-project directories derived from the
  // session's `meta.cwd`; `list()` reads headers only. Must mount before
  // any agent is created so no turn escapes persistence.
  await mount(SessionPersistenceJsonl, {
    root: path.join(dshHome(), "sessions"),
  });
  required("session-persistence");

  // Agent driver stack. `AgentRegistry.create()` requires a registered
  // agent factory ("no agent factory registered" otherwise); the concrete
  // factory is `AgentLoop`, which injects ["agents", "sessions", "llm",
  // "tools", "systemPrompt"] — so SystemPrompt and ToolRuntime must be
  // mounted alongside it. All three configs default cleanly for a plain
  // chat deployment (no declarative agents, empty tool registry).
  await mount(SystemPrompt);
  required("system-prompt");
  await mount(ToolRuntime);
  required("tools");
  await mount(AgentLoop);
  required("agent-loop");

  // Credential store (`$DSH_HOME/.credentials.yaml`, file-backed, 0600).
  // The DeepSeek adapter resolves `$DEEPSEEK_API_KEY` through the
  // `credentials` service first (process env still wins inside the
  // service's layering), so mounting this lets the user set the key from
  // the webview instead of relaunching VS Code with an env var.
  await mount(LocalCredentialProvider);
  required("credentials");

  // Permissions (optional): approval service (`ctx.approval`) resolving
  // `ask` pre-execute decisions through the `approval/request`
  // waterfall, the preset gate on `tools/pre-execute`, the webview
  // answerer, and the mutating tools (`write_file`, `run_command`).
  let disposePermissions: (() => void) | undefined;
  await mountOptional("permissions", async () => {
    await mount(UserApproval);
    const disposeGate = registerPermissionGate(ctx as unknown as DshCtx);
    const disposeAnswerer = registerApprovalAnswerer(ctx as unknown as DshCtx);
    const disposeWriteTools = registerWriteTools(ctx as unknown as DshCtx);
    disposePermissions = () => {
      disposeWriteTools();
      disposeAnswerer();
      disposeGate();
    };
  });

  // Interactive Q&A (optional): `ask_user` lets the model pause mid-turn
  // and ask the user a question; the webview answer becomes the tool
  // result. Must run after ToolRuntime (it writes to `ctx.tools`).
  let disposeAskUser: (() => void) | undefined;
  await mountOptional("ask-user", async () => {
    disposeAskUser = registerAskUser(ctx as unknown as DshCtx);
  });

  // Workspace awareness (optional). Must run after ToolRuntime and
  // SystemPrompt are mounted (registerWorkspace writes to both). Without
  // BootOptions.workspace there is nothing to register.
  let disposeWorkspace: (() => void) | undefined;
  if (opts.workspace) {
    await mountOptional("workspace", async () => {
      disposeWorkspace = registerWorkspace(ctx as unknown as DshCtx, opts.workspace!);
    });
  } else {
    outcomes.set("workspace", "disabled");
  }

  // Human command plane (optional): `ctx.commands` plus the basic
  // compaction backend and its `/compact` command. Mount order is
  // inject-driven: CommandRuntime → TokenMeter → CompactionBasic
  // (inject: ["llm", "tokenMeter", "sessions"]) → CommandCompact
  // (inject: ["commands", "compaction"]).
  await mountOptional("commands", async () => {
    await mount(CommandRuntime);
    await mount(TokenMeter);
    await mount(CompactionBasic);
    await mount(CommandCompact);
  });

  // User plugins come last so every core service (llm, agents, sessions,
  // tools, systemPrompt, credentials) is already on the context when
  // they mount. Per-plugin failures are isolated inside loadUserPlugins.
  let userPlugins: { plugins: PluginInfo[]; dispose: () => Promise<void> } = {
    plugins: [],
    dispose: async () => {},
  };
  if (opts.pluginsDir) {
    await mountOptional("user-plugins", async () => {
      userPlugins = await loadUserPlugins(ctx as unknown as DshCtx, opts.pluginsDir!);
    });
  } else {
    outcomes.set("user-plugins", "disabled");
  }

  const runtimePlugins: RuntimePluginInfo[] = RUNTIME_PLUGINS.map((meta) => ({
    ...meta,
    enabled: meta.required || !disabled.has(meta.id),
    status: outcomes.get(meta.id) ?? "mounted",
    ...(errors.has(meta.id) ? { error: errors.get(meta.id) } : null),
  }));

  let disposed = false;
  return {
    ctx: ctx as unknown as DshCtx,
    plugins: userPlugins.plugins,
    runtimePlugins,
    get disposed() {
      return disposed;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await userPlugins.dispose();
      disposeWorkspace?.();
      disposeAskUser?.();
      disposePermissions?.();
      for (const fiber of fibers.reverse()) {
        await fiber.dispose();
      }
    },
  };
}
