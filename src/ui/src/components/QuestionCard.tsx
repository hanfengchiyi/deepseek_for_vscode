import React, { useState } from "react";
import { send } from "../messages/client";
import { useChatStore } from "../state/store";

/**
 * Inline card for a live `ask_user` question. Rendered above the input
 * box while a question is pending. Predefined options answer with one
 * click; the text field is always available for a free-form reply.
 * Answering sends `question.answer` and clears the card locally — the
 * host ignores late/duplicate answers for an already-settled id.
 */
export const QuestionCard: React.FC = () => {
  const question = useChatStore((s) => s.question);
  const [text, setText] = useState("");
  if (!question) return null;

  const answer = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    send({ v: 1, type: "question.answer", questionId: question.questionId, answer: trimmed });
    useChatStore.getState().setQuestion(null);
    setText("");
  };

  return (
    <div className="dsh-question" role="dialog" aria-label="Question from the assistant">
      <div className="dsh-question-text">{question.question}</div>
      {question.options?.length ? (
        <div className="dsh-question-options">
          {question.options.map((opt) => (
            <button key={opt} className="dsh-question-option" onClick={() => answer(opt)}>
              {opt}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="dsh-question-freeform"
        onSubmit={(e) => {
          e.preventDefault();
          answer(text);
        }}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type your answer…"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the card appears on demand; focus follows it
          autoFocus
        />
        <button type="submit" disabled={!text.trim()} aria-label="Send answer">
          ↑
        </button>
      </form>
    </div>
  );
};
