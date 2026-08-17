/**
 * Bridge to the human-command plane (`ctx.commands` from
 * `@deepseek-ai/dsh-commands`): slash commands that act on the runtime
 * without a model turn (`/compact` and any command a user plugin
 * registers).
 *
 * Commands are looked up and executed against the session's live agent —
 * upstream scopes agent-mounted commands under `agent.ctx`, so listing
 * without the agent would miss them. The agent is fetched through
 * `ctx.agents.get(sessionId)`, the same lazy-create seam the chat route
 * uses.
 */
import type { DshCtx } from "./boot";

export interface HostCommandDescriptor {
  name: string;
  description: string;
}

interface AgentLike {
  // Opaque upstream Agent handle; the commands service reads it.
}

interface CommandsService {
  list(agent: AgentLike): Array<{ name: string; description?: string }>;
  execute(
    agent: AgentLike,
    line: string,
    signal?: AbortSignal,
  ): Promise<{ result: { kind: string; text?: string } } | undefined>;
}

interface AgentsService {
  get(id: string): AgentLike;
}

function services(ctx: DshCtx): { commands: CommandsService; agents: AgentsService } {
  const commands = ctx.commands as CommandsService | undefined;
  if (!commands) {
    throw new Error('the commands service is unavailable (the "commands" plugin is disabled)');
  }
  return { commands, agents: ctx.agents as AgentsService };
}

/** Every command registered for this session's agent, name-sorted
 *  upstream already. */
export function listHostCommands(ctx: DshCtx, sessionId: string): HostCommandDescriptor[] {
  const { commands, agents } = services(ctx);
  return commands.list(agents.get(sessionId)).map((c) => ({
    name: c.name,
    description: c.description ?? "",
  }));
}

export interface HostCommandOutcome {
  ok: boolean;
  text: string;
}

/** Execute one slash line ("/compact") against the session's agent.
 *  Unknown names and invalid syntax settle as `undefined` upstream —
 *  surfaced here as a plain failure instead of an exception. */
export async function runHostCommand(
  ctx: DshCtx,
  sessionId: string,
  line: string,
  signal?: AbortSignal,
): Promise<HostCommandOutcome> {
  const { commands, agents } = services(ctx);
  const execution = await commands.execute(agents.get(sessionId), line, signal);
  if (!execution) {
    return { ok: false, text: `Unknown command: ${line}` };
  }
  const result = execution.result;
  return { ok: result.kind === "success", text: result.text ?? "" };
}
