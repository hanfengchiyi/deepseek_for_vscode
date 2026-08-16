/**
 * User-level DSH (Cordis) plugins, loaded from a directory at boot.
 *
 * The DSH runtime IS a Cordis plugin system, but the plugins the
 * extension mounts in `boot.ts` are compiled in. This module opens the
 * same seam to the user: every entry in the plugins directory that
 * looks like a module — a `.js` / `.mjs` / `.cjs` file, or a directory
 * with a `package.json` — is dynamically imported and mounted via
 * `ctx.plugin(...)`. A plugin module default-exports (or
 * module-exports) a Cordis plugin: a function `(ctx) => …`, or an
 * object with `apply`.
 *
 * Failure isolation: one bad plugin (syntax error, throwing on mount)
 * is recorded with `status: "error"` and never aborts the boot or the
 * other plugins. The webview's plugin panel reads {@link PluginInfo}
 * records to show what loaded and what failed.
 *
 * The extension-host bundle is CJS, so a literal `import(spec)` here
 * would be rewritten by esbuild; the `Function`-wrapped indirection
 * keeps the specifier runtime-dynamic (Node loads ESM and CJS modules
 * alike through dynamic import).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { DshCtx } from "./boot";

export interface PluginInfo {
  /** Directory entry name (file name or folder name). */
  id: string;
  /** Absolute path that was imported. */
  path: string;
  status: "loaded" | "error";
  /** Mount/import failure message when status is "error". */
  error?: string;
}

interface FiberLike {
  dispose(): Promise<void> | void;
}

interface PluginCtx {
  plugin(plugin: unknown, config?: unknown): Promise<FiberLike>;
}

/** esbuild-safe runtime dynamic import (see module docstring). Note:
 *  under vitest (vm context) this specific form hits
 *  ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING — tests inject a plain
 *  `import()` via the `importModule` parameter instead. */
const runtimeImport: (specifier: string) => Promise<Record<string, unknown>> = new Function(
  "specifier",
  "return import(specifier)",
) as never;

async function isLoadableModule(entry: string, abs: string): Promise<boolean> {
  const stat = await fs.stat(abs).catch(() => undefined);
  if (!stat) return false;
  if (stat.isFile()) return /\.[cm]?js$/.test(entry);
  if (stat.isDirectory()) {
    return fs
      .access(path.join(abs, "package.json"))
      .then(() => true)
      .catch(() => false);
  }
  return false;
}

/**
 * Mount every loadable module found directly inside `dir`. A missing
 * or empty directory is not an error — it just yields an empty list.
 *
 * Returns the per-plugin records (for the webview panel) and a
 * disposer that unmounts every successfully mounted plugin.
 */
export async function loadUserPlugins(
  ctx: DshCtx,
  dir: string,
  importModule: (specifier: string) => Promise<Record<string, unknown>> = runtimeImport,
): Promise<{ plugins: PluginInfo[]; dispose(): Promise<void> }> {
  const plugins: PluginInfo[] = [];
  const fibers: FiberLike[] = [];
  const cordis = ctx as unknown as PluginCtx;

  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  entries.sort();
  for (const entry of entries) {
    const abs = path.join(dir, entry);
    if (!(await isLoadableModule(entry, abs))) continue;
    try {
      const mod = await importModule(pathToFileURL(abs).href);
      const plugin = (mod.default ?? mod) as unknown;
      const fiber = await cordis.plugin(plugin);
      fibers.push(fiber);
      plugins.push({ id: entry, path: abs, status: "loaded" });
    } catch (err) {
      plugins.push({
        id: entry,
        path: abs,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    plugins,
    async dispose() {
      for (const fiber of fibers.reverse()) {
        await fiber.dispose();
      }
    },
  };
}
