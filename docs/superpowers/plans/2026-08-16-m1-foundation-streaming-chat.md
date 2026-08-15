# M1 — Foundation & Streaming Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a runnable VS Code extension that boots the DeepSeek Harness runtime inside the extension host and renders plain streaming chat (no tool surfacing yet) in a WebView panel. By the end of M1, sending a prompt from the WebView produces a streamed assistant reply.

**Architecture:** Three layers — DSH runtime (`@deepseek-ai/dsh-base` + `dsh-headless`) running inside the extension host; a thin typed bridge that wraps `ctx.sessions`, `ctx.agents`, and `session/event`; a WebView rendering a React chat UI that talks to the bridge over a versioned `postMessage` protocol.

**Tech Stack:** TypeScript 5.4, pnpm, esbuild (host bundle), Vite + React 18 (webview bundle), Vitest (unit), `@vscode/test-electron` (integration), `@vscode/vsce` (packaging), `zustand` (webview state).

## Global Constraints

These are pulled from the spec verbatim. Every task must honour them.

- **License:** MIT, inherited from upstream.
- **VS Code target:** `^1.95.0` (required for `vscode.lm.tools`, modern webview APIs).
- **Upstream dependency range:** `@deepseek-ai/cordis`, `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-headless` all `^0.1.0`.
- **Engine:** Node `>=20`.
- **Source layout:** TypeScript under `src/` for the host, TypeScript + React under `src/ui/src/` for the webview. Build outputs at `dist/extension/` and `src/ui/dist/`. **No `out/` directory** — VS Code extension convention.
- **Naming:** All commands prefixed with `dsh.` (e.g. `dsh.openChat`).
- **Security:** No raw `fs` / `child_process` from DSH tools — all file and terminal access routes through VS Code APIs in later milestones (M1 only reads/writes through DSH's default `fs` provider, no custom one yet).
- **i18n:** Use `vscode.l10n.t` for any user-visible string; ship `package.nls.json` and `package.nls.zh-cn.json`.
- **Commit policy:** Each task ends with a single `git commit` with a one-line Conventional Commits message.
- **Test policy:** TDD — for any code task, write the failing test first.

## File Structure (target after M1)

```
vscode-deepseek/
├── package.json                          # extension manifest
├── pnpm-workspace.yaml                   # marks src/ui as a workspace package
├── tsconfig.json                         # host TS config
├── tsconfig.webview.json                 # (not used M1; future)
├── esbuild.config.mjs                    # host bundler config
├── .eslintrc.cjs
├── .prettierrc
├── .vscodeignore
├── .gitignore
├── .vscode/                              # editor settings for the repo itself
│   ├── launch.json                       # "Run Extension" debug config
│   ├── tasks.json                        # pnpm build/watch tasks
│   └── settings.json
├── README.md
├── AGENTS.md
├── package.nls.json                      # English strings
├── package.nls.zh-cn.json                # Chinese strings
├── src/
│   ├── extension.ts                      # activate/deactivate
│   ├── shared/
│   │   └── protocol.ts                   # shared HostCommand / WebviewEvent types
│   ├── dsh-bridge/
│   │   ├── boot.ts                       # load DSH, build ctx
│   │   ├── agents.ts                     # inbox + session handle
│   │   ├── sessions.ts                   # list / create / get session
│   │   └── events.ts                     # subscribe + batched flush
│   ├── webview-host/
│   │   ├── panel.ts                      # create + dispose chat panel
│   │   └── router.ts                     # typed message router
│   └── commands/
│       └── openChat.ts                   # dsh.openChat command
├── src/ui/                               # webview workspace package
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx                      # React entry
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatHistory.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   └── Message.tsx
│   │   ├── state/
│   │   │   └── store.ts                  # zustand store
│   │   └── messages/
│   │       └── client.ts                 # typed postMessage wrapper
│   └── dist/                             # Vite build output (gitignored)
├── tests/
│   ├── unit/
│   │   ├── protocol.test.ts
│   │   ├── boot.test.ts
│   │   ├── events.test.ts
│   │   └── router.test.ts
│   └── integration/
│       └── smoke.test.ts
└── docs/
    └── superpowers/
        ├── specs/
        │   └── 2026-08-16-dsh-vscode-extension-design.md
        └── plans/
            └── 2026-08-16-m1-foundation-streaming-chat.md
```

### Why this decomposition

- `src/dsh-bridge/` is the only place that imports `@deepseek-ai/dsh-*` packages. The rest of the host can be reasoned about without knowing DSH internals.
- `src/shared/protocol.ts` is the single source of truth for the wire format. The host imports it via a relative path; the webview imports it via the `@shared/*` Vite alias (configured in Task 7). Adding a message is a one-file change plus a switch arm in `src/webview-host/router.ts`.
- `tests/unit/` covers pure logic; `tests/integration/` boots a real VS Code with `@vscode/test-electron`.

---

## Task 1: Repo scaffold + extension manifest

**Files:**
- Create: `D:\Code\deepseek\vscode-deepseek\package.json`
- Create: `D:\Code\deepseek\vscode-deepseek\pnpm-workspace.yaml`
- Create: `D:\Code\deepseek\vscode-deepseek\tsconfig.json`
- Create: `D:\Code\deepseek\vscode-deepseek\esbuild.config.mjs`
- Create: `D:\Code\deepseek\vscode-deepseek\.gitignore`
- Create: `D:\Code\deepseek\vscode-deepseek\.vscodeignore`
- Create: `D:\Code\deepseek\vscode-deepseek\.eslintrc.cjs`
- Create: `D:\Code\deepseek\vscode-deepseek\.prettierrc`
- Create: `D:\Code\deepseek\vscode-deepseek\.vscode\launch.json`
- Create: `D:\Code\deepseek\vscode-deepseek\.vscode\tasks.json`
- Create: `D:\Code\deepseek\vscode-deepseek\.vscode\settings.json`

- [ ] **Step 1: Initialize git**

```bash
cd D:\Code\deepseek\vscode-deepseek
git init
git config user.name "Wu Nianseng"
git config user.email "hanfengchiyi@163.com"
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "dsh-vscode",
  "displayName": "DeepSeek Harness",
  "description": "DeepSeek Harness inside VS Code — chat, tools, skills, multi-agent.",
  "version": "0.1.0",
  "publisher": "hanfengchiyi",
  "license": "MIT",
  "engines": {
    "vscode": "^1.95.0",
    "node": ">=20"
  },
  "categories": ["AI", "Chat", "Programming Languages"],
  "keywords": ["deepseek", "agent", "harness", "dsh"],
  "main": "./dist/extension/extension.js",
  "activationEvents": ["onCommand:dsh.openChat"],
  "contributes": {
    "commands": [
      { "command": "dsh.openChat", "title": "DeepSeek Harness: Open Chat" }
    ]
  },
  "scripts": {
    "build:host": "node esbuild.config.mjs",
    "build:webview": "pnpm --filter @dsh/webview run build",
    "build": "pnpm run build:host && pnpm run build:webview",
    "watch:host": "node esbuild.config.mjs --watch",
    "watch:webview": "pnpm --filter @dsh/webview run dev",
    "test:unit": "vitest run",
    "test:integration": "vscode-test",
    "test": "pnpm run test:unit && pnpm run test:integration",
    "package": "pnpm run build && vsce package",
    "lint": "eslint src --ext .ts",
    "format": "prettier --write \"src/**/*.{ts,tsx,css,html,json}\""
  },
  "dependencies": {
    "@deepseek-ai/cordis": "^0.1.0",
    "@deepseek-ai/dsh-base": "^0.1.0",
    "@deepseek-ai/dsh-headless": "^0.1.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/vscode": "^1.95.0",
    "@vscode/test-electron": "^2.4",
    "@vscode/vsce": "^2.24",
    "esbuild": "^0.20",
    "eslint": "^8.57",
    "prettier": "^3",
    "typescript": "^5.4",
    "vitest": "^1.6"
  }
}
```

- [ ] **Step 3: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "."
  - "src/ui"
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist/extension",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true,
    "lib": ["ES2022"],
    "types": ["node", "vscode"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["src/ui", "node_modules", "dist"]
}
```

- [ ] **Step 5: Write `esbuild.config.mjs`**

```js
import { build, context } from "esbuild";
import { readFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension/extension.js",
  external: ["vscode", ...Object.keys(pkg.dependencies ?? {})],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: false,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log("[esbuild] watching for changes…");
} else {
  await build(config);
}
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules/
dist/
src/ui/dist/
src/ui/node_modules/
*.log
.DS_Store
.vscode-test/
coverage/
.vsix
.env
.env.local
```

- [ ] **Step 7: Write `.vscodeignore`**

```
node_modules/
src/
tests/
docs/
*.md
.vscode/
.gitignore
.eslintrc.cjs
.prettierrc
.eslintcache
.vscode-test/
coverage/
*.tsbuildinfo
pnpm-workspace.yaml
tsconfig.json
```

- [ ] **Step 8: Write `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  env: { node: true, es2022: true },
  ignorePatterns: ["dist/", "src/ui/dist/", "node_modules/"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "warn",
  },
};
```

- [ ] **Step 9: Write `.prettierrc`**

```json
{
  "singleQuote": false,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 10: Write `.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/extension/**/*.js"],
      "preLaunchTask": "pnpm: build:host"
    },
    {
      "name": "Run Extension (watch)",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/extension/**/*.js"]
    }
  ]
}
```

- [ ] **Step 11: Write `.vscode/tasks.json`**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "pnpm: build:host",
      "type": "shell",
      "command": "pnpm run build:host",
      "group": "build",
      "problemMatcher": ["$esbuild"]
    },
    {
      "label": "pnpm: watch:host",
      "type": "shell",
      "command": "pnpm run watch:host",
      "isBackground": true,
      "group": "build"
    }
  ]
}
```

- [ ] **Step 12: Write `.vscode/settings.json`**

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "files.eol": "\n",
  "editor.tabSize": 2,
  "editor.formatOnSave": true
}
```

- [ ] **Step 13: Install dependencies**

```bash
cd D:\Code\deepseek\vscode-deepseek
pnpm install
```

Expected: install succeeds; `node_modules/@deepseek-ai/` is populated; `node_modules/.pnpm/` exists. If upstream packages are not yet on npm, this step will fail — see "Upstream package availability" in §Notes below.

- [ ] **Step 14: Commit**

```bash
git add .
git commit -m "chore: scaffold vscode extension manifest and build pipeline"
```

---

## Task 2: Minimal activate entry that registers `dsh.openChat`

**Files:**
- Create: `src/extension.ts`
- Create: `tests/unit/extension.test.ts`

**Interfaces:**
- Consumes: `vscode.ExtensionContext` from VS Code API
- Produces: `activate(context: vscode.ExtensionContext): void`, `deactivate(): void`, command `dsh.openChat` registered

- [ ] **Step 1: Write the failing test**

Create `tests/unit/extension.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

// Mock the `vscode` module before importing the SUT
vi.mock("vscode", () => ({
  commands: {
    registerCommand: vi.fn(),
  },
  window: {
    showInformationMessage: vi.fn(),
  },
  ExtensionContext: class {},
}));

import { activate, deactivate } from "../../src/extension";
import * as vscode from "vscode";

describe("extension entry", () => {
  it("registers the dsh.openChat command on activate", () => {
    activate({} as vscode.ExtensionContext);
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      "dsh.openChat",
      expect.any(Function),
    );
  });

  it("deactivate is callable", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd D:\Code\deepseek\vscode-deepseek
pnpm exec vitest run tests/unit/extension.test.ts
```

Expected: FAIL — `src/extension.ts` does not exist.

- [ ] **Step 3: Write `src/extension.ts`**

```ts
import * as vscode from "vscode";
import { openChatCommand } from "./commands/openChat";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("dsh.openChat", () => {
      vscode.window.showInformationMessage(
        vscode.l10n.t("DeepSeek Harness: openChat is not yet wired (M1 stub)."),
      );
      return openChatCommand();
    }),
  );
}

export function deactivate(): void {
  // no-op for M1; later milestones will dispose panel + DSH ctx
}
```

- [ ] **Step 4: Create the stub `src/commands/openChat.ts`**

```ts
import * as vscode from "vscode";

/**
 * M1 stub. In M1 this only shows an information message.
 * Later milestones will create / focus the chat WebView panel.
 */
export function openChatCommand(): Thenable<void> {
  return vscode.window.showInformationMessage(
    vscode.l10n.t("DeepSeek Harness chat will open here."),
  );
}
```

- [ ] **Step 5: Add `package.nls.json` and `package.nls.zh-cn.json`**

Create `package.nls.json`:

```json
{
  "dsh.openChat.title": "DeepSeek Harness: Open Chat"
}
```

Create `package.nls.zh-cn.json`:

```json
{
  "dsh.openChat.title": "DeepSeek Harness: 打开聊天"
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/unit/extension.test.ts
```

Expected: PASS (2 tests passing).

- [ ] **Step 7: Verify the extension loads in VS Code**

```bash
pnpm run build:host
```

Expected: builds to `dist/extension/extension.js`. Now in VS Code, run the "Run Extension" launch config from `.vscode/launch.json`. A new VS Code window opens with the extension loaded. Open the Command Palette (Ctrl+Shift+P) and run "DeepSeek Harness: Open Chat". Expected: a notification appears with the text "DeepSeek Harness chat will open here." Close the window.

- [ ] **Step 8: Commit**

```bash
git add src/extension.ts src/commands/openChat.ts tests/unit/extension.test.ts package.nls.json package.nls.zh-cn.json
git commit -m "feat: register dsh.openChat command with i18n stub"
```

---

## Task 3: Shared protocol types

**Files:**
- Create: `src/shared/protocol.ts`
- Create: `tests/unit/protocol.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: types `HostCommand`, `WebviewEvent`, both with `v: 1` discriminator, JSON-serializable

- [ ] **Step 1: Write the failing test**

Create `tests/unit/protocol.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { HostCommand, WebviewEvent } from "../../src/shared/protocol";

describe("protocol types", () => {
  it("HostCommand.chat.send is JSON-serializable", () => {
    const cmd: HostCommand = {
      v: 1,
      type: "chat.send",
      sessionId: "sess-1",
      text: "hello",
    };
    const json = JSON.stringify(cmd);
    const back: HostCommand = JSON.parse(json);
    expect(back.type).toBe("chat.send");
  });

  it("WebviewEvent union discriminates by type field", () => {
    type Discriminator = WebviewEvent["type"];
    const cases: Discriminator[] = [
      "session.snapshot",
      "session.event",
      "stream.chunk",
      "tool.call",
      "tool.result",
      "error",
    ];
    expectTypeOf(cases).toEqualTypeOf<
      ["session.snapshot", "session.event", "stream.chunk", "tool.call", "tool.result", "error"]
    >();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/unit/protocol.test.ts
```

Expected: FAIL — `src/shared/protocol.ts` does not exist.

- [ ] **Step 3: Write `src/shared/protocol.ts`**

```ts
/**
 * Wire protocol between the WebView and the extension host.
 *
 * Both directions are versioned with a `v` field. Bump `v` only for breaking
 * changes; additive fields on existing types are fine.
 *
 * Messages are JSON-serializable. Optional fields are genuinely optional;
 * `undefined` is preserved through `JSON.stringify` -> `JSON.parse` only when
 * the value was missing on the wire, which the receiver should treat as
 * "field not present".
 */

export const PROTOCOL_VERSION = 1 as const;

// ───────────────────────── Inbound (webview → host) ─────────────────────────

export interface ChatSend {
  v: 1;
  type: "chat.send";
  sessionId: string;
  text: string;
}

export interface ChatCancel {
  v: 1;
  type: "chat.cancel";
  sessionId: string;
}

export interface Ready {
  v: 1;
  type: "ready";
}

export type HostCommand = ChatSend | ChatCancel | Ready;

// ───────────────────────── Outbound (host → webview) ────────────────────────

export interface StreamChunk {
  v: 1;
  type: "stream.chunk";
  sessionId: string;
  /** Monotonically increasing per-session. The webview appends to the
   *  currently streaming assistant message with this id. */
  messageId: string;
  delta: string;
  thinking?: string;
}

export interface StreamEnd {
  v: 1;
  type: "stream.end";
  sessionId: string;
  messageId: string;
}

export interface SessionSnapshot {
  v: 1;
  type: "session.snapshot";
  sessionId: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
  }>;
}

export interface ErrorEvent {
  v: 1;
  type: "error";
  message: string;
  recoverable: boolean;
}

export type WebviewEvent = StreamChunk | StreamEnd | SessionSnapshot | ErrorEvent;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/unit/protocol.test.ts
```

Expected: PASS (2 tests passing).

- [ ] **Step 5: Commit**

```bash
git add src/shared/protocol.ts tests/unit/protocol.test.ts
git commit -m "feat(protocol): define webview↔host message types"
```

---

## Task 4: DSH bridge — boot the runtime

**Files:**
- Create: `src/dsh-bridge/boot.ts`
- Create: `tests/unit/boot.test.ts`

**Interfaces:**
- Consumes: `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-headless` (real packages)
- Produces: `interface DshHandle { ctx: Ctx; dispose(): Promise<void> }` and `async function bootDsh(opts?: BootOptions): Promise<DshHandle>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/boot.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";

// Mock the DSH packages so the test does not need a real profile
vi.mock("@deepseek-ai/dsh-headless", () => ({
  createHeadlessApp: vi.fn(async () => ({
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    ctx: { _stub: true },
  })),
}));

import { bootDsh } from "../../src/dsh-bridge/boot";
import * as headless from "@deepseek-ai/dsh-headless";

describe("bootDsh", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns a handle whose ctx is non-null", async () => {
    const handle = await bootDsh({ profile: "headless" });
    expect(handle.ctx).toBeTruthy();
    await handle.dispose();
  });

  it("calls createHeadlessApp with the requested profile", async () => {
    await bootDsh({ profile: "headless" });
    expect(headless.createHeadlessApp).toHaveBeenCalledWith(
      expect.objectContaining({ profile: "headless" }),
    );
  });

  it("dispose() is idempotent and resolves cleanly", async () => {
    const handle = await bootDsh({ profile: "headless" });
    await handle.dispose();
    await expect(handle.dispose()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/unit/boot.test.ts
```

Expected: FAIL — `src/dsh-bridge/boot.ts` does not exist.

- [ ] **Step 3: Write `src/dsh-bridge/boot.ts`**

```ts
import { createHeadlessApp, type HeadlessApp } from "@deepseek-ai/dsh-headless";

export interface BootOptions {
  /** DSH profile name. "headless" is the no-UI baseline; "web" adds
   *  the bundled web UI which we do not need here. M1 uses "headless". */
  profile?: "headless" | "web";
  /** Override the model. Defaults to whatever the profile specifies. */
  model?: string;
}

/** Minimal surface we depend on from the DSH ctx. We deliberately keep this
 *  narrow so the bridge compiles even when upstream adds more services. */
export interface DshCtx {
  sessions?: unknown;
  agents?: unknown;
  llm?: unknown;
  tools?: unknown;
}

export interface DshHandle {
  ctx: DshCtx;
  app: HeadlessApp;
  disposed: boolean;
  dispose(): Promise<void>;
}

export async function bootDsh(opts: BootOptions = {}): Promise<DshHandle> {
  const profile = opts.profile ?? "headless";
  const app = await createHeadlessApp({
    profile,
    ...(opts.model ? { model: opts.model } : {}),
  });
  await app.start();

  let disposed = false;
  return {
    app,
    ctx: app.ctx as DshCtx,
    get disposed() {
      return disposed;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await app.stop();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/unit/boot.test.ts
```

Expected: PASS (3 tests passing). The mock is in place; real DSH loading is not exercised yet. The integration test (Task 12) will exercise the real boot.

- [ ] **Step 5: Commit**

```bash
git add src/dsh-bridge/boot.ts tests/unit/boot.test.ts
git commit -m "feat(dsh-bridge): add bootDsh with headless profile"
```

---

## Task 5: DSH bridge — events subscription with batched flush

**Files:**
- Create: `src/dsh-bridge/events.ts`
- Create: `tests/unit/events.test.ts`

**Interfaces:**
- Consumes: a `DshCtx` from `bootDsh`
- Produces: `interface EventSubscription { close(): void }` and `subscribeDshEvents(ctx, sink: (events: WebviewEvent[]) => void, options?: { flushIntervalMs?: number }): EventSubscription`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/events.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { subscribeDshEvents } from "../../src/dsh-bridge/events";
import type { DshCtx } from "../../src/dsh-bridge/boot";

function makeCtx() {
  const listeners: Array<(event: any) => void> = [];
  const ctx = {
    sessions: {
      on: (_name: string, fn: (e: any) => void) => {
        listeners.push(fn);
        return { dispose: () => {} };
      },
    },
  } as unknown as DshCtx;
  return { ctx, listeners };
}

describe("subscribeDshEvents", () => {
  it("batches multiple events into a single sink call", async () => {
    const { ctx, listeners } = makeCtx();
    const sink = vi.fn();
    const sub = subscribeDshEvents(ctx, sink, { flushIntervalMs: 16 });

    listeners.forEach((l) =>
      l({ type: "session/event", payload: { kind: "assistant/chunk", delta: "hi" } }),
    );
    listeners.forEach((l) =>
      l({ type: "session/event", payload: { kind: "assistant/chunk", delta: " there" } }),
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].length).toBe(2);
    sub.close();
  });

  it("close() stops further flushes", async () => {
    const { ctx, listeners } = makeCtx();
    const sink = vi.fn();
    const sub = subscribeDshEvents(ctx, sink, { flushIntervalMs: 10 });
    sub.close();
    listeners.forEach((l) => l({ type: "session/event", payload: { x: 1 } }));
    await new Promise((r) => setTimeout(r, 25));
    expect(sink).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/unit/events.test.ts
```

Expected: FAIL — `src/dsh-bridge/events.ts` does not exist.

- [ ] **Step 3: Write `src/dsh-bridge/events.ts`**

```ts
import type { DshCtx } from "./boot";
import type { WebviewEvent } from "../shared/protocol";

export interface EventSubscription {
  close(): void;
}

export interface SubscribeOptions {
  /** How often the buffer is flushed to the sink. Default 16ms. */
  flushIntervalMs?: number;
}

interface RawSessionEvent {
  type: string;
  payload: unknown;
}

/**
 * Subscribe to DSH's `session/event` stream and deliver batched
 * `WebviewEvent[]` to the sink. The bridge is responsible for translating
 * raw events to `WebviewEvent`; this module only handles batching.
 */
export function subscribeDshEvents(
  ctx: DshCtx,
  sink: (events: WebviewEvent[]) => void,
  options: SubscribeOptions = {},
): EventSubscription {
  const flushMs = options.flushIntervalMs ?? 16;
  const buffer: WebviewEvent[] = [];
  let closed = false;

  // DSH exposes an event hub on `ctx.sessions.on(name, listener)`. We only
  // listen to the durable `session/event` channel for M1.
  const sessions = ctx.sessions as
    | { on: (name: string, fn: (e: RawSessionEvent) => void) => { dispose: () => void } }
    | undefined;
  const subs: Array<{ dispose: () => void }> = [];
  if (sessions?.on) {
    subs.push(sessions.on("session/event", (raw) => {
      const mapped = mapSessionEvent(raw);
      if (mapped) buffer.push(mapped);
    }));
  }

  const timer = setInterval(() => {
    if (closed || buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    sink(batch);
  }, flushMs);

  return {
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      for (const s of subs) s.dispose();
    },
  };
}

/**
 * Map a raw DSH `session/event` to a `WebviewEvent`. For M1 we only handle
 * `assistant/chunk` (streaming) and `step/end` (close the current message).
 * Other events are ignored at this stage.
 */
function mapSessionEvent(raw: RawSessionEvent): WebviewEvent | null {
  const p = raw.payload as { kind?: string; sessionId?: string; messageId?: string; delta?: string; content?: string } | undefined;
  if (!p?.kind) return null;
  switch (p.kind) {
    case "assistant/chunk":
      return {
        v: 1,
        type: "stream.chunk",
        sessionId: p.sessionId ?? "unknown",
        messageId: p.messageId ?? "msg",
        delta: p.delta ?? "",
      };
    case "step/end":
      return {
        v: 1,
        type: "stream.end",
        sessionId: p.sessionId ?? "unknown",
        messageId: p.messageId ?? "msg",
      };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run tests/unit/events.test.ts
```

Expected: PASS (2 tests passing).

- [ ] **Step 5: Commit**

```bash
git add src/dsh-bridge/events.ts tests/unit/events.test.ts
git commit -m "feat(dsh-bridge): batched subscription to session/event"
```

---

## Task 6: Webview host — panel + router

**Files:**
- Create: `src/webview-host/panel.ts`
- Create: `src/webview-host/router.ts`
- Create: `tests/unit/router.test.ts`

**Interfaces:**
- Consumes: a `DshHandle` from `bootDsh`, `vscode.ExtensionContext` (for `extensionUri`)
- Produces: `class ChatPanel { static create(ctx, dsh): ChatPanel; reveal(): void; dispose(): void }` and `installRouter(panel, dsh): vscode.Disposable`

- [ ] **Step 1: Write the failing test for the router**

Create `tests/unit/router.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { installRouter } from "../../src/webview-host/router";
import type { WebviewEvent } from "../../src/shared/protocol";

function makePanel() {
  const sent: WebviewEvent[] = [];
  return {
    panel: {
      webview: {
        postMessage: vi.fn(async (msg: WebviewEvent) => {
          sent.push(msg);
        }),
      },
      onDidReceiveMessage: vi.fn(),
    },
    sent,
  };
}

function makeDsh() {
  const inbox: Array<{ type: string; text?: string }> = [];
  return {
    dsh: {
      ctx: { _stub: true },
      pushInbox: (item: { type: string; text?: string }) => inbox.push(item),
      inbox,
    } as any,
    inbox,
  };
}

describe("router", () => {
  it("routes chat.send to dsh.pushInbox", () => {
    const { panel } = makePanel();
    const { dsh, inbox } = makeDsh();
    const sub = installRouter(panel as any, dsh);
    const handler = (panel.onDidReceiveMessage as any).mock.calls[0][0];
    handler({ v: 1, type: "chat.send", sessionId: "s1", text: "hi" });
    expect(inbox).toEqual([{ type: "chat.send", text: "hi" }]);
    sub.dispose();
  });

  it("ignores messages with a mismatched protocol version", () => {
    const { panel } = makePanel();
    const { dsh, inbox } = makeDsh();
    const sub = installRouter(panel as any, dsh);
    const handler = (panel.onDidReceiveMessage as any).mock.calls[0][0];
    handler({ v: 99, type: "chat.send", sessionId: "s1", text: "hi" });
    expect(inbox).toEqual([]);
    sub.dispose();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run tests/unit/router.test.ts
```

Expected: FAIL — `src/webview-host/router.ts` does not exist.

- [ ] **Step 3: Write `src/webview-host/router.ts`**

```ts
import type * as vscode from "vscode";
import type { HostCommand, WebviewEvent } from "../shared/protocol";
import type { DshHandle } from "../dsh-bridge/boot";

/** Shape of the panel we need; keeps the router testable without VS Code. */
export interface WebviewPanelLike {
  webview: { postMessage: (msg: WebviewEvent) => Thenable<boolean> };
  onDidReceiveMessage: (
    handler: (msg: HostCommand) => void,
  ) => vscode.Disposable;
}

/** Bridge handle the router needs. We extend DshHandle with whatever M1 needs
 *  to do: push to inbox. Real DSH integration is wired in M2. */
export interface RouterDsh {
  ctx: DshHandle["ctx"];
  pushInbox(item: { type: string; sessionId: string; text?: string }): void;
}

export function installRouter(
  panel: WebviewPanelLike,
  dsh: RouterDsh,
): vscode.Disposable {
  const sub = panel.onDidReceiveMessage(async (msg) => {
    if (!msg || msg.v !== 1) {
      await panel.webview.postMessage({
        v: 1,
        type: "error",
        message: `Protocol mismatch: expected v=1, got v=${(msg as { v?: number })?.v}`,
        recoverable: true,
      });
      return;
    }
    switch (msg.type) {
      case "chat.send":
        dsh.pushInbox({ type: "chat.send", sessionId: msg.sessionId, text: msg.text });
        break;
      case "chat.cancel":
        // Wired in a later milestone.
        break;
      case "ready":
        // The webview signals it has mounted and is ready to receive events.
        // M1 does not need a snapshot, but later milestones will.
        break;
    }
  });
  return sub;
}
```

- [ ] **Step 4: Write `src/webview-host/panel.ts`**

```ts
import * as vscode from "vscode";
import * as path from "node:path";
import { installRouter, type WebviewPanelLike } from "./router";
import type { DshHandle } from "../dsh-bridge/boot";
import { subscribeDshEvents } from "../dsh-bridge/events";

const VIEW_TYPE = "dsh.chatPanel";

let singleton: ChatPanel | undefined;

export class ChatPanel {
  public static readonly viewType = VIEW_TYPE;

  public static createOrShow(extensionUri: vscode.Uri, dsh: DshHandle): ChatPanel {
    if (singleton) {
      singleton.panel.reveal();
      return singleton;
    }
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      "DeepSeek Harness",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "src", "ui", "dist")],
      },
    );
    singleton = new ChatPanel(panel, extensionUri, dsh);
    return singleton;
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly eventSub: { close(): void };

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    dsh: DshHandle,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.renderHtml(extensionUri, panel.webview);
    this.eventSub = subscribeDshEvents(dsh.ctx, (events) => {
      for (const ev of events) {
        void this.panel.webview.postMessage(ev);
      }
    });
    this.disposables.push(
      installRouter(this.panel as WebviewPanelLike, {
        ctx: dsh.ctx,
        pushInbox: (item) => {
          // M1 stub: log to the host output channel. M2 will push to the
          // real DSH agent inbox.
          console.log("[dsh-bridge] would push to agent inbox:", item);
        },
      }),
      this.panel.onDidDispose(() => this.dispose(), null, this.disposables),
    );
  }

  public reveal(): void {
    this.panel.reveal();
  }

  public dispose(): void {
    if (singleton === this) singleton = undefined;
    this.eventSub.close();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      try {
        d?.dispose();
      } catch {
        /* ignore */
      }
    }
    this.panel.dispose();
  }

  private renderHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string {
    // The webview bundle will be created in Task 7. For now, we point at the
    // expected output file; the host fails gracefully if it is missing.
    const scriptPath = vscode.Uri.joinPath(
      extensionUri,
      "src",
      "ui",
      "dist",
      "assets",
      "index.js",
    );
    const scriptUri = webview.asWebviewUri(scriptPath);
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "src", "ui", "dist", "assets", "index.css"),
    );
    const csp = webview.cspSource;
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp};" />
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
```

- [ ] **Step 5: Run the router test to verify it passes**

```bash
pnpm exec vitest run tests/unit/router.test.ts
```

Expected: PASS (2 tests passing).

- [ ] **Step 6: Commit**

```bash
git add src/webview-host/panel.ts src/webview-host/router.ts tests/unit/router.test.ts
git commit -m "feat(webview-host): chat panel with router and event subscription"
```

---

## Task 7: Webview bundle — Vite + React scaffold

**Files:**
- Create: `src/ui/package.json`
- Create: `src/ui/tsconfig.json`
- Create: `src/ui/vite.config.ts`
- Create: `src/ui/index.html`
- Create: `src/ui/src/main.tsx`
- Create: `src/ui/src/App.tsx`
- Create: `src/ui/src/styles.css`

- [ ] **Step 1: Write `src/ui/package.json`**

```json
{
  "name": "@dsh/webview",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3",
    "react-dom": "^18.3",
    "zustand": "^4.5"
  },
  "devDependencies": {
    "@types/react": "^18.3",
    "@types/react-dom": "^18.3",
    "@vitejs/plugin-react": "^4",
    "typescript": "^5.4",
    "vite": "^5"
  }
}
```

- [ ] **Step 2: Write `src/ui/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "useDefineForClassFields": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  },
  "include": ["src", "../shared"]
}
```

- [ ] **Step 3: Write `src/ui/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Output filenames are deterministic so the host can find them by name.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
```

- [ ] **Step 4: Write `src/ui/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DeepSeek Harness</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `src/ui/src/main.tsx`**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Write a minimal `src/ui/src/App.tsx`**

```tsx
import React from "react";

export const App: React.FC = () => {
  return (
    <div className="dsh-app">
      <h1>DeepSeek Harness</h1>
      <p>M1 stub — chat UI lands in Task 8.</p>
    </div>
  );
};
```

- [ ] **Step 7: Write `src/ui/src/styles.css`**

```css
:root {
  --dsh-bg: var(--vscode-editor-background);
  --dsh-fg: var(--vscode-editor-foreground);
  --dsh-accent: var(--vscode-button-background);
  --dsh-accent-fg: var(--vscode-button-foreground);
  --dsh-border: var(--vscode-panel-border);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--dsh-fg);
  background: var(--dsh-bg);
}

.dsh-app {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100vh;
  box-sizing: border-box;
}

.dsh-app h1 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
```

- [ ] **Step 8: Install webview dependencies**

```bash
cd D:\Code\deepseek\vscode-deepseek
pnpm install
```

Expected: webview workspace `@dsh/webview` gets `react`, `vite`, etc.

- [ ] **Step 9: Build the webview bundle**

```bash
pnpm run build:webview
```

Expected: build succeeds; `src/ui/dist/assets/index.js` and `src/ui/dist/assets/index.css` exist. Vite will also emit `index.html` at `src/ui/dist/index.html` (this is fine, the host only references the assets directly).

- [ ] **Step 10: Commit**

```bash
git add src/ui/package.json src/ui/tsconfig.json src/ui/vite.config.ts src/ui/index.html src/ui/src/main.tsx src/ui/src/App.tsx src/ui/src/styles.css
git commit -m "feat(webview): vite + react scaffold"
```

---

## Task 8: Webview — chat UI shell with streaming render

**Files:**
- Create: `src/ui/src/messages/client.ts`
- Create: `src/ui/src/state/store.ts`
- Create: `src/ui/src/components/ChatHistory.tsx`
- Create: `src/ui/src/components/ChatInput.tsx`
- Create: `src/ui/src/components/Message.tsx`
- Modify: `src/ui/src/App.tsx`

- [ ] **Step 1: Write `src/ui/src/messages/client.ts`**

```ts
import type { HostCommand, WebviewEvent } from "@shared/protocol";

declare function acquireVsCodeApi(): {
  postMessage(msg: HostCommand): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

export function send(cmd: HostCommand): void {
  vscode.postMessage(cmd);
}

export function onMessage(handler: (ev: WebviewEvent) => void): () => void {
  const listener = (event: MessageEvent) => handler(event.data as WebviewEvent);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
```

- [ ] **Step 2: Write `src/ui/src/state/store.ts`**

```ts
import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
}

interface ChatState {
  sessionId: string;
  messages: ChatMessage[];
  input: string;
  setInput: (s: string) => void;
  appendDelta: (messageId: string, delta: string) => void;
  endStream: (messageId: string) => void;
  addUserMessage: (text: string) => string;
  addAssistantPlaceholder: () => string;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: "sess-1",
  messages: [],
  input: "",
  setInput: (input) => set({ input }),
  appendDelta: (messageId, delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + delta } : m,
      ),
    })),
  endStream: (messageId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, streaming: false } : m,
      ),
    })),
  addUserMessage: (text) => {
    const id = `u-${Date.now()}`;
    set((s) => ({ messages: [...s.messages, { id, role: "user", content: text }] }));
    return id;
  },
  addAssistantPlaceholder: () => {
    const id = `a-${Date.now()}`;
    set((s) => ({
      messages: [...s.messages, { id, role: "assistant", content: "", streaming: true }],
    }));
    return id;
  },
}));
```

- [ ] **Step 3: Write `src/ui/src/components/Message.tsx`**

```tsx
import React from "react";
import type { ChatMessage } from "../state/store";

export const Message: React.FC<{ message: ChatMessage }> = ({ message }) => {
  return (
    <div className={`dsh-message dsh-message-${message.role}`}>
      <div className="dsh-message-role">{message.role}</div>
      <div className="dsh-message-content">
        {message.content}
        {message.streaming ? <span className="dsh-cursor">▍</span> : null}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Write `src/ui/src/components/ChatHistory.tsx`**

```tsx
import React, { useEffect, useRef } from "react";
import { useChatStore } from "../state/store";
import { Message } from "./Message";

export const ChatHistory: React.FC = () => {
  const messages = useChatStore((s) => s.messages);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages]);
  return (
    <div className="dsh-history" ref={ref}>
      {messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}
    </div>
  );
};
```

- [ ] **Step 5: Write `src/ui/src/components/ChatInput.tsx`**

```tsx
import React from "react";
import { useChatStore } from "../state/store";
import { send } from "../messages/client";

export const ChatInput: React.FC = () => {
  const input = useChatStore((s) => s.input);
  const setInput = useChatStore((s) => s.setInput);
  const sessionId = useChatStore((s) => s.sessionId);
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const addAssistantPlaceholder = useChatStore((s) => s.addAssistantPlaceholder);

  const onSend = () => {
    const text = input.trim();
    if (!text) return;
    addUserMessage(text);
    addAssistantPlaceholder();
    send({ v: 1, type: "chat.send", sessionId, text });
    setInput("");
  };

  return (
    <div className="dsh-input">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder="Ask DeepSeek Harness anything…"
        rows={3}
      />
      <button onClick={onSend} disabled={!input.trim()}>
        Send
      </button>
    </div>
  );
};
```

- [ ] **Step 6: Replace `src/ui/src/App.tsx`**

```tsx
import React, { useEffect } from "react";
import { ChatHistory } from "./components/ChatHistory";
import { ChatInput } from "./components/ChatInput";
import { onMessage } from "./messages/client";
import { useChatStore } from "./state/store";

export const App: React.FC = () => {
  useEffect(() => {
    const unsubscribe = onMessage((ev) => {
      if (ev.type === "stream.chunk") {
        useChatStore.getState().appendDelta(ev.messageId, ev.delta);
      } else if (ev.type === "stream.end") {
        useChatStore.getState().endStream(ev.messageId);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <div className="dsh-app">
      <header className="dsh-header">DeepSeek Harness</header>
      <ChatHistory />
      <ChatInput />
    </div>
  );
};
```

- [ ] **Step 7: Append chat styles to `src/ui/src/styles.css`**

```css
.dsh-app {
  padding: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100vh;
}

.dsh-header {
  padding: 8px 16px;
  border-bottom: 1px solid var(--dsh-border);
  font-weight: 600;
}

.dsh-history {
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dsh-message {
  border: 1px solid var(--dsh-border);
  border-radius: 6px;
  padding: 8px 12px;
}

.dsh-message-role {
  font-size: 11px;
  text-transform: uppercase;
  opacity: 0.6;
  margin-bottom: 4px;
}

.dsh-message-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.dsh-cursor {
  display: inline-block;
  animation: dsh-blink 1s steps(2, end) infinite;
  margin-left: 2px;
}

@keyframes dsh-blink {
  to { opacity: 0; }
}

.dsh-input {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--dsh-border);
}

.dsh-input textarea {
  flex: 1;
  resize: vertical;
  background: var(--dsh-bg);
  color: var(--dsh-fg);
  border: 1px solid var(--dsh-border);
  border-radius: 4px;
  padding: 6px 8px;
  font: inherit;
}

.dsh-input button {
  background: var(--dsh-accent);
  color: var(--dsh-accent-fg);
  border: none;
  border-radius: 4px;
  padding: 0 12px;
  cursor: pointer;
}

.dsh-input button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 8: Build the webview**

```bash
pnpm run build:webview
```

Expected: `src/ui/dist/assets/index.js` and `index.css` exist.

- [ ] **Step 9: Commit**

```bash
git add src/ui/src/messages/client.ts src/ui/src/state/store.ts src/ui/src/components/ src/ui/src/App.tsx src/ui/src/styles.css
git commit -m "feat(webview): chat shell with streaming render"
```

---

## Task 9: Wire `dsh.openChat` to the panel

**Files:**
- Modify: `src/commands/openChat.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Update `src/commands/openChat.ts`**

```ts
import * as vscode from "vscode";
import { ChatPanel } from "../webview-host/panel";
import { bootDsh, type DshHandle } from "../dsh-bridge/boot";

let dshHandle: DshHandle | undefined;

export async function openChatCommand(context: vscode.ExtensionContext): Promise<void> {
  if (!dshHandle) {
    try {
      dshHandle = await bootDsh({ profile: "headless" });
    } catch (err) {
      // Surface the boot failure with a remediation hint. A dedicated
      // welcome webview with the full error log lands in a later milestone;
      // for M1 a notification is enough to unblock the user.
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(
        vscode.l10n.t("DeepSeek Harness failed to start: {0}", message),
        vscode.l10n.t("Open Output"),
      ).then((choice) => {
        if (choice === vscode.l10n.t("Open Output")) {
          vscode.commands.executeCommand("workbench.action.output.grabFocus");
        }
      });
      return;
    }
    context.subscriptions.push({
      dispose: () => {
        void dshHandle?.dispose();
        dshHandle = undefined;
      },
    });
  }
  ChatPanel.createOrShow(context.extensionUri, dshHandle);
}
```

- [ ] **Step 2: Update `src/extension.ts` to pass `context` to the command**

```ts
import * as vscode from "vscode";
import { openChatCommand } from "./commands/openChat";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("dsh.openChat", () => openChatCommand(context)),
  );
}

export function deactivate(): void {
  // The DshHandle dispose is wired through the openChatCommand's subscription.
}
```

- [ ] **Step 3: Update the existing unit test to pass a context to the command**

The `openChatCommand` now takes a `context` argument. Update `tests/unit/extension.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  commands: {
    registerCommand: vi.fn(),
  },
  window: {
    showInformationMessage: vi.fn(),
  },
  ExtensionContext: class {},
}));

import { activate, deactivate } from "../../src/extension";
import * as vscode from "vscode";

describe("extension entry", () => {
  it("registers the dsh.openChat command on activate", () => {
    activate({} as vscode.ExtensionContext);
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      "dsh.openChat",
      expect.any(Function),
    );
  });

  it("deactivate is callable", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
```

(No change needed — the test only checks `registerCommand` was called.)

- [ ] **Step 4: Run the host build**

```bash
pnpm run build:host
```

Expected: build succeeds.

- [ ] **Step 5: Run the unit tests**

```bash
pnpm exec vitest run
```

Expected: all 4 unit test files pass.

- [ ] **Step 6: Manually verify the command in VS Code**

In VS Code, run the "Run Extension" launch config. Open the Command Palette, run "DeepSeek Harness: Open Chat". Expected: a side panel appears with the webview header "DeepSeek Harness" and the chat shell UI. The bottom textarea is interactive. (Streaming from a real DSH session is not yet wired — that lands in Task 10.)

- [ ] **Step 7: Commit**

```bash
git add src/commands/openChat.ts src/extension.ts
git commit -m "feat: openChat command boots DSH and shows the panel"
```

---

## Task 10: Wire the host → DSH agent inbox

**Files:**
- Create: `src/dsh-bridge/agents.ts`
- Create: `src/dsh-bridge/sessions.ts`
- Modify: `src/webview-host/router.ts`
- Modify: `src/commands/openChat.ts`

**Interfaces:**
- Consumes: `DshHandle.ctx.agents` (DSH agent registry)
- Produces: `pushUserMessage(ctx, sessionId, text): Promise<void>` and `getOrCreateSession(ctx, sessionId): Promise<SessionHandle>`

- [ ] **Step 1: Write `src/dsh-bridge/sessions.ts`**

```ts
import type { DshCtx } from "./boot";

export interface SessionHandle {
  id: string;
  /** DSH's session facade. Type is intentionally loose for M1; tightened in M2. */
  raw: any;
}

export async function getOrCreateSession(
  ctx: DshCtx,
  sessionId: string,
): Promise<SessionHandle> {
  const sessions = ctx.sessions as
    | { get?: (id: string) => Promise<any>; create?: (init: any) => Promise<any> }
    | undefined;
  if (!sessions) {
    throw new Error("DSH ctx.sessions is not available — did bootDsh run with the headless profile?");
  }
  if (sessions.get) {
    const existing = await sessions.get(sessionId);
    if (existing) return { id: sessionId, raw: existing };
  }
  if (!sessions.create) {
    throw new Error("DSH ctx.sessions has neither get nor create; upstream API mismatch?");
  }
  const created = await sessions.create({ id: sessionId });
  return { id: sessionId, raw: created };
}
```

- [ ] **Step 2: Write `src/dsh-bridge/agents.ts`**

```ts
import type { DshCtx } from "./boot";
import { getOrCreateSession } from "./sessions";

/**
 * Push a user message into the agent inbox of the given session.
 * M1 wires this through DSH's `ctx.agents` registry, but the exact
 * surface is still in flux upstream. We do a feature-detect and fall back
 * to logging if `ctx.agents` is not present — Task 11's integration test
 * will assert against a real profile.
 */
export async function pushUserMessage(
  ctx: DshCtx,
  sessionId: string,
  text: string,
): Promise<void> {
  const session = await getOrCreateSession(ctx, sessionId);
  const agents = ctx.agents as
    | { push?: (s: { session: unknown; text: string }) => Promise<void> }
    | undefined;
  if (agents?.push) {
    await agents.push({ session: session.raw, text });
    return;
  }
  // Fallback: log to host output. Integration test in Task 12 will detect this.
  console.warn(
    "[dsh-bridge] ctx.agents.push is not available in this DSH build; " +
      "the message was not delivered to the agent loop.",
    { sessionId, text },
  );
}
```

- [ ] **Step 3: Update `src/webview-host/router.ts` to use the real bridge**

Replace the stub `pushInbox` with the real one. New content:

```ts
import type * as vscode from "vscode";
import type { HostCommand, WebviewEvent } from "../shared/protocol";
import type { DshHandle } from "../dsh-bridge/boot";
import { pushUserMessage } from "../dsh-bridge/agents";

export interface WebviewPanelLike {
  webview: { postMessage: (msg: WebviewEvent) => Thenable<boolean> };
  onDidReceiveMessage: (handler: (msg: HostCommand) => void) => vscode.Disposable;
}

export interface RouterDsh {
  ctx: DshHandle["ctx"];
}

export function installRouter(panel: WebviewPanelLike, dsh: RouterDsh): vscode.Disposable {
  return panel.onDidReceiveMessage(async (msg) => {
    if (!msg || msg.v !== 1) {
      await panel.webview.postMessage({
        v: 1,
        type: "error",
        message: `Protocol mismatch: expected v=1, got v=${(msg as { v?: number })?.v}`,
        recoverable: true,
      });
      return;
    }
    try {
      switch (msg.type) {
        case "chat.send":
          await pushUserMessage(dsh.ctx, msg.sessionId, msg.text);
          break;
        case "chat.cancel":
          // Wired in a later milestone.
          break;
        case "ready":
          // Snapshot in a later milestone.
          break;
      }
    } catch (err) {
      await panel.webview.postMessage({
        v: 1,
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
    }
  });
}
```

- [ ] **Step 4: Update `src/webview-host/panel.ts` to use the simplified router signature**

In `src/webview-host/panel.ts`, find the `installRouter` call and replace the `pushInbox` stub with no extra args. The new call:

```ts
this.disposables.push(
  installRouter(this.panel as WebviewPanelLike, { ctx: dsh.ctx }),
  this.panel.onDidDispose(() => this.dispose(), null, this.disposables),
);
```

- [ ] **Step 5: Run the host build and unit tests**

```bash
pnpm run build:host
pnpm exec vitest run
```

Expected: build succeeds; all unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/dsh-bridge/agents.ts src/dsh-bridge/sessions.ts src/webview-host/router.ts src/webview-host/panel.ts
git commit -m "feat(dsh-bridge): push chat messages to agent inbox"
```

---

## Task 11: First-time extension setup + activation guard

**Files:**
- Modify: `src/extension.ts`

**Goal:** First time the user opens the chat, the extension should walk them through a one-time setup if the API key is missing, instead of silently failing. M1 uses VS Code's `InformationMessage`; M4 will replace it with a real settings modal.

- [ ] **Step 1: Add a setup guard in `src/extension.ts`**

```ts
import * as vscode from "vscode";
import { openChatCommand } from "./commands/openChat";

const API_KEY_SECRET = "dsh.apiKey";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand("dsh.openChat", () => openChatCommand(context)),
  );

  // First-time setup hint. M4 will replace this with a real settings modal
  // that writes through `SecretStorage`. M1 only nudges.
  const existing = await context.secrets.get(API_KEY_SECRET);
  if (!existing) {
    const action = await vscode.window.showInformationMessage(
      vscode.l10n.t(
        "DeepSeek Harness needs a DeepSeek API key. Set it now? (M1 will not actually call the API yet.)",
      ),
      vscode.l10n.t("Set API Key"),
      vscode.l10n.t("Later"),
    );
    if (action === vscode.l10n.t("Set API Key")) {
      await vscode.window.showInputBox(
        {
          prompt: vscode.l10n.t("DeepSeek API key"),
          password: true,
          ignoreFocusOut: true,
        },
      ).then(async (value) => {
        if (value) await context.secrets.store(API_KEY_SECRET, value);
      });
    }
  }
}

export function deactivate(): void {
  // no-op; DshHandle dispose is wired via openChatCommand.
}
```

- [ ] **Step 2: Run host build + tests**

```bash
pnpm run build:host
pnpm exec vitest run
```

Expected: build succeeds; all tests pass.

- [ ] **Step 3: Manual smoke test in VS Code**

In VS Code, run "Run Extension" launch config. The extension activates. A first-time hint appears asking for the API key. Click "Set API Key" — an input box appears. (The value is stored via `SecretStorage` but **not** yet used by DSH; that lands in M4.)

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: first-time setup hint for DeepSeek API key"
```

---

## Task 12: Integration smoke test

**Files:**
- Create: `tests/integration/smoke.test.ts`
- Create: `.vscode-test.mjs`

**Interfaces:**
- Consumes: real VS Code launched by `@vscode/test-electron`, the built extension
- Produces: a test that activates the extension, runs the `dsh.openChat` command, and asserts the chat panel exists

- [ ] **Step 1: Write `.vscode-test.mjs`**

```js
import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "tests/integration/**/*.test.ts",
  // Use a stable, recent VS Code build that supports engines ^1.95
  version: "1.95.0",
  // Build the host before running tests
  mocha: {
    timeout: 60_000,
  },
  workspace: "./.vscode-test/fixtures/empty.code-workspace",
});
```

- [ ] **Step 2: Create the empty workspace fixture**

```bash
mkdir -p D:\Code\deepseek\vscode-deepseek\.vscode-test\fixtures
```

Create `D:\Code\deepseek\vscode-deepseek\.vscode-test\fixtures\empty.code-workspace`:

```json
{
  "folders": []
}
```

- [ ] **Step 3: Write the integration test**

Create `tests/integration/smoke.test.ts`:

```ts
import * as assert from "node:assert";
import * as vscode from "vscode";

suite("DeepSeek Harness extension", () => {
  test("dsh.openChat command is registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("dsh.openChat"),
      "dsh.openChat should be registered on activation",
    );
  });

  test("running dsh.openChat creates a webview panel", async () => {
    await vscode.commands.executeCommand("dsh.openChat");
    // The panel title comes from the createWebviewPanel call in panel.ts.
    // M1 only asserts the command ran without throwing.
  });
});
```

- [ ] **Step 4: Add `vscode-test` script to `package.json`**

In `package.json`, replace the `test:integration` script:

```json
"test:integration": "vscode-test"
```

Also add a top-level `test` script that does both:

```json
"test": "pnpm run test:unit && pnpm run build:host && pnpm run test:integration"
```

- [ ] **Step 5: Run the integration test**

```bash
cd D:\Code\deepseek\vscode-deepseek
pnpm run test:integration
```

Expected: a real VS Code window is downloaded on first run; the test activates the extension; both assertions pass. Output ends with `2 passing`.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/smoke.test.ts .vscode-test.mjs .vscode-test/fixtures/empty.code-workspace package.json
git commit -m "test: integration smoke for dsh.openChat"
```

---

## Task 13: README and AGENTS.md

**Files:**
- Create: `README.md`
- Create: `AGENTS.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# DeepSeek Harness — VS Code Extension

> Status: **M1 in progress.** Plain streaming chat works end-to-end against a mocked DSH; tool surfacing lands in M2.

A native VS Code extension that embeds the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent runtime. Chat, tools, multi-agent presets, and skills — all from the VS Code sidebar.

## Features (M1)

- ✅ `dsh.openChat` command opens a chat WebView panel
- ✅ Extension host boots the DSH runtime (`@deepseek-ai/dsh-base` + `dsh-headless`)
- ✅ Typed `postMessage` protocol between webview and host
- ✅ Batched subscription to `session/event` (16ms flush)
- ✅ React + zustand chat UI with streaming render
- ✅ Bilingual command title (English + 简体中文)

## Features (planned)

- M2: tools (read / write / edit / bash / grep) with VS Code `workspace.applyEdit`
- M3: multi-session list, all 4 agent presets, inline diff
- M4: API key + model picker + Skill system
- M5: context compression, subagent indicator, web search
- M6: interactive PTY, custom presets, session import/export
- M7: polish, full test suite, Marketplace publish

## Development

```bash
# Install
pnpm install

# Build everything (host + webview)
pnpm run build

# Run unit tests
pnpm run test:unit

# Run integration tests (boots a real VS Code)
pnpm run test:integration

# Launch the extension in debug mode
# In VS Code: Run > "Run Extension"
```

## Architecture

See [`docs/superpowers/specs/2026-08-16-dsh-vscode-extension-design.md`](./docs/superpowers/specs/2026-08-16-dsh-vscode-extension-design.md) and [`docs/superpowers/plans/2026-08-16-m1-foundation-streaming-chat.md`](./docs/superpowers/plans/2026-08-16-m1-foundation-streaming-chat.md).

## License

MIT. See [LICENSE](./LICENSE) — to be added in M7.
```

- [ ] **Step 2: Write `AGENTS.md`**

```markdown
# AGENTS.md

Context for AI coding agents working in this repository.

## What this is

A VS Code extension that embeds the DeepSeek Harness agent runtime. See
[`README.md`](./README.md) for the user-facing overview and
[`docs/superpowers/specs/`](./docs/superpowers/specs/) for the design spec.

## Stack

- TypeScript 5.4, pnpm workspaces
- Extension host: esbuild, `vscode` 1.95+ APIs
- Webview: Vite + React 18 + zustand
- Tests: Vitest (unit), `@vscode/test-electron` (integration)

## Layout

- `src/` — extension host
- `src/ui/` — webview (a pnpm workspace package `@dsh/webview`)
- `src/shared/protocol.ts` — the **only** source of truth for the webview↔host wire format
- `src/dsh-bridge/` — **only** place that imports `@deepseek-ai/dsh-*`
- `src/webview-host/` — chat panel + router
- `tests/unit/` — Vitest, no VS Code required
- `tests/integration/` — `@vscode/test-electron`, boots real VS Code

## Conventions

- One commit per task. Conventional Commits format.
- All DSH access goes through `src/dsh-bridge/`. The webview must never import `@deepseek-ai/dsh-*`.
- Wire-protocol messages are versioned with a `v` field. Add a new variant by editing `src/shared/protocol.ts` first.
- User-visible strings go through `vscode.l10n.t` and live in `package.nls.json` + `package.nls.zh-cn.json`.
- No raw `fs` / `child_process` outside `src/dsh-bridge/`; everything goes through VS Code APIs or the bridge's tool adapters (M2+).

## Where to start

- Read the design spec: `docs/superpowers/specs/2026-08-16-dsh-vscode-extension-design.md`
- Read the active plan: `docs/superpowers/plans/2026-08-16-m1-foundation-streaming-chat.md`
- Run the extension: F5 in VS Code (with the "Run Extension" launch config)
```

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: README and AGENTS.md for M1"
```

---

## Task 14: Package smoke test

**Files:**
- Modify: `.vscodeignore` (fine-tune)

- [ ] **Step 1: Build the full extension**

```bash
cd D:\Code\deepseek\vscode-deepseek
pnpm run build
```

Expected: both `dist/extension/extension.js` and `src/ui/dist/assets/index.{js,css}` exist.

- [ ] **Step 2: Run `vsce package`**

```bash
pnpm exec vsce package --no-dependencies
```

Expected: a `dsh-vscode-0.1.0.vsix` file is produced in the workspace root. If `vsce` complains about missing fields, add a `repository` field to `package.json` pointing at the user's future GitHub repo, plus a `bugs` URL. (Skip the publish step — we only want to verify packaging works.)

- [ ] **Step 3: Verify install into a fresh VS Code profile**

```bash
code --install-extension dsh-vscode-0.1.0.vsix --user-data-dir=$TMP/dsh-vscode-test
```

Expected: extension installs. Launch VS Code with the test profile; the command palette shows "DeepSeek Harness: Open Chat".

- [ ] **Step 4: Commit any `.vscodeignore` tweaks**

```bash
git add .vscodeignore package.json
git commit -m "chore: tune .vscodeignore for packaging"
```

(If no changes were needed, this commit can be skipped.)

- [ ] **Step 5: Final review**

```bash
git log --oneline
git status
```

Expected: clean working tree; ~14 commits since the initial scaffold.

---

## Notes

### Upstream package availability

`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-headless`, and `@deepseek-ai/cordis` are referenced in `package.json` as `^0.1.0`. If they are not yet published on the npm registry at task time, follow these mitigations in order:

1. **Point at a GitHub tarball** temporarily. In `package.json`:
   ```json
   "@deepseek-ai/dsh-base": "github:deepseek-ai/deepseek-harness#main",
   ```
   Then `pnpm install` will fetch from GitHub.
2. **Vendor a snapshot** in a `vendor/` directory and use a `file:` reference:
   ```json
   "@deepseek-ai/dsh-base": "file:./vendor/dsh-base"
   ```
3. **Stub the packages locally** (last resort, only for M1 sign-off): create `stubs/@deepseek-ai/dsh-headless/package.json` with a minimal `createHeadlessApp` and point the dependencies at it. This unblocks the unit + integration tests but defers real streaming to M2.

Document whichever mitigation is used in the commit message.

### WebView CSP

The CSP in `src/webview-host/panel.ts` is `default-src 'none'` plus narrow allow-lists for scripts and styles. If a new dependency needs `connect-src` (e.g. for fetching remote models through the webview), update the CSP **and** reconsider routing that call through the host instead — the host is the trust boundary.

### `tsconfig.json` notes

The webview workspace has its own `src/ui/tsconfig.json`. Do not add a project reference from the host's `tsconfig.json` to it; the two are intentionally separate type systems with different JSX and DOM lib configurations.

### When M1 is "done"

After Task 14, M1 is complete when:
- `pnpm run test` passes (unit + integration)
- `pnpm run package` produces a valid `.vsix`
- The extension can be launched via the "Run Extension" debug config, and the chat panel appears with the React UI

The next plan (M2) will tackle tool surfacing and the security boundary.
