import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
}

interface ChatState {
  sessionId: string;
  messages: ChatMessage[];
  input: string;
  setInput: (s: string) => void;
  appendDelta: (messageId: string, delta: string) => void;
  endStream: (messageId: string) => void;
  addUserMessage: (text: string) => string;
  addAssistantPlaceholder: () => string;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: "sess-1",
  messages: [],
  input: "",
  setInput: (input) => set({ input }),
  appendDelta: (messageId, delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + delta } : m,
      ),
    })),
  endStream: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, streaming: false } : m,
      ),
    })),
  addUserMessage: (text) => {
    const id = `u-${Date.now()}`;
    set((s) => ({ messages: [...s.messages, { id, role: "user", content: text }] }));
    return id;
  },
  addAssistantPlaceholder: () => {
    const id = `a-${Date.now()}`;
    set((s) => ({
      messages: [...s.messages, { id, role: "assistant", content: "", streaming: true }],
    }));
    return id;
  },
}));
