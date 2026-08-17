import React, { useEffect } from "react";
import { ApprovalCard } from "./components/ApprovalCard";
import { ChatHistory } from "./components/ChatHistory";
import { ChatInput } from "./components/ChatInput";
import { ModelBar } from "./components/ModelBar";
import { PluginPanel } from "./components/PluginPanel";
import { QuestionCard } from "./components/QuestionCard";
import { SessionList } from "./components/SessionList";
import { onMessage, send } from "./messages/client";
import { useChatStore } from "./state/store";

export const App: React.FC = () => {
  const error = useChatStore((s) => s.error);
  const historyOpen = useChatStore((s) => s.historyOpen);
  const pluginsOpen = useChatStore((s) => s.pluginsOpen);

  useEffect(() => {
    const unsubscribe = onMessage((ev) => {
      const store = useChatStore.getState();
      switch (ev.type) {
        case "stream.chunk":
          if (typeof ev.thinking === "string" && ev.thinking.length > 0) {
            store.appendThinking(ev.messageId, ev.thinking);
          }
          if (ev.delta) {
            store.appendDelta(ev.messageId, ev.delta);
          }
          break;
        case "stream.end":
          store.endStream(ev.messageId);
          break;
        case "tool.call":
          store.upsertToolCall(ev.messageId, {
            callId: ev.callId,
            name: ev.name,
            arguments: ev.arguments,
          });
          break;
        case "tool.result":
          store.setToolResult(ev.messageId, ev.callId, ev.ok, ev.content);
          break;
        case "message.usage":
          store.setUsage(ev.messageId, ev.usage);
          break;
        case "turn.end":
          store.setBusy(false);
          // A turn that ends while a question is parked (cancel, error)
          // will never answer it; drop the card.
          store.setQuestion(null);
          store.setApproval(null);
          if (ev.error) {
            store.setError(ev.error);
          }
          break;
        case "question.request":
          store.setQuestion({
            questionId: ev.questionId,
            question: ev.question,
            options: ev.options,
          });
          break;
        case "approval.request":
          store.setApproval({
            approvalId: ev.approvalId,
            toolName: ev.toolName,
            reason: ev.reason,
          });
          break;
        case "permission.state":
          store.setPresetState(ev.preset);
          break;
        case "file.picked":
          store.addAttachments(ev.files);
          if (ev.skipped && ev.skipped.length > 0) {
            store.setError(`Skipped non-text or oversize files: ${ev.skipped.join(", ")}`);
          }
          break;
        case "plugin.catalog":
          store.setPlugins(ev.plugins);
          break;
        case "model.catalog":
          store.setCatalog(ev);
          break;
        case "session.history":
          store.setHistory(ev.sessions);
          break;
        case "session.transcript":
          store.loadTranscript(ev.sessionId, ev.messages);
          break;
        case "error":
          store.setError(ev.message);
          break;
        default:
          break;
      }
    });
    send({ v: 1, type: "ready" });
    return unsubscribe;
  }, []);

  return (
    <div className="dsh-app">
      <header className="dsh-header">
        <span>DeepSeek Harness</span>
        <span className="dsh-header-actions">
          <button
            className="dsh-header-button"
            onClick={() => useChatStore.getState().togglePlugins()}
            title="Plugins"
            aria-label="Plugins"
          >
            🧩
          </button>
          <button
            className="dsh-header-button"
            onClick={() => useChatStore.getState().toggleHistory()}
            title="Conversation history"
            aria-label="Conversation history"
          >
            ☰
          </button>
          <button
            className="dsh-header-button"
            onClick={() => {
              useChatStore.getState().newSession();
              send({ v: 1, type: "session.new" });
            }}
            title="New conversation"
            aria-label="New conversation"
          >
            ＋
          </button>
        </span>
      </header>
      <ModelBar />
      {error ? (
        <div className="dsh-error" role="alert">
          <span className="dsh-error-text">{error}</span>
          <button
            className="dsh-error-dismiss"
            onClick={() => useChatStore.getState().setError(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
      {historyOpen ? <SessionList /> : pluginsOpen ? <PluginPanel /> : <ChatHistory />}
      <QuestionCard />
      <ApprovalCard />
      <ChatInput />
    </div>
  );
};
