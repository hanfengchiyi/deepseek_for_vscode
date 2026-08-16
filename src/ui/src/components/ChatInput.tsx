import React from "react";
import { useChatStore } from "../state/store";
import { send } from "../messages/client";

export const ChatInput: React.FC = () => {
  const input = useChatStore((s) => s.input);
  const setInput = useChatStore((s) => s.setInput);
  const sessionId = useChatStore((s) => s.sessionId);
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const addAssistantPlaceholder = useChatStore((s) => s.addAssistantPlaceholder);

  const onSend = () => {
    const text = input.trim();
    if (!text) return;
    addUserMessage(text);
    addAssistantPlaceholder();
    send({ v: 1, type: "chat.send", sessionId, text });
    setInput("");
  };

  return (
    <div className="dsh-input">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder="Ask DeepSeek Harness anything…"
        rows={3}
      />
      <button onClick={onSend} disabled={!input.trim()}>
        Send
      </button>
    </div>
  );
};
