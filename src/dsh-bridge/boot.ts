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
 *   1. `LlmRuntime`            (registers `ctx.llm`)
 *   2. `dsh-llm-deepseek`      (owns the `deepseek-official` provider route;
 *      its key resolves per request from `$DEEPSEEK_API_KEY` via the
 *      credentials service, endpoint defaults to https://api.deepseek.com)
 *   3. `AgentRegistry`         (registers `ctx.agents`)
 *   4. `AgentDefaultModelConfig` (registers `ctx.agentDefaultModel`)
 *   5. `SessionStore`          (registers `ctx.sessions`, in-memory)
 *   6. `SessionPersistenceJsonl` (registers `ctx.sessionPersistence`,
 *      append-only JSONL logs under `$DSH_HOME/sessions`, grouped into
 *      per-project directories keyed off the session's `meta.cwd`)
 *   7. agent driver stack: `SystemPrompt`, `ToolRuntime`, `AgentLoop`
 *      (`AgentLoop` injects `["agents","sessions","llm","tools",
 *      "systemPrompt"]`; without it, creating an agent throws "no agent
 *      factory registered")
 *   8. `LocalCredentialProvider` (`$DSH_HOME/.credentials.yaml`, 0600)
 *   9. workspace awareness (`./workspace`): prompt section + read-only
 *      tools, when `BootOptions.workspace` is given
 *  10. `ask_user` tool (`./ask-user`): the model can pause mid-turn and
 *      ask the user a question; the webview answer becomes the tool
 *      result. Registered here; the webview-bound event sink is
 *      installed by the view layer via `setAskUserSink`.
 *  11. user plugins (`./plugins`): Cordis plugins found in
 *      `BootOptions.pluginsDir` (convention: `$DSH_HOME/plugins`) are
 *      imported and mounted after every core service; per-plugin
 *      failures are isolated and reported on `DshHandle.plugins`.
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
import { registerAskUser } from "./ask-user";
import { registerWorkspace, type WorkspaceInfo } from "./workspace";
import { loadUserPlugins, type PluginInfo } from "./plugins";

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

export interface DshHandle {
  /** Typed view of the Cordis context's services. */
  ctx: DshCtx;
  /** Load outcome of every user plugin found in `BootOptions.pluginsDir`
   *  (empty when no pluginsDir was given). */
  plugins: PluginInfo[];
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

  // Core services. Each `ctx.plugin` resolves once the plugin is mounted;
  // the returned fibers are disposed in reverse order by the handle.
  await mount(LlmRuntime);
  // The native DeepSeek adapter owns the `deepseek-official` provider
  // route (inject: ["llm"]). Without it the route does not exist and
  // every agent request fails downstream. The advertised catalog is
  // deepseek-v4-flash / deepseek-v4-pro.
  await mount(DeepSeekLlm);
  await mount(AgentRegistry);
  await mount(AgentDefaultModelConfig, {
    provider: "deepseek-official",
    model: opts.model ?? "deepseek-v4-flash",
  });
  await mount(SessionStore);

  // Durable session logs (`ctx.sessionPersistence`, inject: ["sessions"]).
  // The backend subscribes to `session/event` and writes append-only JSONL
  // per session, grouped under per-project directories derived from the
  // session's `meta.cwd`; `list()` reads headers only. Must mount before
  // any agent is created so no turn escapes persistence.
  await mount(SessionPersistenceJsonl, {
    root: path.join(dshHome(), "sessions"),
  });

  // Agent driver stack. `AgentRegistry.create()` requires a registered
  // agent factory ("no agent factory registered" otherwise); the concrete
  // factory is `AgentLoop`, which injects ["agents", "sessions", "llm",
  // "tools", "systemPrompt"] — so SystemPrompt and ToolRuntime must be
  // mounted alongside it. All three configs default cleanly for a plain
  // chat deployment (no declarative agents, empty tool registry).
  await mount(SystemPrompt);
  await mount(ToolRuntime);
  await mount(AgentLoop);

  // Interactive Q&A: `ask_user` lets the model pause mid-turn and ask
  // the user a question; the webview answer becomes the tool result.
  // Must run after ToolRuntime is mounted (it writes to `ctx.tools`).
  const disposeAskUser = registerAskUser(ctx as unknown as DshCtx);

  // Workspace awareness. Must run after ToolRuntime and SystemPrompt are
  // mounted (registerWorkspace writes to both services). The returned
  // disposer unregisters the prompt section and tools.
  const disposeWorkspace = opts.workspace
    ? registerWorkspace(ctx as unknown as DshCtx, opts.workspace)
    : undefined;

  // Credential store (`$DSH_HOME/.credentials.yaml`, file-backed, 0600).
  // The DeepSeek adapter resolves `$DEEPSEEK_API_KEY` through the
  // `credentials` service first (process env still wins inside the
  // service's layering), so mounting this lets the user set the key from
  // the webview instead of relaunching VS Code with an env var.
  await mount(LocalCredentialProvider);

  // User plugins come last so every core service (llm, agents, sessions,
  // tools, systemPrompt, credentials) is already on the context when
  // they mount. Per-plugin failures are isolated inside loadUserPlugins.
  const userPlugins = opts.pluginsDir
    ? await loadUserPlugins(ctx as unknown as DshCtx, opts.pluginsDir)
    : { plugins: [] as PluginInfo[], dispose: async () => {} };

  let disposed = false;
  return {
    ctx: ctx as unknown as DshCtx,
    plugins: userPlugins.plugins,
    get disposed() {
      return disposed;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await userPlugins.dispose();
      disposeWorkspace?.();
      disposeAskUser();
      for (const fiber of fibers.reverse()) {
        await fiber.dispose();
      }
    },
  };
}
