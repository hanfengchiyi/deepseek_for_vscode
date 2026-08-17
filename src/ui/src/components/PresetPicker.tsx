import React from "react";
import { AGENT_PRESETS, agentPresetLabel } from "@shared/protocol";
import { useChatStore } from "../state/store";

/** Agent preset picker. The preset is stamped into the session at
 *  creation (first `chat.send`), so it is editable only while the
 *  conversation is empty; afterwards it renders as a read-only label.
 *  The last choice persists as the default for the next conversation. */
export const PresetPicker: React.FC = () => {
  const agentPreset = useChatStore((s) => s.agentPreset);
  const setAgentPreset = useChatStore((s) => s.setAgentPreset);
  const hasMessages = useChatStore((s) => s.messages.length > 0);

  const current = AGENT_PRESETS.find((p) => p.id === agentPreset);

  if (hasMessages) {
    return (
      <span
        className="dsh-preset-readonly"
        title={current?.description ?? agentPreset}
      >
        模式：{agentPresetLabel(agentPreset)}
      </span>
    );
  }

  return (
    <select
      className="dsh-preset-select"
      value={agentPreset}
      onChange={(e) => setAgentPreset(e.target.value)}
      title={current?.description ?? "Agent 模式 — 仅新会话可选取，创建后不可更改"}
      aria-label="Agent mode"
    >
      {AGENT_PRESETS.map((p) => (
        <option key={p.id} value={p.id} title={p.description}>
          {p.label}
        </option>
      ))}
    </select>
  );
};
