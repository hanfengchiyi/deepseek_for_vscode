/**
 * Permission presets: the three-way switch shown in the model bar
 * (`read-only` / `workspace-write` / `full-access`) and the tool gate
 * that enforces it.
 *
 * The gate is a `tools/pre-execute` waterfall listener. Mutating tools
 * ({@link MUTATING_TOOLS}) are decided by the current preset:
 *
 *   - `read-only`      → deny outright (the model sees the reason and
 *                        can tell the user to raise the preset);
 *   - `workspace-write`→ `ask` — ToolRuntime routes the ask through the
 *                        approval service (`dsh-user-approval`), whose
 *                        `approval/request` waterfall is answered by the
 *                        webview approval card (./approvals.ts);
 *   - `full-access`    → allow.
 *
 * Read-only tools (and any tool not on the mutating list, e.g. from
 * user plugins) always delegate to `next()`. The preset is per
 * extension host (not per session) and starts at `workspace-write`;
 * persistence is a possible later milestone.
 */
import type { DshCtx } from "./boot";

export type PermissionPreset = "read-only" | "workspace-write" | "full-access";

export const PERMISSION_PRESETS: readonly PermissionPreset[] = [
  "read-only",
  "workspace-write",
  "full-access",
];

/** Tools gated by the preset. Keep in sync with ./write-tools.ts. */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set(["write_file", "run_command"]);

let current: PermissionPreset = "workspace-write";

export function getPreset(): PermissionPreset {
  return current;
}

/** Switch the preset. Unknown values are rejected so untrusted wire
 *  input can never widen the gate. */
export function setPreset(preset: string): PermissionPreset {
  if (!(PERMISSION_PRESETS as readonly string[]).includes(preset)) {
    throw new Error(`unknown permission preset: ${preset}`);
  }
  current = preset as PermissionPreset;
  return current;
}

interface PreExecuteCtx {
  on(
    name: string,
    listener: (
      exec: { name: string },
      next: () => Promise<{ kind: string; reason?: string }>,
    ) => Promise<{ kind: string; reason?: string }>,
  ): () => boolean;
}

/**
 * Install the preset gate on `ctx`. Returns a disposer that removes the
 * listener.
 */
export function registerPermissionGate(ctx: DshCtx): () => void {
  const cordis = ctx as unknown as PreExecuteCtx;
  const dispose = cordis.on("tools/pre-execute", async (exec, next) => {
    if (!MUTATING_TOOLS.has(exec.name)) return next();
    switch (getPreset()) {
      case "read-only":
        return {
          kind: "deny",
          reason:
            `Tool "${exec.name}" mutates state, but the permission preset is ` +
            `read-only. Ask the user to switch to workspace-write or full-access.`,
        };
      case "workspace-write":
        return { kind: "ask" };
      case "full-access":
        return next();
    }
  });
  return () => {
    dispose();
  };
}
