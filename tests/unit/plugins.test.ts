/**
 * Tests for user-plugin loading (`src/dsh-bridge/plugins.ts`).
 *
 * Uses a temp directory of real plugin modules and a mocked Cordis
 * `ctx.plugin` — no real DSH runtime needed. Covers: file modules are
 * mounted, folder modules (package.json) are mounted, non-modules are
 * skipped, a throwing plugin is isolated as `status: "error"` without
 * sinking the others, and a missing directory yields an empty list.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadUserPlugins } from "../../src/dsh-bridge/plugins";
import type { DshCtx } from "../../src/dsh-bridge/boot";

let tmpDir: string | undefined;

// Vitest runs in a vm context where the production `new Function`
// dynamic-import shim has no import callback; plain `import()` works.
const testImport = (specifier: string) => import(specifier);

async function makePluginsDir(files: Record<string, string>): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-plugins-"));
  for (const [name, content] of Object.entries(files)) {
    const abs = path.join(tmpDir, name);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return tmpDir;
}

function makeCtx() {
  const mounted: unknown[] = [];
  const fibers: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
  const ctx = {
    plugin: vi.fn(async (plugin: unknown) => {
      mounted.push(plugin);
      const fiber = { dispose: vi.fn() };
      fibers.push(fiber);
      return fiber;
    }),
  } as unknown as DshCtx;
  return { ctx, mounted, fibers };
}

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

describe("loadUserPlugins", () => {
  it("returns an empty list when the directory does not exist", async () => {
    const { ctx, mounted } = makeCtx();
    const { plugins } = await loadUserPlugins(ctx, path.join(os.tmpdir(), "no-such-dir-xyz"), testImport);
    expect(plugins).toEqual([]);
    expect(mounted).toEqual([]);
  });

  it("mounts file modules and folder modules, skipping non-modules", async () => {
    const dir = await makePluginsDir({
      "good.js": "module.exports = function goodPlugin() {}",
      "folder-plugin/package.json": JSON.stringify({ name: "folder-plugin", main: "index.js" }),
      "folder-plugin/index.js": "module.exports = function folderPlugin() {}",
      "README.md": "# not a plugin",
      "empty-folder/.keep": "",
    });
    const { ctx, mounted } = makeCtx();
    const { plugins } = await loadUserPlugins(ctx, dir, testImport);

    // Sorted entries: README.md (non-module) and empty-folder (no
    // package.json) are skipped; the other two mount.
    expect(plugins.map((p) => [p.id, p.status])).toEqual([
      ["folder-plugin", "loaded"],
      ["good.js", "loaded"],
    ]);
    expect(mounted).toHaveLength(2);
  });

  it("isolates a failing plugin without sinking the others", async () => {
    const dir = await makePluginsDir({
      "a-ok.js": "module.exports = function okPlugin() {}",
      "b-bad.js": "throw new Error('broken on import')",
      "c-ok.js": "module.exports = function anotherOk() {}",
    });
    const { ctx, mounted } = makeCtx();
    const { plugins } = await loadUserPlugins(ctx, dir, testImport);

    expect(plugins.map((p) => p.status)).toEqual(["loaded", "error", "loaded"]);
    expect(plugins[1].error).toContain("broken on import");
    expect(mounted).toHaveLength(2);
  });

  it("dispose() unmounts every mounted plugin", async () => {
    const dir = await makePluginsDir({
      "good.js": "module.exports = function goodPlugin() {}",
    });
    const { ctx, fibers } = makeCtx();
    const { dispose } = await loadUserPlugins(ctx, dir, testImport);
    expect(fibers).toHaveLength(1);
    await dispose();
    expect(fibers[0].dispose).toHaveBeenCalledTimes(1);
  });
});
