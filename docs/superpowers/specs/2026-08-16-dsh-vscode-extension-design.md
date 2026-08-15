# DeepSeek Harness VS Code Extension — Design Spec

**Date:** 2026-08-16
**Status:** Draft — awaiting user review
**Author:** Mavis (brainstorming session with hanfengchiyi)
**Target repo:** `D:\Code\deepseek\vscode-deepseek` (new, not under the upstream fork)
**Upstream:** `hanfengchiyi/deepseek-harness` (the user's fork of `deepseek-ai/deepseek-harness`)

---

## 1. Goal

Turn DeepSeek Harness (DSH) into a native VS Code extension with an experience on par with the official Claude Code and Codex VS Code extensions. The extension embeds the DSH agent runtime in the extension host, renders its chat and tool execution in a WebView, and integrates with VS Code's editor, terminal, and file APIs to give the user a first-class local Agent workspace.

Out of scope for v0.1: sync UI bundles, remote sandbox, cross-device session sync, Marketplace distribution of user-created presets or skills.

## 2. Confirmed decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Integration | **A — Embed** (`import` `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-headless` inside the extension host) | Same Node + TS runtime, tightest UX, follows DSH's "UI is a plugin" philosophy |
| UI shape | **U1 — WebView with self-drawn chat UI** | Matches Claude/Codex plugin feel, can render DSH's full agent loop (sessions / presets / skills) cleanly |
| Scope | **S3 — Feature-complete vs. DSH Web UI** | Multi-session, all four agent presets, inline diff, Skill system, context compression, multi-agent orchestration, web search, interactive PTY, custom presets, session import/export |
| Build | **Approach 1 — Standalone repo, npm install, esbuild for webview** | Keeps fork clean, semantic-versioned dependency on upstream, no monorepo coupling |
| License | MIT (inherited from upstream) | Identical to `deepseek-harness` |
| Target | VS Code ≥ 1.95 | Needed for `vscode.lm.tools` support, modern webview APIs |
| Language | UI English + Chinese (bilingual) | User is Chinese; DSH is bilingual upstream |

## 3. Architecture

Three layers, all running in the same VS Code process tree:

```
┌─────────────────────────────────────────────────────────────┐
│  WebView (React + xterm.js for terminal render)             │
│  - Chat history & streaming render                          │
│  - Tool trace cards, diff cards, preset picker              │
│  - Session list, Skill panel, terminal panel                │
│  (source-code editing stays in VS Code's native editors;    │
│   diffs open in vscode.diff, not inside the webview)        │
└─────────────────────────────────────────────────────────────┘
                  ↑ postMessage  ↓ postMessage
┌─────────────────────────────────────────────────────────────┐
│  Extension host (Node + TypeScript)                         │
│  - Activate, register commands & views                      │
│  - DSH bridge: list agents, drive session, subscribe events │
│  - Tool adapter: DSH tools ↔ VS Code workspace APIs         │
│  - Webview host: lifecycle, message router, state store     │
│  - Storage: SecretStorage, globalStorage sessions log       │
└─────────────────────────────────────────────────────────────┘
                  ↑ Cordis ctx  ↓ ctx.agents / ctx.sessions
┌─────────────────────────────────────────────────────────────┐
│  DSH runtime (npm: @deepseek-ai/dsh-base + dsh-headless)    │
│  - Model adapters (DeepSeek V4-Pro / V4-Flash)              │
│  - Tool registry (read / write / bash / grep / web / skill) │
│  - Session log + agent loop                                 │
│  - Cordis context tree                                      │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Why this layering

- DSH exposes its `ctx.sessions`, `ctx.agents`, `ctx.tools`, `ctx.llm`, and the `session/event` and `agent/*` event streams as a stable surface. The bridge layer is a thin typed adapter that converts those to webview-friendly messages.
- The WebView never touches DSH directly; it talks only to the bridge. This isolates the UI from upstream API churn and lets us swap UI frameworks without touching the agent layer.
- The tool adapter is the security and policy boundary. Any DSH tool that needs filesystem, terminal, or editor access is funnelled through VS Code APIs (e.g. `workspace.applyEdit`, `window.createTerminal`) instead of raw `fs` / `child_process`. This keeps the VS Code workspace trust model intact.

## 4. Components

### 4.1 Extension host (`src/`)

| File | Responsibility |
| --- | --- |
| `extension.ts` | `activate` / `deactivate`, register commands, status bar, tree view |
| `dsh-bridge/boot.ts` | Load `@deepseek-ai/dsh-base` + `dsh-headless`, build the Cordis ctx tree, expose to bridge |
| `dsh-bridge/agents.ts` | Wrap `ctx.agents`: list presets, switch, clone, drive inbox |
| `dsh-bridge/sessions.ts` | Wrap `ctx.sessions`: list, create, switch, fork, derive history |
| `dsh-bridge/events.ts` | Subscribe to `session/event` and `agent/*`, normalize to webview messages, batched (every 16ms) to avoid flooding the webview |
| `dsh-bridge/tools.ts` | List `ctx.tools` schemas for the picker; intercept tool execution to route through VS Code APIs |
| `webview-host/panel.ts` | Create the chat WebView as a bottom Panel; HTML loaded from `dist/webview/` |
| `webview-host/router.ts` | Typed message router: webview → bridge, bridge → webview |
| `webview-host/store.ts` | Mirror of session state on the host side for resilience if webview reloads |
| `tools/fs-adapter.ts` | DSH `read` / `write` / `edit` ↔ `workspace.fs` + `workspace.applyEdit` |
| `tools/bash-adapter.ts` | DSH `bash` / `subprocess` ↔ `window.createTerminal` + ephemeral shells |
| `tools/web-adapter.ts` | DSH `web_search` / `web_fetch` using upstream's default provider (configurable) |
| `commands/` | `dsh.openChat`, `dsh.newSession`, `dsh.applyPatch`, `dsh.rejectPatch`, `dsh.cyclePreset`, `dsh.showDiff`, `dsh.exportSession` |
| `storage/secret.ts` | `SecretStorage` wrapper for the DeepSeek API key |
| `storage/sessions.ts` | Persist `SessionEvent` log to `globalStorage/sessions/{id}.jsonl` |
| `storage/settings.ts` | Read `package.json` contributes.configuration, surface as `ctx.settings` patch |
| `views/sessions-tree.ts` | Activity-bar TreeView with **quick-switch** entry for every open session (icons, status badge). Right-click for new / rename / delete. |
| `views/presets-tree.ts` | Activity-bar TreeView for the agent preset picker, with description & available tool count |

### 4.2 WebView (`src/ui/`)

| File | Responsibility |
| --- | --- |
| `index.html` | Mounts the React root, sets CSP, loads `dist/webview/main.js` |
| `src/main.tsx` | React entry, creates `App` and wires the message client |
| `src/state/store.ts` | Zustand store: sessions, current session, presets, tool traces, settings |
| `src/state/messages.ts` | Typed message client (codegen from `protocol.ts`) |
| `src/components/App.tsx` | Three-pane layout: session tree (left), chat (centre), tool inspector (right) |
| `src/components/Chat/History.tsx` | Renders `assistant/chunk` events as Markdown streaming, with `<think>` reasoning collapsible |
| `src/components/Chat/Input.tsx` | Multi-line composer with `@`-mention for skills, `/` for slash commands, paste-image support |
| `src/components/Chat/Message.tsx` | One message card with role, content, tool trace inline |
| `src/components/SessionList.tsx` | In-webview session manager (rename / delete / search / fork); **distinct from the activity-bar TreeView**, which is just for quick-switch. The webview list is the source of truth. |
| `src/components/PresetPicker.tsx` | Switch between minimal / standard / code / cordis, show description & available tools |
| `src/components/SkillPanel.tsx` | List installed skills, enable / disable, view prompts |
| `src/components/ToolTrace/Card.tsx` | A tool call card: name, args (collapsible), result, status, retry button |
| `src/components/DiffView/Card.tsx` | Inline diff card with Accept / Reject; opens native `vscode.diff` on expand |
| `src/components/Terminal/Panel.tsx` | xterm.js-backed PTY bridge to `window.createTerminal` |
| `src/components/ContextBar.tsx` | Token usage, compression status, "compact now" action |
| `src/components/Settings/Modal.tsx` | API key, model choice (V4-Flash / V4-Pro / custom), endpoint, log level |
| `src/components/Subagent/Indicator.tsx` | Show running child agents with a small badge in the chat header. Click → side drawer that shows the subagent's session log (read-only stream of its `assistant/message` and `tool/*` events) and a "Cancel" button that posts `agent.turn-stopping` for that subagent. |

### 4.3 Protocol

The protocol between webview and extension host is a typed message union in `protocol.ts`, with code-generated client and server stubs (one shared file, two implementations). Messages are JSON-serializable and versioned by a `v` field so we can add fields without breaking older webviews.

```ts
// Inbound (webview → host)
type HostCommand =
  | { v: 1; type: "chat.send"; sessionId: string; text: string; attachments?: Attachment[] }
  | { v: 1; type: "chat.cancel"; sessionId: string }
  | { v: 1; type: "session.create"; presetId: string; cwd?: string }
  | { v: 1; type: "session.switch"; sessionId: string }
  | { v: 1; type: "session.delete"; sessionId: string }
  | { v: 1; type: "session.fork"; sessionId: string; atBoundary?: string }
  | { v: 1; type: "preset.switch"; sessionId: string; presetId: string }
  | { v: 1; type: "skill.toggle"; sessionId: string; skillId: string; enabled: boolean }
  | { v: 1; type: "tool.apply"; toolCallId: string }
  | { v: 1; type: "tool.reject"; toolCallId: string }
  | { v: 1; type: "settings.update"; patch: SettingsPatch };

// Outbound (host → webview)
type WebviewEvent =
  | { v: 1; type: "session.snapshot"; session: SessionState }
  | { v: 1; type: "session.event"; sessionId: string; event: SessionEvent }
  | { v: 1; type: "tool.call"; sessionId: string; call: ToolCall }
  | { v: 1; type: "tool.result"; sessionId: string; callId: string; result: ToolResult }
  | { v: 1; type: "stream.chunk"; sessionId: string; delta: string; thinking?: string }
  | { v: 1; type: "error"; message: string; recoverable: boolean };
```

## 5. Data flow (main loop)

```
User types in Chat/Input
  → WebView posts {type: "chat.send", ...}
  → router.ts → dsh-bridge/agents.ts
  → ctx.agents[presetId].inbox.push(userMessage)
  → DSH agent loop:
       claim input → assemble prompt → llm/stream
       → assistant/chunk* → assistant/message
       → tool/call* → tools/pre-execute → tools/execute → tools/post-execute → tool/result*
       → step/end
  → dsh-bridge/events.ts subscribes to session/event
  → batched flush every 16ms → posts {type: "session.event", ...}
  → WebView state store applies events:
       stream.chunk → append to current assistant message
       tool.call    → push ToolTrace card
       tool.result  → update card status
  → When a tool writes a file:
       fs-adapter intercepts, calls workspace.applyEdit (real VS Code edit)
       DSH still receives the tool result so the agent loop continues,
       but the file change is now part of the editor's undo stack
  → When user clicks "Accept" on a diff:
       webview posts {type: "tool.apply", callId}
       bridge appends a synthetic tool/result event to the session log
       with status=accepted, so the model can see the user confirmed
  → When user clicks "Reject":
       bridge appends status=rejected with an explanatory note;
       DSH's tools/post-execute listener can use this to abort the
       surrounding task (e.g. propose a different patch)
```

## 6. State & storage

- **API key:** `SecretStorage` (`dsh.apiKey`), never logged.
- **Sessions:** `globalStorage/sessions/{sessionId}.jsonl` — append-only `SessionEvent` stream; loaded on demand by the bridge, mirrored in memory.
- **Settings:** VS Code configuration (`dsh.model`, `dsh.endpoint`, `dsh.logLevel`, `dsh.telemetryEnabled`), read on activation and on change.
- **Per-workspace cwd:** captured from `workspace.workspaceFolders[0].uri.fsPath` at session creation; surfaced in DSH as the FS provider root.
- **Custom presets:** `globalStorage/presets/{presetId}.yml` — a `cordis.patch.yml` overlay that the bridge applies on top of an upstream preset.

## 7. Error handling

| Failure | Handling |
| --- | --- |
| DSH runtime fails to boot | Show a welcome webview with the error + remediation (Node version, missing peer dep, conflicting profile) |
| DeepSeek API call fails (network / 401 / 429) | WebView error bubble, input preserved; retry button; auto-backoff for 429 |
| Tool execution fails (file not found, permission denied) | Red border on the ToolTrace card, error message, retry button; DSH session continues |
| Extension host crash | WebView shows degraded UI; offer "Reload window" command |
| Outdated webview (e.g. shipped older protocol) | Host rejects messages with `protocol_mismatch`; webview offers "Reload" |
| Session log corruption | Detect malformed JSONL; quarantine the bad file, start a new session, show warning |

## 8. Testing strategy

- **Unit (Vitest):** bridge, events normalization, message protocol, storage round-trip, tool adapters (with `vscode` mock).
- **Integration (`@vscode/test-electron`):** boot DSH in a real VS Code, send a scripted user message, assert that the expected `session/event` stream lands in the bridge.
- **Webview (Playwright + a vscode-test harness):** drive the React UI, assert streaming render, tool trace cards, diff Accept/Reject.
- **Performance:** large session (10k events) loads in <500 ms; tool trace list virtualizes at 200 items; streaming latency under 200 ms.
- **Smoke:** `vsce package` and `vsce publish --dry-run` succeed; the `.vsix` installs cleanly into a fresh VS Code profile.

## 9. Build & release

- **Tooling:** TypeScript (`tsc`) for the host, esbuild for the webview bundle, `pnpm` for dependency management, `@vscode/vsce` for packaging.
- **CI (GitHub Actions):** lint (`eslint` + `prettier`), typecheck, unit tests, integration tests on `ubuntu-latest` + `windows-latest`, `vsce package` artifact upload.
- **Release:** SemVer; v0.1.0 ships to the VS Code Marketplace under publisher `hanfengchiyi` (user already owns the account).
- **Versioning of upstream dep:** pin to `^0.1.0`; the `bridge` layer absorbs API churn so the webview stays stable.

## 10. Risks & open questions

| Risk | Mitigation |
| --- | --- |
| Upstream DSH is in dev preview; breaking changes likely | Pin a minor range, write the bridge against stable `ctx.*` services, add an adapter-test that runs on each upstream bump |
| Tool adapter layer is a security boundary — bugs could leak `fs` access outside the workspace | We **do not** let DSH own the FS seam. We register our own `ctx.fs` provider that only accepts paths under `workspace.workspaceFolders[0]`, and routes reads / writes / edits to `workspace.fs` and `workspace.applyEdit`. |
| Streaming many `assistant/chunk` events can flood the webview | 16ms batched flush + zustand selectors that re-render only the current message |
| Interactive PTY through `window.createTerminal` is restricted to read-only-ish interactions from the webview side | Terminal panel uses VS Code's terminal API on the host; webview just sends input lines and reads output via a host-side relay |
| API key leakage in logs | All logging filters `dsh.apiKey`; `SecretStorage` only |
| Localized UI (zh / en) | Use `vscode.l10n.t`; ship `package.nls.json` and `package.nls.zh-cn.json` |
| `@deepseek-ai/dsh-base` is large; the `.vsix` could be tens of MB | esbuild `external` for DSH; `@vscode/vsce` packages node_modules; document install size in README |

## 11. Milestones (matches S3 scope)

| # | Week | Deliverable | Verification |
| --- | --- | --- | --- |
| M1 | 1 | Repo scaffold, extension registers, minimal webview mounts, DSH boots, plain streaming chat (using the default `standard` preset; **tools are registered upstream-side but we do not yet surface them in the UI**) | Activate extension, send a prompt, see assistant reply in webview |
| M2 | 1 | `read` / `write` / `edit` / `bash` / `grep` tools wired through VS Code APIs; workspace cwd awareness | Agent can open a file, edit it, run a command, return result |
| M3 | 1 | Multi-session list (TreeView + webview), all 4 presets switchable, inline diff Accept / Reject | Create 3 sessions, switch between them, change preset mid-session, accept a patch |
| M4 | 1 | Skill panel, DeepSeek API key settings, V4-Flash / V4-Pro model picker, custom endpoint | Toggle a skill on/off, save key in SecretStorage, switch model mid-session |
| M5 | 1 | Context compression UI, subagent indicator (spawn / cancel / inspect), web search | Trigger a long session, see compression, spawn a subagent, web search a query |
| M6 | 1 | Interactive PTY terminal panel, custom preset editor (`cordis.patch.yml`), session import / export | Run an interactive command, create a custom preset, export a session to JSONL, re-import |
| M7 | 1 | Polish, full test suite, docs, screencast, Marketplace publish | `vsce publish` succeeds, marketplace listing live, README with GIFs |

## 12. Dependencies

`package.json` (extension host side):

```jsonc
{
  "dependencies": {
    "@deepseek-ai/cordis": "^0.1.0",
    "@deepseek-ai/dsh-base": "^0.1.0",
    "@deepseek-ai/dsh-headless": "^0.1.0"
  },
  "devDependencies": {
    "@types/vscode": "^1.95.0",
    "@types/node": "^20",
    "esbuild": "^0.20",
    "typescript": "^5.4",
    "vitest": "^1.6",
    "@vscode/test-electron": "^2.4",
    "@vscode/vsce": "^2.24",
    "eslint": "^8.57",
    "prettier": "^3"
  }
}
```

Webview (`src/ui/package.json`):

```jsonc
{
  "dependencies": {
    "react": "^18.3",
    "react-dom": "^18.3",
    "zustand": "^4.5",
    "xterm": "^5.3",
    "xterm-addon-fit": "^0.8",
    "react-markdown": "^9",
    "remark-gfm": "^4",
    "vscode-webview-bridge": "file:../shared/protocol"
  },
  "devDependencies": {
    "vite": "^5",
    "@vitejs/plugin-react": "^4"
  }
}
```

## 13. Out of scope (deferred to later versions)

- Sync DSH UI bundle hot-reload
- Remote / cloud sandbox provider
- Cross-device session sync
- Marketplace distribution of community presets and skills
- Telemetry export (only local logging for now)
- Support for VS Code forks other than Code OSS

---

## Appendix A — Why we are NOT forking the upstream monorepo

Approach 2 (add `packages/vscode-extension` to the fork) was rejected because:

1. Upstream `deepseek-harness` is a 0.1 dev preview with weekly breaking changes; in-tree coupling forces constant rebases.
2. The user's fork exists to track upstream, not to host a separate product.
3. The new `vscode-deepseek` directory is already a standalone workspace — Approach 1 matches that intent.
4. A future PR back upstream is still possible: the bridge layer is a normal DSH consumer; the webview can be published as a separate `dsh-vscode` bundle that upstream can adopt if they want.

## Appendix B — Reference extensions

The implementation will reference the architectural patterns of:

- `anthropics/claude-code` VS Code extension — bottom panel chat, streaming render, tool trace
- `openai/codex` VS Code extension — chat panel with file context, command palette integration
- `cline/cline` — tool call / diff card UX
- `continuedev/continue` — preset / model switcher

DSH-specific patterns (multi-agent orchestration, Skill, session log replay) are derived from upstream `docs/architecture.md` and the `dsh-web-app` UI.
