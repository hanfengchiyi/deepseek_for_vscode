# DeepSeek Harness for VS Code

A VS Code extension that embeds the [DeepSeek Harness (DSH)](https://www.npmjs.com/search?q=%40deepseek-ai) agent runtime in a sidebar chat view — talk to DeepSeek models with full workspace awareness, session history, tool call visualization, and interactive Q&A, without leaving your editor.

## Features

- **Chat with DeepSeek-V4 models** — streaming replies, thinking blocks, and per-message token accounting (input / output / reasoning / cache hit).
- **Model & reasoning-effort picker** — switch between `deepseek-v4-flash` / `deepseek-v4-pro` and reasoning efforts; live context-occupancy meter against the model's context window.
- **Workspace awareness** — the agent knows your open folder and can inspect it with read-only tools (`list_files`, `read_file`, `search_files`).
- **Session history** — every conversation is persisted as an append-only JSONL log under `~/.dsh/sessions/<project>/`; browse and resume past sessions from the ☰ panel, per workspace.
- **Interactive questions (`ask_user`)** — the model can pause mid-turn and ask you a question in an inline card (option buttons + free text); your answer becomes the tool result and the turn continues.
- **Markdown rendering** — assistant messages render GFM: tables, fenced code blocks, lists, headings.
- **Tool call cards** — every tool invocation shows its arguments and result inline (running / done / failed states).
- **User plugins** — drop your own Cordis plugins into `~/.dsh/plugins/`; manage them from the 🧩 panel (see below).
- **Credential management** — set the DeepSeek API key from the UI; stored at `~/.dsh/.credentials.yaml` (file mode 0600), never transits the webview DOM.

## Architecture

```
src/
  extension.ts        # activation, registers the sidebar view
  commands/           # "Open Chat" command
  dsh-bridge/         # host-side bridge over the DSH runtime (Cordis)
    boot.ts           #   mounts DSH core services (llm, agents, sessions,
                      #   tools, persistence, credentials) + ask_user + plugins
    agents.ts         #   inbox push / turn cancel
    events.ts         #   session/event → webview event translation (batched)
    history.ts        #   per-project history list + transcript rebuild
    models.ts         #   model catalog + selection
    credentials.ts    #   API key storage
    workspace.ts      #   workspace prompt section + read-only tools
    ask-user.ts       #   ask_user tool with parked-promise Q&A
    plugins.ts        #   user-plugin directory loader
  webview-host/       # router (webview ⇄ host protocol) + view provider
  shared/protocol.ts  # versioned wire protocol (v1)
  ui/                 # React webview (Vite), zustand store
```

The DSH runtime is a [Cordis](https://github.com/koishijs/cordis) plugin system: every capability (LLM routes, agent loop, tools, persistence) is a plugin mounted on a shared context. This extension composes them in `boot.ts` and drives agents through `ctx.agents`, streaming session events back to the webview.

## User plugins

Any directory entry in `~/.dsh/plugins/` that is a `.js` / `.mjs` / `.cjs` file — or a folder with a `package.json` — is imported at boot and mounted as a Cordis plugin. Plugins load **after** all core services, so they can inject `llm`, `agents`, `sessions`, `tools`, `systemPrompt`, `credentials`, etc.

Example `~/.dsh/plugins/hello.js`:

```js
// Cordis plugin: a function receiving the root context.
module.exports = function helloPlugin(ctx) {
  // e.g. log every tool call
  ctx.on("session/event", (session, event) => {
    if (event.type === "tool/call") console.log("tool call:", event.data.name);
  });
};
```

A plugin that fails to import or mount is isolated: it shows up as `error` in the 🧩 panel and never breaks the rest of the boot. Changes take effect after **Developer: Reload Window**.

## Development

```bash
pnpm install
pnpm build            # host bundle (esbuild) + webview bundle (vite)
pnpm watch:host       # incremental host builds
pnpm watch:webview    # vite dev for the webview

pnpm test:unit        # unit tests (node)
pnpm test:webview     # whole-app jsdom smoke tests
pnpm test:integration # vscode-test integration tests
pnpm lint
```

Press `F5` in VS Code to launch an Extension Development Host.

## Notes

- Session logs, credentials, and plugins all live under `$DSH_HOME` (default `~/.dsh`).
- The wire protocol between webview and host is versioned (`v: 1`); see `src/shared/protocol.ts`.
