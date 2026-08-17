import React from "react";
import { useChatStore } from "../state/store";
import { send } from "../messages/client";

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Model / reasoning-effort picker plus a live context-capacity meter.
 *  Rendered between the header and the chat history. Hidden entirely
 *  until the first `model.catalog` arrives. */
export const ModelBar: React.FC = () => {
  const catalog = useChatStore((s) => s.catalog);
  const selection = useChatStore((s) => s.selection);
  const contextWindow = useChatStore((s) => s.contextWindow);
  const efforts = useChatStore((s) => s.efforts);
  const lastUsage = useChatStore((s) => s.lastUsage);
  const hasCredential = useChatStore((s) => s.hasCredential);
  const sessionId = useChatStore((s) => s.sessionId);
  const preset = useChatStore((s) => s.preset);

  if (!selection) return null;

  const onModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const [provider, model] = e.target.value.split("/");
    send({ v: 1, type: "model.select", sessionId, provider, model });
  };

  const onEffortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    send({
      v: 1,
      type: "model.select",
      sessionId,
      provider: selection.provider,
      model: selection.model,
      reasoningEffort: e.target.value || undefined,
    });
  };

  const cacheHit =
    lastUsage?.cacheReadTokens && lastUsage.inputTokens
      ? Math.round((lastUsage.cacheReadTokens / lastUsage.inputTokens) * 100)
      : null;

  return (
    <div className="dsh-modelbar">
      <select
        className="dsh-model-select"
        value={`${selection.provider}/${selection.model}`}
        onChange={onModelChange}
        title="Model"
      >
        {(catalog ?? []).map((p) => (
          <optgroup key={p.id} label={p.name}>
            {p.models.map((m) => (
              <option key={m.id} value={`${p.id}/${m.id}`}>
                {m.name}
              </option>
            ))}
          </optgroup>
        ))}
        {/* Fallback when the catalog could not be fetched: show the
            current selection so the select stays controlled. */}
        {!(catalog ?? []).some((p) =>
          p.models.some((m) => p.id === selection.provider && m.id === selection.model),
        ) ? (
          <option value={`${selection.provider}/${selection.model}`}>{selection.model}</option>
        ) : null}
      </select>

      {efforts && efforts.length > 0 ? (
        <select
          className="dsh-effort-select"
          value={selection.reasoningEffort ?? ""}
          onChange={onEffortChange}
          title="Reasoning effort"
        >
          <option value="">Default effort</option>
          {efforts.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      ) : null}

      {preset !== null ? (
        <select
          className="dsh-preset-select"
          value={preset}
          onChange={(e) => send({ v: 1, type: "permission.set", preset: e.target.value })}
          title="Permission preset — what mutating tools (write_file, run_command) may do"
        >
          <option value="read-only">Read Only</option>
          <option value="workspace-write">Workspace Write</option>
          <option value="full-access">Full Access</option>
        </select>
      ) : null}

      {lastUsage && contextWindow ? (
        <span className="dsh-context-meter" title="Context usage of the last request">
          {formatTokens(lastUsage.inputTokens)} / {formatTokens(contextWindow)}
          {cacheHit !== null ? ` · cache ${cacheHit}%` : ""}
        </span>
      ) : null}

      {hasCredential !== null ? (
        <button
          className={`dsh-key-button${hasCredential ? " dsh-key-set" : ""}`}
          onClick={() => send({ v: 1, type: "credential.set" })}
          title={hasCredential ? "API key configured — click to replace" : "Set the DeepSeek API key"}
        >
          {hasCredential ? "Key ✓" : "Set API key"}
        </button>
      ) : null}
    </div>
  );
};
