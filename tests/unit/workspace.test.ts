/**
 * Workspace-awareness tests against the real DSH stack (same no-mock
 * approach as `boot.real.test.ts`). Boots `bootDsh` with a temporary
 * directory as the workspace and exercises the three read-only tools
 * through the definitions registered on `ctx.tools`.
 *
 * The system-prompt section is covered implicitly: `registerWorkspace`
 * runs during boot, so a successful boot proves the section registration
 * did not throw. End-to-end prompt assembly is the harness's own concern.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { bootDsh, type DshHandle } from "../../src/dsh-bridge/boot";

interface ToolDefinitionLike {
  name: string;
  execute(args: unknown, exec: unknown): Promise<unknown>;
}

interface ToolsLike {
  get(name: string): ToolDefinitionLike | undefined;
}

/** Minimal exec context; the workspace tools never touch it. */
const FAKE_EXEC = { signal: new AbortController().signal };

describe("registerWorkspace (real boot)", () => {
  let root: string;
  let handle: DshHandle;
  let tools: ToolsLike;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-ws-"));
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "README.md"), "# demo project\nhello workspace\n");
    await fs.writeFile(path.join(root, "src", "main.ts"), "export const answer = 42;\n");
    handle = await bootDsh({
      workspace: { root, name: "demo" },
    });
    tools = handle.ctx.tools as ToolsLike;
  }, 30000);

  afterAll(async () => {
    await handle?.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("registers the three read-only tools", () => {
    expect(tools.get("list_files")?.name).toBe("list_files");
    expect(tools.get("read_file")?.name).toBe("read_file");
    expect(tools.get("search_files")?.name).toBe("search_files");
  });

  it("list_files lists the workspace tree with relative paths", async () => {
    const out = (await tools.get("list_files")!.execute({}, FAKE_EXEC)) as string[];
    expect(out).toContain("README.md");
    expect(out).toContain("src/");
    expect(out).toContain("src/main.ts");
  });

  it("read_file returns numbered lines", async () => {
    const out = (await tools
      .get("read_file")!
      .execute({ path: "README.md" }, FAKE_EXEC)) as string;
    expect(out).toContain("1: # demo project");
    expect(out).toContain("2: hello workspace");
  });

  it("search_files finds literal and regex matches", async () => {
    const literal = (await tools
      .get("search_files")!
      .execute({ pattern: "answer" }, FAKE_EXEC)) as string[];
    expect(literal.some((hit) => hit.startsWith("src/main.ts:1:"))).toBe(true);

    const regex = (await tools
      .get("search_files")!
      .execute({ pattern: "hello\\s+workspace" }, FAKE_EXEC)) as string[];
    expect(regex.some((hit) => hit.startsWith("README.md:2:"))).toBe(true);
  });

  it("rejects paths that escape the workspace root", async () => {
    await expect(
      tools.get("read_file")!.execute({ path: "../outside.txt" }, FAKE_EXEC),
    ).rejects.toThrow(/escapes the workspace root/);
    await expect(
      tools.get("list_files")!.execute({ path: ".." }, FAKE_EXEC),
    ).rejects.toThrow(/escapes the workspace root/);
  });
});
