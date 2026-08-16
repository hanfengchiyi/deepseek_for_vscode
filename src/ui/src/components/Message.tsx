import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ToolCallItem } from "../state/store";

const ToolCallCard: React.FC<{ call: ToolCallItem }> = ({ call }) => {
  const state = call.result === undefined ? "running" : call.ok ? "ok" : "error";
  return (
    <details className={`dsh-tool dsh-tool-${state}`}>
      <summary>
        <span className="dsh-tool-name">{call.name}</span>
        <span className="dsh-tool-state">
          {state === "running" ? "running" : state === "ok" ? "done" : "failed"}
        </span>
      </summary>
      {call.arguments ? <pre className="dsh-tool-block">{call.arguments}</pre> : null}
      {call.result !== undefined ? (
        <pre className="dsh-tool-block dsh-tool-result">{call.result || "(empty result)"}</pre>
      ) : null}
    </details>
  );
};

export const Message: React.FC<{ message: ChatMessage }> = ({ message }) => {
  return (
    <div className={`dsh-message dsh-message-${message.role}`} aria-label={message.role}>
      {message.thinking ? (
        <details className="dsh-thinking">
          <summary>Thinking</summary>
          <div className="dsh-thinking-content">{message.thinking}</div>
        </details>
      ) : null}
      <div className="dsh-message-content">
        {message.role === "assistant" ? (
          <div className="dsh-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        ) : (
          message.content
        )}
        {message.streaming ? <span className="dsh-cursor" /> : null}
      </div>
      {message.toolCalls?.map((call) => <ToolCallCard key={call.callId} call={call} />)}
      {message.usage ? (
        <div className="dsh-usage">
          {message.usage.inputTokens} in · {message.usage.outputTokens} out
          {message.usage.reasoningTokens ? ` · ${message.usage.reasoningTokens} reasoning` : ""}
          {message.usage.cacheReadTokens
            ? ` · cache ${Math.round((message.usage.cacheReadTokens / message.usage.inputTokens) * 100)}%`
            : ""}
        </div>
      ) : null}
    </div>
  );
};
