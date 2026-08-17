/**
 * History tests against the real stack (same no-mock approach as
 * `boot.real.test.ts`): boot with a temp workspace AND a temp DSH_HOME,
 * write a session through the real JSONL persistence backend, then read
 * it back through `listHistory` / `loadTranscript` and resurrect it via
 * `resumeSession` in a SECOND boot (same home) — the real restart path.
 *
 * `buildTranscript` is additionally unit-tested as a pure function over
 * hand-built event logs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { bootDsh, type DshHandle } from "../../src/dsh-bridge/boot";
import { subscribeDshEvents } from "../../src/dsh-bridge/events";
import {
  buildTranscript,
  listHistory,
  loadSessionPreset,
  loadSessionStats,
  loadTranscript,
} from "../../src/dsh-bridge/history";
import { getOrCreateSession, resumeSession } from "../../src/dsh-bridge/sessions";

/** Append one user message to the agent's session and flush it to disk. */
async function appendUserMessage(handle: DshHandle, sessionId: string, text: string) {
  const agents = handle.ctx.agents as { get(id: string): { session: unknown } | undefined };
  const agent = agents.get(sessionId);
  if (!agent) throw new Error(`agent ${sessionId} is not live`);
  const session = agent.session as {
    append(type: string, data: unknown, opts?: unknown): unknown;
  };
  session.append(
    "user/message",
    {
      id: `m-${Date.now()}`,
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "user" },
    },
    { surfaceOp: "append" },
  );
  const sessions = handle.ctx.sessions as {
    get(id: string): unknown;
    flush(session: unknown): Promise<boolean>;
  };
  await sessions.flush(sessions.get(sessionId));
}

describe("session history (real persistence, two boots)", () => {
  let root: string;
  let home: string;
  let savedHome: string | undefined;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-hist-ws-"));
    home = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-hist-home-"));
    savedHome = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
  });

  afterAll(async () => {
    if (savedHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = savedHome;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it("persists a session, lists it with a title, reloads and resumes it", async () => {
    // Boot 1: create a session and persist one user message.
    const first = await bootDsh({ workspace: { root, name: "demo" } });
    try {
      await getOrCreateSession(first.ctx, "s-history-1", "ptc");
      await appendUserMessage(first, "s-history-1", "hello persisted history");
    } finally {
      await first.dispose();
    }

    // Boot 2 (the "restart"): history lists the session, the transcript
    // rebuilds, and resume brings back a live agent.
    const second = await bootDsh({ workspace: { root, name: "demo" } });
    try {
      const history = await listHistory(second.ctx);
      const entry = history.find((h) => h.id === "s-history-1");
      expect(entry).toBeDefined();
      expect(entry!.title).toContain("hello persisted history");

      const transcript = await loadTranscript(second.ctx, "s-history-1");
      expect(transcript).toHaveLength(1);
      expect(transcript[0]).toMatchObject({ role: "user", content: "hello persisted history" });

      // The preset stamped at creation survives the restart via the log
      // header; the cold-log stats replay yields a zeroed snapshot for a
      // session with only a user message.
      expect(await loadSessionPreset(second.ctx, "s-history-1")).toBe("ptc");
      expect(await loadSessionStats(second.ctx, "s-history-1")).toMatchObject({
        turns: 0,
        steps: 0,
        inputTokens: 0,
      });

      const resumed = await resumeSession(second.ctx, "s-history-1");
      expect(resumed.id).toBe("s-history-1");
      expect(resumed.raw).toBeTruthy();
    } finally {
      await second.dispose();
    }
  }, 60000);

  it("does not list sessions from other workspaces", async () => {
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-hist-other-"));
    const other = await bootDsh({ workspace: { root: otherRoot, name: "other" } });
    try {
      const history = await listHistory(other.ctx);
      expect(history.some((h) => h.id === "s-history-1")).toBe(false);
    } finally {
      await other.dispose();
      await fs.rm(otherRoot, { recursive: true, force: true });
    }
  }, 60000);

  it("flushes the session log at every turn/end (durability checkpoint)", async () => {
    // The persistence plugin batches writes with a short delay and drains
    // on dispose, but a window reload can kill the extension host before
    // the dispose drain completes. `subscribeDshEvents` flushes at each
    // `turn/end` — the same checkpoint dsh-headless uses — so a finished
    // turn is durable even when the host dies abruptly. This test
    // appends a turn WITHOUT any manual flush and expects the log to be
    // complete after a "restart".
    const first = await bootDsh({ workspace: { root, name: "demo" } });
    let sub: { close(): void } | undefined;
    try {
      await getOrCreateSession(first.ctx, "s-history-flush");
      sub = subscribeDshEvents(first.ctx, () => {});
      await appendUserMessage(first, "s-history-flush", "flushed without manual checkpoint");
      const agents = first.ctx.agents as {
        get(id: string): { session: { append(t: string, d: unknown, o?: unknown): unknown } };
      };
      agents.get("s-history-flush")!.session.append(
        "turn/end",
        { turn: 1, reason: { kind: "completed" } },
      );
      // Give the async flush a moment to drain to disk.
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      sub?.close();
      await first.dispose();
    }

    const second = await bootDsh({ workspace: { root, name: "demo" } });
    try {
      const history = await listHistory(second.ctx);
      const entry = history.find((h) => h.id === "s-history-flush");
      expect(entry).toBeDefined();
      expect(entry!.title).toContain("flushed without manual checkpoint");
    } finally {
      await second.dispose();
    }
  }, 60000);
});

describe("listHistory cwd matching", () => {
  /** Minimal ctx stub: only `sessionPersistence` is consumed. */
  function ctxWith(headers: Array<{ id: string; createdAt: number; cwd?: string }>) {
    return {
      sessionPersistence: {
        list: async () => headers,
        inspect: async () => ({ events: [] }),
      },
    } as never;
  }

  it("matches the workspace root regardless of drive-letter case on win32", async () => {
    const cwd = process.cwd();
    const flipped =
      /^[a-zA-Z]:/.test(cwd)
        ? (cwd[0] === cwd[0]!.toLowerCase()
            ? cwd[0]!.toUpperCase()
            : cwd[0]!.toLowerCase()) + cwd.slice(1)
        : cwd;
    const history = await listHistory(
      ctxWith([{ id: "s-case", createdAt: 1, cwd: flipped }]) as never,
    );
    if (process.platform === "win32") {
      // `d:\…` (vscode.Uri.fsPath) and `D:\…` (process.cwd) name the
      // same folder; the filter must not hide such sessions.
      expect(history.map((h) => h.id)).toEqual(["s-case"]);
    } else {
      expect(history.map((h) => h.id)).toEqual(flipped === cwd ? ["s-case"] : []);
    }
  });

  it("still excludes sessions from other workspaces", async () => {
    const history = await listHistory(
      ctxWith([{ id: "s-else", createdAt: 1, cwd: "/definitely/elsewhere" }]) as never,
    );
    expect(history).toEqual([]);
  });
});

describe("buildTranscript (pure mapping)", () => {
  it("rebuilds user, assistant, thinking, tool calls and usage", () => {
    const messages = buildTranscript([
      {
        type: "user/message",
        seq: 1,
        data: { content: [{ type: "text", text: "what does this do?" }] },
      },
      {
        type: "assistant/chunk",
        seq: 2,
        data: { turn: 1, step: 1, chunk: { type: "reasoning-delta", text: "thinking…" } },
      },
      {
        type: "assistant/chunk",
        seq: 3,
        data: { turn: 1, step: 1, chunk: { type: "text-delta", text: "It reads " } },
      },
      {
        type: "assistant/chunk",
        seq: 4,
        data: { turn: 1, step: 1, chunk: { type: "text-delta", text: "a file." } },
      },
      {
        type: "tool/call",
        seq: 5,
        data: { turn: 1, step: 1, callId: "c1", name: "read_file", arguments: '{"path":"a.ts"}' },
      },
      {
        type: "tool/result",
        seq: 6,
        data: {
          turn: 1,
          step: 1,
          message: {
            source: { kind: "tool", callId: "c1" },
            content: [{ content: [{ type: "text", text: "file body" }] }],
          },
        },
      },
      {
        type: "assistant/message",
        seq: 7,
        data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 5 } },
      },
    ] as never);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "what does this do?" });
    const assistant = messages[1];
    expect(assistant.content).toBe("It reads a file.");
    expect(assistant.thinking).toBe("thinking…");
    expect(assistant.toolCalls).toEqual([
      { callId: "c1", name: "read_file", arguments: '{"path":"a.ts"}', ok: true, result: "file body" },
    ]);
    expect(assistant.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("marks failed tool results as not-ok", () => {
    const messages = buildTranscript([
      {
        type: "tool/call",
        seq: 1,
        data: { turn: 1, step: 1, callId: "c1", name: "read_file", arguments: "{}" },
      },
      {
        type: "tool/result",
        seq: 2,
        data: {
          turn: 1,
          step: 1,
          message: { source: { kind: "tool", callId: "c1" } },
          error: { name: "HarnessError", code: "TOOL_FAILED" },
        },
      },
    ] as never);
    expect(messages[0].toolCalls?.[0]).toMatchObject({
      ok: false,
      result: "HarnessError: TOOL_FAILED",
    });
  });

  it("ignores unknown and empty events", () => {
    expect(buildTranscript([])).toEqual([]);
    expect(buildTranscript([{ type: "turn/start", seq: 1, data: {} }] as never)).toEqual([]);
  });
});
