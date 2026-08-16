/**
 * `ask_user` tool: lets the model pause mid-turn and ask the user a
 * question, answered through a card in the chat webview.
 *
 * Flow:
 *   1. The model calls `ask_user({ question, options? })`.
 *   2. `execute` parks on a Promise and emits a `question.request`
 *      webview event through the sink installed by the view layer
 *      ({@link setAskUserSink}).
 *   3. The webview's answer returns as a `question.answer` host command;
 *      the router calls {@link answerQuestion}, which settles the parked
 *      Promise — the answer text becomes the tool result and flows back
 *      to the model through the normal `tool/result` path.
 *
 * Cancellation: the tool observes `exec.signal` (aborted when the turn
 * is cancelled upstream); {@link cancelSessionQuestions} is the belt-and-
 * braces path invoked by the router on `chat.cancel`, and the disposer
 * returned by {@link registerAskUser} rejects everything still parked
 * when the runtime shuts down. A rejected Promise materializes as a
 * failed tool result, so the model sees the refusal instead of hanging.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { DshCtx } from "./boot";
import type { WebviewEvent } from "../shared/protocol";

interface PendingQuestion {
  sessionId: string;
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
  /** Detaches the abort listener; run on every settle path. */
  cleanup: () => void;
}

/** questionId → parked tool execution. Module-level: the DSH runtime is
 *  a singleton per extension host, and at most one chat view is live. */
const pending = new Map<string, PendingQuestion>();
let seq = 0;

/** Current webview-bound event sink; installed by the view layer on
 *  attach and cleared on dispose. Undefined while no chat view is
 *  connected — tool executions then fail fast instead of parking
 *  forever. */
let sink: ((ev: WebviewEvent) => void) | undefined;

export function setAskUserSink(fn: ((ev: WebviewEvent) => void) | undefined): void {
  sink = fn;
}

/** Settle the parked execution waiting on `questionId`. Unknown ids
 *  (already settled, or from a previous webview lifetime) are ignored. */
export function answerQuestion(questionId: string, answer: string): void {
  const entry = pending.get(questionId);
  if (!entry) return;
  pending.delete(questionId);
  entry.cleanup();
  entry.resolve(answer);
}

/** Reject every parked question of one session (user hit stop). */
export function cancelSessionQuestions(sessionId: string): void {
  for (const [id, entry] of pending) {
    if (entry.sessionId !== sessionId) continue;
    pending.delete(id);
    entry.cleanup();
    entry.reject(new Error("question cancelled by the user"));
  }
}

interface ToolsLike {
  register(definition: unknown): () => void;
}

/**
 * Register the `ask_user` tool on `ctx.tools`. Returns a disposer that
 * unregisters the tool and rejects all parked questions.
 */
export function registerAskUser(ctx: DshCtx): () => void {
  const tools = ctx.tools as ToolsLike | undefined;
  if (!tools) {
    throw new Error("DSH ctx.tools is not available; cannot register ask_user");
  }

  const unregister = tools.register(
    defineTool({
      name: "ask_user",
      description:
        "Ask the user a question in the chat UI and wait for their answer. " +
        "Use when you need a clarification, a decision, or missing information " +
        "before you can proceed. Provide 2-4 short `options` when the likely " +
        "answers are known; the user can always reply with free text instead. " +
        "The result is the user's answer verbatim.",
      parameters: {
        question: {
          type: "string",
          required: true,
          description: "The question to show the user.",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional predefined choices shown as buttons.",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      // A parked question is a global UI focus point; two concurrent
      // questions would fight over the single card.
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        if (!sink) {
          throw new Error("no chat view is connected to answer the question");
        }
        const sessionId =
          (exec.agent as { session?: { id?: string } } | undefined)?.session?.id ?? "";
        const questionId = `q-${Date.now().toString(36)}-${++seq}`;
        const answer = await new Promise<string>((resolve, reject) => {
          const onAbort = () => {
            pending.delete(questionId);
            reject(new Error("question cancelled: the turn was aborted"));
          };
          exec.signal.addEventListener("abort", onAbort, { once: true });
          pending.set(questionId, {
            sessionId,
            resolve,
            reject,
            cleanup: () => exec.signal.removeEventListener("abort", onAbort),
          });
          sink?.({
            v: 1,
            type: "question.request",
            sessionId,
            questionId,
            question: args.question,
            ...(args.options?.length ? { options: args.options } : null),
          });
        });
        return answer;
      },
    }),
  );

  return () => {
    unregister();
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.cleanup();
      entry.reject(new Error("ask_user tool was unregistered"));
    }
  };
}
