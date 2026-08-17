import React, { useEffect } from "react";
import { useChatStore } from "../state/store";
import { send } from "../messages/client";

function formatTime(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** This workspace's persisted conversations, newest first. Clicking a
 *  row asks the host to resume the session and send its transcript.
 *  The list refetches every time the panel opens — sessions created
 *  since the last fetch (e.g. the conversation just started) would
 *  otherwise stay invisible until a window reload. */
export const SessionList: React.FC = () => {
  const history = useChatStore((s) => s.history);
  const sessionId = useChatStore((s) => s.sessionId);

  useEffect(() => {
    send({ v: 1, type: "session.list" });
  }, []);

  return (
    <div className="dsh-sessions">
      {history.length === 0 ? (
        <div className="dsh-sessions-empty">No past conversations in this workspace.</div>
      ) : (
        history.map((h) => (
          <button
            key={h.id}
            className={`dsh-session-row${h.id === sessionId ? " dsh-session-active" : ""}`}
            onClick={() => send({ v: 1, type: "session.open", sessionId: h.id })}
            title={h.id}
          >
            <span className="dsh-session-title">{h.title}</span>
            <span className="dsh-session-time">{formatTime(h.createdAt)}</span>
          </button>
        ))
      )}
    </div>
  );
};
