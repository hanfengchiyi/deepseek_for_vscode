import React, { useEffect } from "react";
import { ChatHistory } from "./components/ChatHistory";
import { ChatInput } from "./components/ChatInput";
import { onMessage } from "./messages/client";
import { useChatStore } from "./state/store";

export const App: React.FC = () => {
  useEffect(() => {
    const unsubscribe = onMessage((ev) => {
      if (ev.type === "stream.chunk") {
        useChatStore.getState().appendDelta(ev.messageId, ev.delta);
      } else if (ev.type === "stream.end") {
        useChatStore.getState().endStream(ev.messageId);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <div className="dsh-app">
      <header className="dsh-header">DeepSeek Harness</header>
      <ChatHistory />
      <ChatInput />
    </div>
  );
};
