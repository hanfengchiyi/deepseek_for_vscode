/**
 * Thin Cordis wrapper around `@deepseek-ai/dsh-headless`.
 *
 * The brief for this task assumed a non-existent `createHeadlessApp`
 * factory on `@deepseek-ai/dsh-headless`. The real `0.1.0-rc.6` package
 * exports a Cordis plugin (`apply`, `name`, `inject`, `Config`, `internals`)
 * and carries no app-level factory. So this wrapper:
 *
 *   1. creates a Cordis root `Context`,
 *   2. registers the headless plugin's `apply` via `ctx.plugin`,
 *   3. returns a `DshHandle` whose `dispose()` is idempotent.
 *
 * The M1 test mocks both packages; the real boot path requires the
 * launcher-provided `appExit` host hook plus the core services
 * (`agents`, `sessions`, `agentDefaultModel`) — wiring those is a later
 * milestone (Task 12 integration test).
 */
import { Context, type Fiber } from "@deepseek-ai/cordis";
import { apply as headlessApply } from "@deepseek-ai/dsh-headless";

export interface BootOptions {
  /** DSH profile. The headless plugin's `apply` is the only one wired up
   *  in M1; "web" is reserved for a later milestone that bundles the Web
   *  UI. */
  profile?: "headless" | "web";
  /** Optional model override. The headless plugin reads its model from
   *  the injected `agentDefaultModel` service, so this is reserved for
   *  M2+ and ignored here. */
  model?: string;
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
  app: HeadlessApp;
  /** Whether `dispose()` has been called. */
  disposed: boolean;
  /** Idempotent disposer; safe to call multiple times. */
  dispose(): Promise<void>;
}

/** Boot a headless DSH runtime and return a handle.
 *
 *  @param opts - {@link BootOptions}; both fields are optional and
 *                default to a headless profile with no model override.
 *  @returns a {@link DshHandle} whose `dispose()` is idempotent.
 */
export async function bootDsh(opts: BootOptions = {}): Promise<DshHandle> {
  const profile = opts.profile ?? "headless";
  const ctx = new Context();
  // Register the headless plugin. The plugin's `Config` schema is
  // `{ task: string }`; we pass the profile name as the task so the
  // requested profile is observable through the handle (and through the
  // mocked `apply` call args in the unit test).
  const fiber: Fiber = await ctx.plugin(headlessApply, { task: profile });

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
