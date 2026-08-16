import React from "react";
import { useChatStore } from "../state/store";
import { send } from "../messages/client";

export const ChatInput: React.FC = () => {
  const input = useChatStore((s) => s.input);
  const setInput = useChatStore((s) => s.setInput);
  const sessionId = useChatStore((s) => s.sessionId);
  const busy = useChatStore((s) => s.busy);
  const setBusy = useChatStore((s) => s.setBusy);
  const addUserMessage = useChatStore((s) => s.addUserMessage);

  const onSend = () => {
    const text = input.trim();
    if (!text || busy) return;
    addUserMessage(text);
    setBusy(true);
    send({ v: 1, type: "chat.send", sessionId, text });
    setInput("");
  };

  const onCancel = () => {
    send({ v: 1, type: "chat.cancel", sessionId });
  };

  return (
    <div className="dsh-input">
      <div className="dsh-input-box">
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
          rows={2}
          aria-label="Message"
        />
        {busy ? (
          <button className="dsh-stop" onClick={onCancel} title="Stop" aria-label="Stop">
            ■
          </button>
        ) : (
          <button onClick={onSend} disabled={!input.trim()} title="Send" aria-label="Send">
            ↑
          </button>
        )}
      </div>
    </div>
  );
};
