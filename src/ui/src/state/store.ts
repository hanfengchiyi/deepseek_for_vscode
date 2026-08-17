import { create } from "zustand";

export interface ToolCallItem {
  callId: string;
  name: string;
  arguments: string;
  result?: string;
  ok?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ProviderEntry {
  id: string;
  name: string;
  models: Array<{ id: string; name: string }>;
}

export interface Selection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: ToolCallItem[];
  usage?: Usage;
  streaming?: boolean;
}

export interface HistoryEntry {
  id: string;
  title: string;
  createdAt: number;
}

/** A live `ask_user` question waiting for the user's answer. */
export interface PendingQuestion {
  questionId: string;
  question: string;
  options?: string[];
}

/** One user plugin's boot-time load outcome (host `plugin.catalog`). */
export interface PluginEntry {
  id: string;
  path: string;
  status: "loaded" | "error";
  error?: string;
}

/** A live approval request for a mutating tool call. */
export interface PendingApproval {
  approvalId: string;
  toolName: string;
  reason?: string;
}

/** A text file attached to the next outgoing message. */
export interface Attachment {
  name: string;
  content: string;
}

/** Fresh session id for a new conversation. The agent is created lazily
 *  host-side on the first `chat.send`, so minting an id here is all a
 *  "new chat" needs. */
function mintSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ChatState {
  sessionId: string;
  messages: ChatMessage[];
  input: string;
  /** True between `chat.send` and the matching `turn.end` / `error`. */
  busy: boolean;
  /** Last host-reported error; shown as a dismissible banner. */
  error: string | null;
  /** Model catalog from the host; null until the first `model.catalog`. */
  catalog: ProviderEntry[] | null;
  selection: Selection | null;
  contextWindow: number | null;
  efforts: Array<{ id: string; name: string }> | null;
  /** Whether the provider API key is configured; null until known. */
  hasCredential: boolean | null;
  /** Usage of the most recent assistant step; drives the context meter. */
  lastUsage: Usage | null;
  /** This workspace's persisted sessions, newest first. */
  history: HistoryEntry[];
  /** Whether the history panel is visible. */
  historyOpen: boolean;
  /** User plugins loaded at boot; null until the first plugin.catalog. */
  plugins: PluginEntry[] | null;
  /** Whether the plugin panel is visible. */
  pluginsOpen: boolean;
  /** Live `ask_user` question awaiting an answer; null when none. */
  question: PendingQuestion | null;
  /** Current permission preset; null until the first permission.state. */
  preset: string | null;
  /** Live approval request awaiting a decision; null when none. */
  approval: PendingApproval | null;
  /** Files attached to the next outgoing message. */
  attachments: Attachment[];
  setInput: (s: string) => void;
  setError: (message: string | null) => void;
  setBusy: (busy: boolean) => void;
  setCatalog: (catalog: {
    providers: ProviderEntry[];
    current: Selection;
    contextWindow?: number;
    efforts?: Array<{ id: string; name: string }>;
    hasCredential: boolean;
  }) => void;
  setHistory: (history: HistoryEntry[]) => void;
  toggleHistory: () => void;
  setPlugins: (plugins: PluginEntry[]) => void;
  togglePlugins: () => void;
  /** Show or clear the `ask_user` question card. */
  setQuestion: (question: PendingQuestion | null) => void;
  setPresetState: (preset: string) => void;
  /** Show or clear the tool-approval card. */
  setApproval: (approval: PendingApproval | null) => void;
  /** Merge picked files into the attachment list (deduped by name). */
  addAttachments: (files: Attachment[]) => void;
  removeAttachment: (name: string) => void;
  clearAttachments: () => void;
  /** Replace the view with a (resumed) session's transcript. */
  loadTranscript: (sessionId: string, messages: ChatMessage[]) => void;
  /** Reset to a fresh conversation. */
  newSession: () => void;
  appendDelta: (messageId: string, delta: string) => void;
  appendThinking: (messageId: string, delta: string) => void;
  endStream: (messageId: string) => void;
  upsertToolCall: (messageId: string, call: ToolCallItem) => void;
  setToolResult: (messageId: string, callId: string, ok: boolean, content: string) => void;
  setUsage: (messageId: string, usage: Usage) => void;
  addUserMessage: (text: string) => string;
}

/** Host events key on a synthetic per-step id (`step-{turn}-{step}`)
 *  that the webview cannot predict, so assistant bubbles are created
 *  on demand when the first event of a step arrives. */
function ensureMessage(messages: ChatMessage[], messageId: string): ChatMessage[] {
  if (messages.some((m) => m.id === messageId)) return messages;
  return [
    ...messages,
    { id: messageId, role: "assistant", content: "", streaming: true },
  ];
}

function patchMessage(
  messages: ChatMessage[],
  messageId: string,
  patch: (m: ChatMessage) => ChatMessage,
): ChatMessage[] {
  return ensureMessage(messages, messageId).map((m) => (m.id === messageId ? patch(m) : m));
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: mintSessionId(),
  messages: [],
  input: "",
  busy: false,
  error: null,
  catalog: null,
  selection: null,
  contextWindow: null,
  efforts: null,
  hasCredential: null,
  lastUsage: null,
  history: [],
  historyOpen: false,
  plugins: null,
  pluginsOpen: false,
  question: null,
  preset: null,
  approval: null,
  attachments: [],
  setInput: (input) => set({ input }),
  setError: (error) => set({ error, ...(error ? { busy: false } : null) }),
  setBusy: (busy) => set({ busy }),
  setHistory: (history) => set({ history }),
  // The history and plugin panels share the same area; opening one
  // closes the other.
  toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen, pluginsOpen: false })),
  setPlugins: (plugins) => set({ plugins }),
  togglePlugins: () => set((s) => ({ pluginsOpen: !s.pluginsOpen, historyOpen: false })),
  setQuestion: (question) => set({ question }),
  setPresetState: (preset) => set({ preset }),
  setApproval: (approval) => set({ approval }),
  addAttachments: (files) =>
    set((s) => ({
      attachments: [
        ...s.attachments,
        ...files.filter((f) => !s.attachments.some((a) => a.name === f.name)),
      ],
    })),
  removeAttachment: (name) =>
    set((s) => ({ attachments: s.attachments.filter((a) => a.name !== name) })),
  clearAttachments: () => set({ attachments: [] }),
  loadTranscript: (sessionId, messages) =>
    set({
      sessionId,
      messages,
      busy: false,
      error: null,
      lastUsage: null,
      historyOpen: false,
      question: null,
    }),
  newSession: () =>
    set({
      sessionId: mintSessionId(),
      messages: [],
      busy: false,
      error: null,
      lastUsage: null,
      historyOpen: false,
      question: null,
    }),
  setCatalog: (catalog) =>
    set({
      catalog: catalog.providers,
      selection: catalog.current,
      contextWindow: catalog.contextWindow ?? null,
      efforts: catalog.efforts ?? null,
      hasCredential: catalog.hasCredential,
    }),
  appendDelta: (messageId, delta) =>
    set((s) => ({
      messages: patchMessage(s.messages, messageId, (m) => ({ ...m, content: m.content + delta })),
    })),
  appendThinking: (messageId, delta) =>
    set((s) => ({
      messages: patchMessage(s.messages, messageId, (m) => ({
        ...m,
        thinking: (m.thinking ?? "") + delta,
      })),
    })),
  endStream: (messageId) =>
    set((s) => ({
      messages: patchMessage(s.messages, messageId, (m) => ({ ...m, streaming: false })),
    })),
  upsertToolCall: (messageId, call) =>
    set((s) => ({
      messages: patchMessage(s.messages, messageId, (m) => {
        const existing = m.toolCalls ?? [];
        if (existing.some((c) => c.callId === call.callId)) return m;
        return { ...m, toolCalls: [...existing, call] };
      }),
    })),
  setToolResult: (messageId, callId, ok, content) =>
    set((s) => ({
      messages: patchMessage(s.messages, messageId, (m) => ({
        ...m,
        toolCalls: (m.toolCalls ?? []).map((c) =>
          c.callId === callId ? { ...c, ok, result: content } : c,
        ),
      })),
    })),
  setUsage: (messageId, usage) =>
    set((s) => ({
      lastUsage: usage,
      messages: patchMessage(s.messages, messageId, (m) => ({ ...m, usage })),
    })),
  addUserMessage: (text) => {
    const id = `u-${Date.now()}`;
    set((s) => ({ messages: [...s.messages, { id, role: "user", content: text }] }));
    return id;
  },
}));
