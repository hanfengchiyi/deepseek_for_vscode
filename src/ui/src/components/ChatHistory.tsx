import React, { useEffect, useRef } from "react";
import { useChatStore } from "../state/store";
import { Message } from "./Message";

export const ChatHistory: React.FC = () => {
  const messages = useChatStore((s) => s.messages);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages]);
  return (
    <div className="dsh-history" ref={ref}>
      {messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}
    </div>
  );
};
