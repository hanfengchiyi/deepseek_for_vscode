import React, { useEffect } from "react";
import { useChatStore } from "../state/store";
import { send } from "../messages/client";

/**
 * Claude-style composer: attachment chips on top, the textarea, then a
 * toolbar row — `+` attaches text files (host-side native picker),
 * typing `/` opens the command menu, the mode chip switches the
 * permission preset, and the send/stop button sits on the right.
 *
 * The command menu merges local UI commands (SLASH_COMMANDS) with
 * host-plane commands (`ctx.commands` upstream, e.g. /compact),
 * fetched via `command.list` whenever the menu opens.
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
  {
    name: "export",
    description: "Export this session's event log to a file",
    run: () => {
      const { sessionId } = useChatStore.getState();
      send({ v: 1, type: "session.export", sessionId });
    },
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
  const hostCommands = useChatStore((s) => s.hostCommands);

  // The command menu opens while the input is a slash prefix.
  const slashQuery = input.startsWith("/") ? input.slice(1) : null;
  const menuOpen = slashQuery !== null;

  // Refresh the host command list each time the menu opens.
  useEffect(() => {
    if (menuOpen) send({ v: 1, type: "command.list", sessionId });
  }, [menuOpen, sessionId]);

  const localMatches = menuOpen
    ? SLASH_COMMANDS.filter(
        (c) => slashQuery === "" || c.name.startsWith(slashQuery!.toLowerCase()),
      )
    : [];
  const remoteMatches = menuOpen
    ? hostCommands.filter(
        (c) =>
          (slashQuery === "" || c.name.startsWith(slashQuery!.toLowerCase())) &&
          !localMatches.some((l) => l.name === c.name),
      )
    : [];
  const hasMatches = localMatches.length + remoteMatches.length > 0;

  const runLocal = (cmd: SlashCommand) => {
    setInput("");
    cmd.run();
  };

  const runRemote = (name: string) => {
    setInput("");
    send({ v: 1, type: "command.run", sessionId, line: `/${name}` });
  };

  const onSend = () => {
    const text = input.trim();
    if (!text || busy) return;
    // A lone slash command on Enter runs the first match instead of
    // being sent to the model.
    if (menuOpen && hasMatches) {
      if (localMatches.length > 0) runLocal(localMatches[0]);
      else runRemote(remoteMatches[0].name);
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
        {menuOpen && hasMatches ? (
          <div className="dsh-command-menu" role="listbox" aria-label="Commands">
            {localMatches.map((c) => (
              <button
                key={c.name}
                className="dsh-command-item"
                role="option"
                onClick={() => runLocal(c)}
              >
                <span className="dsh-command-name">/{c.name}</span>
                <span className="dsh-command-desc">{c.description}</span>
              </button>
            ))}
            {remoteMatches.map((c) => (
              <button
                key={c.name}
                className="dsh-command-item"
                role="option"
                onClick={() => runRemote(c.name)}
              >
                <span className="dsh-command-name">/{c.name}</span>
                <span className="dsh-command-desc">{c.description}</span>
                <span className="dsh-command-badge">host</span>
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
