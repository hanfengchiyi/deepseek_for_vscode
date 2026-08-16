import React from "react";
import { send } from "../messages/client";
import { useChatStore } from "../state/store";

/**
 * User-plugin panel: shows every module found in `$DSH_HOME/plugins`
 * at boot and whether it mounted. Plugins are Cordis plugins (default
 * export of a `.js`/`.mjs`/`.cjs` file or a folder with package.json);
 * adding or changing them takes effect on the next window reload.
 */
export const PluginPanel: React.FC = () => {
  const plugins = useChatStore((s) => s.plugins);

  return (
    <div className="dsh-sessions">
      {plugins === null ? (
        <div className="dsh-sessions-empty">Loading plugins…</div>
      ) : plugins.length === 0 ? (
        <div className="dsh-sessions-empty">
          No user plugins. Drop a Cordis plugin (a .js/.mjs file or a folder with package.json
          default-exporting the plugin) into the plugins folder, then reload the window.
        </div>
      ) : (
        plugins.map((p) => (
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
