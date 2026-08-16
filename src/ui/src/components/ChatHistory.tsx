import React, { useEffect, useRef } from "react";
import { useChatStore } from "../state/store";
import { Message } from "./Message";

export const ChatHistory: React.FC = () => {
  const messages = useChatStore((s) => s.messages);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="dsh-history">
        <div className="dsh-empty">
          <div className="dsh-empty-title">DeepSeek Harness</div>
          <div className="dsh-empty-hint">
            Ask a question to start. Tool calls, thinking and token usage show up inline.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dsh-history" ref={ref}>
      {messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}
    </div>
  );
};
