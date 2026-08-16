import React from "react";
import type { ChatMessage } from "../state/store";

export const Message: React.FC<{ message: ChatMessage }> = ({ message }) => {
  return (
    <div className={`dsh-message dsh-message-${message.role}`}>
      <div className="dsh-message-role">{message.role}</div>
      <div className="dsh-message-content">
        {message.content}
        {message.streaming ? <span className="dsh-cursor">▌</span> : null}
      </div>
    </div>
  );
};
