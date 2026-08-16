/**
 * Thin Cordis wrapper around `@deepseek-ai/dsh-headless`.
 *
 * The real `@deepseek-ai/dsh-headless@0.1.0-rc.6` exports a Cordis `apply` plugin
 * (not a `createHeadlessApp` factory). The `apply` plugin requires:
 *
 *   1. a host-provided `ctx.appExit` hook (synchronously read at mount), and
 *   2. three core services — `ctx.agents`, `ctx.agentDefaultModel`,
 *      `ctx.sessions` — to be available before the headless tree mounts.
 *
 * This wrapper:
 *
 *   1. creates a Cordis root `Context`,
 *   2. registers `ctx.appExit` as a no-op host hook (so the launcher does
 *      not call `process.exit` from unit tests; pass `appExit` in
 *      {@link BootOptions} to override),
 *   3. registers the four core Cordis plugins — `LlmRuntime`,
 *      `AgentRegistry`, `SessionStore`, `AgentDefaultModelConfig` — in an
 *      order that satisfies the headless `inject` list,
 *   4. mounts the headless plugin via `ctx.plugin(headless, { task: profile })`,
 *   5. returns a {@link DshHandle} whose `dispose()` is idempotent and
 *      tears down the headless fiber.
 *
 * The headless `apply` is the real upstream plugin; nothing here is mocked
 * at the dsh-headless boundary, so a real boot is exercised end-to-end.
 */
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { apply as headlessApply, type Config as HeadlessConfig } from "@deepseek-ai/dsh-headless";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentDefaultModelConfig from "@deepseek-ai/dsh-agent-default-model";
import SessionStore from "@deepseek-ai/dsh-session";
import LlmRuntime from "@deepseek-ai/dsh-llm";

export interface BootOptions {
  /** DSH profile. The headless plugin's `apply` is the only one wired up
   *  in M1; "web" is reserved for a later milestone that bundles the Web
   *  UI. */
  profile?: "headless" | "web";
  /** Optional model override. The headless plugin reads its model from
   *  the injected `agentDefaultModel` service, so this is reserved for
   *  M2+ and ignored here. */
  model?: string;
  /** The host-provided exit hook the headless plugin reads at mount via
   *  `ctx.get("appExit")`. Defaults to a no-op so unit tests do not
   *  call `process.exit`; a real launcher passes `process.exit`. */
  appExit?: (code: number) => void;
}

/** Minimal Cordis ctx surface we depend on. Deliberately narrow so the
 *  bridge compiles even when upstream adds more services. */
export interface DshCtx {
  [key: string]: unknown;
}

/** Headless application handle. `start`/`stop` are no-op lifecycle
 *  hooks kept for symmetry with the real boot path; the plugin is
 *  registered during `bootDsh`. */
export interface HeadlessApp {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The Cordis context the headless plugin runs in. */
  ctx: DshCtx;
  /** Profile name this handle was booted with. */
  profile: string;
}

export interface DshHandle {
  /** Typed view of the Cordis context's services. */
  ctx: DshCtx;
  /** The Cordis fiber for the headless plugin; `dispose()` unloads it. */
  fiber: Fiber;
  /** Lifecycle facade kept for symmetry with the M1 test contract. */
  app: HeadlessApp;
  /** Whether `dispose()` has been called. */
  disposed: boolean;
  /** Idempotent disposer; safe to call multiple times. */
  dispose(): Promise<void>;
}

/** Boot a headless DSH runtime and return a handle.
 *
 *  Registers the host hook + core services in this order:
 *    1. `ctx.appExit`           (host hook, must exist before headless mounts)
 *    2. `LlmRuntime`            (registers `ctx.llm`)
 *    3. `AgentRegistry`         (registers `ctx.agents`)
 *    4. `AgentDefaultModelConfig` (registers `ctx.agentDefaultModel`)
 *    5. `SessionStore`          (registers `ctx.sessions`)
 *    6. `headless.apply`        (mounts the one-shot driver)
 *
 *  @param opts - {@link BootOptions}; all fields are optional and default to
 *                a headless profile, no model override, and a no-op
 *                `appExit` (so tests do not call `process.exit`).
 *  @returns a {@link DshHandle} whose `dispose()` is idempotent.
 */
export async function bootDsh(opts: BootOptions = {}): Promise<DshHandle> {
  const profile = opts.profile ?? "headless";
  const appExit = opts.appExit ?? (() => {
    /* no-op default: the headless plugin's `apply` reads `ctx.appExit`
     * synchronously and later calls it on task completion. Unit tests
     * rely on the no-op so a real launcher's `process.exit` is not
     * invoked during boot verification. */
  });
  const ctx = new Context();

  // 1. Host hook — must be provided before `headless.apply` mounts,
  //    because the headless `apply` reads `ctx.get("appExit")`
  //    synchronously and throws otherwise.
  ctx.provide("appExit", appExit);

  // 2. Core services. `headless.apply` declares
  //    `inject: ["agentDefaultModel", "agents", "sessions"]`, so
  //    Cordis blocks headless mount until all three are provided.
  //    Order here is not enforced by Cordis (each plugin is loaded
  //    eagerly) but mirrors the headless `inject` list to keep the
  //    wiring readable.
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: opts.model ? "deepseek-official" : "deepseek-official",
    model: opts.model ?? "deepseek-v4-flash",
  });
  await ctx.plugin(SessionStore);

  // 3. Mount the headless plugin. The plugin's `Config` schema is
  //    `{ task: string }`; we pass the profile name as the task so
  //    the requested profile is observable through the handle.
  const fiber: Fiber = await ctx.plugin(headlessApply, {
    task: profile,
  } as HeadlessConfig);

  let disposed = false;
  const app: HeadlessApp = {
    async start() {
      // No-op: by the time `ctx.plugin(...)` resolves, the plugin is
      // already mounted. Kept for symmetry with `stop` and for future
      // re-mount scenarios.
    },
    async stop() {
      // Soft pause hook; disposal is handled by `dispose()` below.
    },
    ctx: ctx as unknown as DshCtx,
    profile,
  };

  return {
    ctx: ctx as unknown as DshCtx,
    fiber,
    app,
    get disposed() {
      return disposed;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await fiber.dispose();
    },
  };
}
