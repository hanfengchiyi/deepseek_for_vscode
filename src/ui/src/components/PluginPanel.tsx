import React from "react";
import { send } from "../messages/client";
import { useChatStore, type PluginEntry } from "../state/store";

/**
 * Plugin panel, official-style: a Runtime section listing every plugin
 * the extension boots (toggleable unless required) and a User section
 * for loose Cordis plugins in `$DSH_HOME/plugins`. Toggles persist
 * host-side and take effect on the next window reload — the banner
 * offers the reload.
 */
export const PluginPanel: React.FC = () => {
  const plugins = useChatStore((s) => s.plugins);
  const pluginDirty = useChatStore((s) => s.pluginDirty);

  const runtime = (plugins ?? []).filter(
    (p): p is Extract<PluginEntry, { scope: "runtime" }> => p.scope === "runtime",
  );
  const user = (plugins ?? []).filter(
    (p): p is Extract<PluginEntry, { scope: "user" }> => p.scope === "user",
  );

  const toggle = (id: string, enabled: boolean) => {
    send({ v: 1, type: "plugin.setEnabled", id, enabled });
    useChatStore.getState().setPluginDirty();
  };

  return (
    <div className="dsh-sessions">
      {pluginDirty ? (
        <div className="dsh-plugin-reload" role="status">
          <span>Plugin changes apply after a window reload.</span>
          <button onClick={() => send({ v: 1, type: "host.reload" })}>Reload</button>
        </div>
      ) : null}

      <div className="dsh-plugin-section">Runtime plugins</div>
      {plugins === null ? (
        <div className="dsh-sessions-empty">Loading plugins…</div>
      ) : (
        runtime.map((p) => (
          <div key={p.id} className="dsh-plugin-row" title={p.error ?? p.description}>
            <span
              className={`dsh-plugin-status dsh-plugin-${
                p.status === "mounted" ? "loaded" : p.status === "error" ? "error" : "disabled"
              }`}
            />
            <span className="dsh-plugin-name">
              {p.name}
              <span className="dsh-plugin-desc">{p.description}</span>
            </span>
            {p.required ? (
              <span className="dsh-plugin-state">required</span>
            ) : (
              <button
                className={`dsh-plugin-toggle${p.enabled ? " dsh-plugin-toggle-on" : ""}`}
                role="switch"
                aria-checked={p.enabled}
                aria-label={`Toggle ${p.name}`}
                onClick={() => toggle(p.id, !p.enabled)}
              >
                {p.enabled ? "Enabled" : "Disabled"}
              </button>
            )}
          </div>
        ))
      )}

      <div className="dsh-plugin-section">User plugins</div>
      {plugins !== null && user.length === 0 ? (
        <div className="dsh-sessions-empty">
          No user plugins. Drop a Cordis plugin (a .js/.mjs file or a folder with package.json
          default-exporting the plugin) into the plugins folder, then reload the window.
        </div>
      ) : (
        user.map((p) => (
          <div key={p.id} className="dsh-plugin-row" title={p.error ?? p.path}>
            <span className={`dsh-plugin-status dsh-plugin-${p.status}`} />
            <span className="dsh-plugin-name">{p.id}</span>
            <span className="dsh-plugin-state">{p.status === "loaded" ? "loaded" : "error"}</span>
          </div>
        ))
      )}
      <button
        className="dsh-plugin-open"
        onClick={() => send({ v: 1, type: "plugin.openDir" })}
      >
        Open plugins folder
      </button>
    </div>
  );
};
