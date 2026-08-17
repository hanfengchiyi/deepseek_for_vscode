/**
 * Mutating workspace tools: `write_file` and `run_command`.
 *
 * Both are confined to the workspace root and both are on the
 * permission gate's mutating list (./permissions.ts) — under the
 * default `workspace-write` preset every call pauses for user approval
 * in the chat view before it executes.
 *
 * `run_command` goes through the platform shell with a hard timeout and
 * capped output; it is a convenience for tests/builds, not a sandbox —
 * real OS-level confinement is `dsh-sandbox-local`'s job and remains a
 * later milestone.
 */
import { exec as execShell } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { DshCtx } from "./boot";
import { resolveInside, workspaceRoot } from "./workspace";

const MAX_OUTPUT_CHARS = 64 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;

interface ToolsLike {
  register(definition: unknown): () => void;
}

function text(value: string): { type: "text"; text: string }[] {
  return [{ type: "text", text: value }];
}

/**
 * Register the mutating tools on `ctx.tools`. Returns a combined
 * disposer that unregisters both.
 */
export function registerWriteTools(ctx: DshCtx): () => void {
  const tools = ctx.tools as ToolsLike | undefined;
  if (!tools) {
    throw new Error("DSH ctx.tools is not available; cannot register write tools");
  }
  const disposers: Array<() => void> = [];

  disposers.push(
    tools.register(
      defineTool({
        name: "write_file",
        description:
          "Write a file in the user's VS Code workspace, creating parent " +
          "directories as needed and overwriting existing content. Paths are " +
          "relative to the workspace root. Requires user approval unless the " +
          "permission preset is full-access.",
        parameters: {
          path: {
            type: "string",
            required: true,
            description: "File path relative to the workspace root.",
          },
          content: {
            type: "string",
            required: true,
            description: "Full file content to write.",
          },
        },
        output: {
          schema: { type: "string" },
          render: (_args, value) => text(value),
        },
        isConcurrencySafe: () => false,
        async execute(args) {
          const file = resolveInside(workspaceRoot(), args.path);
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, args.content, "utf8");
          return `wrote ${args.content.length} bytes to ${args.path}`;
        },
      }),
    ),
  );

  disposers.push(
    tools.register(
      defineTool({
        name: "run_command",
        description:
          `Run a shell command in the workspace root (platform default shell, ` +
          `${COMMAND_TIMEOUT_MS / 1000}s timeout, output capped at ` +
          `${MAX_OUTPUT_CHARS / 1024}KB). Requires user approval unless the ` +
          `permission preset is full-access.`,
        parameters: {
          command: {
            type: "string",
            required: true,
            description: "The shell command to run.",
          },
        },
        output: {
          schema: { type: "string" },
          render: (_args, value) => text(value),
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          return await new Promise<string>((resolve, reject) => {
            const child = execShell(
              args.command,
              {
                cwd: workspaceRoot(),
                timeout: COMMAND_TIMEOUT_MS,
                maxBuffer: MAX_OUTPUT_CHARS * 2,
                windowsHide: true,
              },
              (error, stdout, stderr) => {
                const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).slice(
                  0,
                  MAX_OUTPUT_CHARS,
                );
                if (error) {
                  reject(
                    new Error(
                      `command failed (${error.message}):\n${out || "(no output)"}`,
                    ),
                  );
                } else {
                  resolve(out || "(no output)");
                }
              },
            );
            exec.signal?.addEventListener(
              "abort",
              () => {
                child.kill();
                reject(new Error("command cancelled: the turn was aborted"));
              },
              { once: true },
            );
          });
        },
      }),
    ),
  );

  return () => disposers.forEach((d) => d());
}
