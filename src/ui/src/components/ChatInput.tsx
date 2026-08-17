import React from "react";
import { useChatStore } from "../state/store";
import { send } from "../messages/client";

/**
 * Claude-style composer: attachment chips on top, the textarea, then a
 * toolbar row — `+` attaches text files (host-side native picker),
 * typing `/` opens the command menu, the mode chip switches the
 * permission preset, and the send/stop button sits on the right.
 */

interface SlashCommand {
  name: string;
  description: string;
  run: () => void;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "new",
    description: "Start a new conversation",
    run: () => {
      useChatStore.getState().newSession();
      send({ v: 1, type: "session.new" });
    },
  },
  {
    name: "history",
    description: "Toggle the conversation history panel",
    run: () => useChatStore.getState().toggleHistory(),
  },
  {
    name: "plugins",
    description: "Toggle the plugin panel",
    run: () => useChatStore.getState().togglePlugins(),
  },
  {
    name: "key",
    description: "Set or replace the provider API key",
    run: () => send({ v: 1, type: "credential.set" }),
  },
];

export const ChatInput: React.FC = () => {
  const input = useChatStore((s) => s.input);
  const setInput = useChatStore((s) => s.setInput);
  const sessionId = useChatStore((s) => s.sessionId);
  const busy = useChatStore((s) => s.busy);
  const setBusy = useChatStore((s) => s.setBusy);
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const attachments = useChatStore((s) => s.attachments);
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const preset = useChatStore((s) => s.preset);

  // The command menu opens while the input is a slash prefix.
  const slashQuery = input.startsWith("/") ? input.slice(1) : null;
  const matches =
    slashQuery !== null
      ? SLASH_COMMANDS.filter(
          (c) => slashQuery === "" || c.name.startsWith(slashQuery.toLowerCase()),
        )
      : [];

  const runCommand = (cmd: SlashCommand) => {
    setInput("");
    cmd.run();
  };

  const onSend = () => {
    const text = input.trim();
    if (!text || busy) return;
    // A lone slash command on Enter runs the first match instead of
    // being sent to the model.
    if (slashQuery !== null && matches.length > 0) {
      runCommand(matches[0]);
      return;
    }
    addUserMessage(text);
    setBusy(true);
    send({
      v: 1,
      type: "chat.send",
      sessionId,
      text,
      ...(attachments.length
        ? { attachments: attachments.map((a) => ({ name: a.name, content: a.content })) }
        : null),
    });
    setInput("");
    useChatStore.getState().clearAttachments();
  };

  const onCancel = () => {
    send({ v: 1, type: "chat.cancel", sessionId });
  };

  return (
    <div className="dsh-input">
      <div className="dsh-input-box">
        {slashQuery !== null && matches.length > 0 ? (
          <div className="dsh-command-menu" role="listbox" aria-label="Commands">
            {matches.map((c) => (
              <button
                key={c.name}
                className="dsh-command-item"
                role="option"
                onClick={() => runCommand(c)}
              >
                <span className="dsh-command-name">/{c.name}</span>
                <span className="dsh-command-desc">{c.description}</span>
              </button>
            ))}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="dsh-attachment-chips">
            {attachments.map((a) => (
              <span key={a.name} className="dsh-chip" title={a.name}>
                {a.name}
                <button
                  className="dsh-chip-remove"
                  onClick={() => removeAttachment(a.name)}
                  aria-label={`Remove ${a.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && slashQuery !== null) {
              e.preventDefault();
              setInput("");
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask DeepSeek Harness anything…  (/ for commands)"
          rows={2}
          aria-label="Message"
        />
        <div className="dsh-input-toolbar">
          <button
            className="dsh-icon-button"
            onClick={() => send({ v: 1, type: "file.pick" })}
            title="Attach files"
            aria-label="Attach files"
          >
            ＋
          </button>
          <span className="dsh-input-toolbar-spacer" />
          {preset !== null ? (
            <select
              className="dsh-mode-select"
              value={preset}
              onChange={(e) => send({ v: 1, type: "permission.set", preset: e.target.value })}
              title="Permission mode — what mutating tools (write_file, run_command) may do"
              aria-label="Permission mode"
            >
              <option value="read-only">Read Only</option>
              <option value="workspace-write">Workspace Write</option>
              <option value="full-access">Full Access</option>
            </select>
          ) : null}
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
    </div>
  );
};
