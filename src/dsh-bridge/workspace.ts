/**
 * Workspace awareness for the DSH runtime.
 *
 * Two contributions, both rooted at the first VS Code workspace folder:
 *
 *   1. a dynamic system-prompt section (`dsh-system-prompt`) telling the
 *      model which folder the user has open — evaluated at each prompt
 *      assembly so the date stays fresh;
 *   2. three read-only tools (`dsh-tools`) — `list_files`, `read_file`,
 *      `search_files` — so the agent can actually inspect the project
 *      instead of answering "I have no project context".
 *
 * Every tool path is confined to the workspace root (`resolveInside`);
 * mutating tools (write/run) are deliberately NOT registered here — they
 * need the `tools/pre-execute` approval gate and ship separately.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { DshCtx } from "./boot";

export interface WorkspaceInfo {
  /** Absolute path of the workspace folder (`vscode.Uri.fsPath`). */
  root: string;
  /** Display name (`vscode.WorkspaceFolder.name`). */
  name: string;
}

/** The workspace root most recently registered via {@link registerWorkspace}
 *  (module-level: the DSH runtime is a singleton per extension host).
 *  Sessions stamp this as their `meta.cwd` so JSONL persistence groups
 *  them under the project directory. Falls back to `process.cwd()` when
 *  no workspace is open. */
let currentRoot: string | undefined;

export function workspaceRoot(): string {
  return currentRoot ?? process.cwd();
}

/** Directories never descended into by listing/search. */
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "out"]);

const MAX_LIST_ENTRIES = 200;
const MAX_LIST_DEPTH = 3;
const MAX_READ_BYTES = 256 * 1024;
const MAX_READ_LINES = 400;
const MAX_SEARCH_HITS = 50;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;

interface SystemPromptLike {
  section(section: {
    name: string;
    order: number;
    text: string | ((context: unknown) => string);
  }): () => void;
}

interface ToolsLike {
  register(definition: unknown): () => void;
}

/** Resolve `p` against the workspace root, rejecting escapes. Exported
 *  for the write tools (./write-tools.ts) which share the same
 *  confinement rule. */
export function resolveInside(root: string, p: string | undefined): string {
  const resolved = path.resolve(root, p ?? ".");
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`path escapes the workspace root: ${p}`);
  }
  return resolved;
}

/** Render `rel` with forward slashes so output is stable across platforms. */
function toRel(root: string, abs: string): string {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  return rel === "" ? "." : rel;
}

async function walk(
  root: string,
  dir: string,
  depth: number,
  out: string[],
  cap: number,
): Promise<void> {
  if (depth < 0 || out.length >= cap) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory: skip, do not fail the whole call
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= cap) return;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      out.push(toRel(root, abs) + "/");
      await walk(root, abs, depth - 1, out, cap);
    } else if (entry.isFile()) {
      out.push(toRel(root, abs));
    }
  }
}

function text(value: string): { type: "text"; text: string }[] {
  return [{ type: "text", text: value }];
}

/**
 * Register the workspace prompt section and read-only tools on `ctx`.
 * Returns a combined disposer that unregisters every contribution.
 */
export function registerWorkspace(ctx: DshCtx, info: WorkspaceInfo): () => void {
  const root = path.resolve(info.root);
  const disposers: Array<() => void> = [];
  currentRoot = root;
  disposers.push(() => {
    if (currentRoot === root) currentRoot = undefined;
  });

  const systemPrompt = ctx.systemPrompt as SystemPromptLike | undefined;
  if (systemPrompt) {
    disposers.push(
      systemPrompt.section({
        name: "vscode-workspace",
        // After the harness identity (-100) and persona (0), before the
        // tool-guidance band (100-199).
        order: 10,
        text: () =>
          `You are running inside Visual Studio Code. The user's workspace folder is ` +
          `"${info.name}" at ${root}. The current date is ${new Date().toISOString()}. ` +
          `When the user asks about "the current project" or their code, use the ` +
          `list_files, read_file, and search_files tools to inspect the workspace ` +
          `before answering instead of saying you have no project context.`,
      }),
    );
  }

  const tools = ctx.tools as ToolsLike | undefined;
  if (!tools) {
    return () => disposers.forEach((d) => d());
  }

  disposers.push(
    tools.register(
      defineTool({
        name: "list_files",
        description:
          "List files and directories in the user's VS Code workspace. " +
          "Paths are relative to the workspace root; directories end with '/'.",
        parameters: {
          path: {
            type: "string",
            description: "Directory to list, relative to the workspace root (default '.').",
          },
          depth: {
            type: "integer",
            description: `Recursion depth, 0-${MAX_LIST_DEPTH} (default 1).`,
          },
        },
        output: {
          schema: { type: "array", items: { type: "string" } },
          render: (_args, value) =>
            text(value.length ? value.join("\n") : "(no files found)"),
        },
        isConcurrencySafe: () => true,
        async execute(args) {
          const dir = resolveInside(root, args.path);
          const depth = Math.min(Math.max(args.depth ?? 1, 0), MAX_LIST_DEPTH);
          const out: string[] = [];
          await walk(root, dir, depth, out, MAX_LIST_ENTRIES);
          return out;
        },
      }),
    ),
  );

  disposers.push(
    tools.register(
      defineTool({
        name: "read_file",
        description:
          "Read a file from the user's VS Code workspace, with line numbers. " +
          "Large files must be paged with offset/limit.",
        parameters: {
          path: {
            type: "string",
            required: true,
            description: "File path relative to the workspace root.",
          },
          offset: {
            type: "integer",
            description: "1-based line number to start from (default 1).",
          },
          limit: {
            type: "integer",
            description: `Maximum lines to return (default ${MAX_READ_LINES}).`,
          },
        },
        output: {
          schema: { type: "string" },
          render: (_args, value) => text(value),
        },
        isConcurrencySafe: () => true,
        async execute(args) {
          const file = resolveInside(root, args.path);
          const stat = await fs.stat(file);
          if (stat.size > MAX_READ_BYTES) {
            throw new Error(
              `file is ${stat.size} bytes (> ${MAX_READ_BYTES}); page it with offset/limit`,
            );
          }
          const content = await fs.readFile(file, "utf8");
          const lines = content.split("\n");
          const start = Math.max((args.offset ?? 1) - 1, 0);
          const limit = Math.min(Math.max(args.limit ?? MAX_READ_LINES, 1), MAX_READ_LINES);
          const slice = lines.slice(start, start + limit);
          return slice.map((line, i) => `${start + i + 1}: ${line}`).join("\n");
        },
      }),
    ),
  );

  disposers.push(
    tools.register(
      defineTool({
        name: "search_files",
        description:
          "Search file contents in the user's VS Code workspace. " +
          "The pattern is a regular expression; invalid regexes fall back to " +
          "a literal substring match. Returns 'file:line: content' hits.",
        parameters: {
          pattern: {
            type: "string",
            required: true,
            description: "Regular expression (or literal text) to search for.",
          },
          path: {
            type: "string",
            description: "Subdirectory to search, relative to the workspace root (default '.').",
          },
        },
        output: {
          schema: { type: "array", items: { type: "string" } },
          render: (_args, value) =>
            text(value.length ? value.join("\n") : "(no matches)"),
        },
        isConcurrencySafe: () => true,
        async execute(args) {
          const dir = resolveInside(root, args.path);
          let re: RegExp;
          try {
            re = new RegExp(args.pattern);
          } catch {
            re = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          }
          const files: string[] = [];
          await walk(root, dir, MAX_LIST_DEPTH * 2, files, 2000);
          const hits: string[] = [];
          for (const rel of files) {
            if (hits.length >= MAX_SEARCH_HITS) break;
            if (rel.endsWith("/")) continue;
            const abs = resolveInside(root, rel);
            const stat = await fs.stat(abs).catch(() => undefined);
            if (!stat || stat.size > MAX_SEARCH_FILE_BYTES) continue;
            const content = await fs.readFile(abs, "utf8").catch(() => undefined);
            const hasNul = content !== undefined && content.indexOf(String.fromCharCode(0)) >= 0;
            if (content === undefined || hasNul) continue; // skip binary
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && hits.length < MAX_SEARCH_HITS; i++) {
              if (re.test(lines[i])) {
                hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              }
            }
          }
          return hits;
        },
      }),
    ),
  );

  return () => disposers.forEach((d) => d());
}
