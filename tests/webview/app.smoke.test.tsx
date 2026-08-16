/**
 * Whole-app smoke test for the chat webview.
 *
 * Renders the real `App` under jsdom with a stubbed `acquireVsCodeApi`,
 * then drives it through the exact host events the extension sends:
 * `model.catalog` (what makes the ModelBar appear), an assistant
 * message with Markdown, a tool call + result, and an `ask_user`
 * question. Any render-time crash (bad import, broken component) fails
 * here instead of shipping a blank sidebar.
 */
import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
// React 18: `act` lives here (the `react` package export is React 19+).
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import type { WebviewEvent } from "../../src/shared/protocol";

// client.ts calls acquireVsCodeApi() at module scope; stub it before
// any webview module is imported.
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
  postMessage: () => {},
  getState: () => undefined,
  setState: () => {},
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom doesn't implement element scrollTo; ChatHistory auto-scrolls
// on new messages. Stub it (real webviews have it).
Element.prototype.scrollTo = () => {};

async function renderApp() {
  const { App } = await import("../../src/ui/src/App");
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(App));
  });
  return { container, root: root! };
}

/** Dispatch a host event through the same window "message" channel the
 *  real webview uses. */
async function emit(ev: WebviewEvent) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data: ev }));
  });
}

describe("webview app smoke", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    // The zustand store is a module singleton shared across tests in
    // this file; reset it so messages don't leak between cases.
    const { useChatStore } = await import("../../src/ui/src/state/store");
    useChatStore.getState().newSession();
  });

  it("shows the model bar once model.catalog arrives", async () => {
    const { container } = await renderApp();
    expect(container.querySelector(".dsh-modelbar")).toBeNull();

    await emit({
      v: 1,
      type: "model.catalog",
      providers: [
        {
          id: "deepseek-official",
          name: "DeepSeek",
          models: [{ id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" }],
        },
      ],
      current: { provider: "deepseek-official", model: "deepseek-v4-flash" },
      contextWindow: 1000000,
      efforts: [{ id: "high", name: "High" }],
      hasCredential: true,
    });

    expect(container.querySelector(".dsh-modelbar")).not.toBeNull();
    expect(container.querySelector(".dsh-effort-select")).not.toBeNull();
    expect(container.textContent).toContain("Key ✓");

    // Context meter appears after the first usage report.
    await emit({
      v: 1,
      type: "stream.chunk",
      sessionId: "s",
      messageId: "step-1-1",
      delta: "hello",
    });
    await emit({
      v: 1,
      type: "message.usage",
      sessionId: "s",
      messageId: "step-1-1",
      usage: { inputTokens: 10200, outputTokens: 100 },
    });
    expect(container.textContent).toContain("10.2k / 1000.0k");
  });

  it("renders assistant markdown and a tool call lifecycle", async () => {
    const { container } = await renderApp();
    await emit({
      v: 1,
      type: "stream.chunk",
      sessionId: "s",
      messageId: "step-1-1",
      delta: "# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```",
    });
    await emit({
      v: 1,
      type: "tool.call",
      sessionId: "s",
      messageId: "step-1-1",
      callId: "c1",
      name: "read_file",
      arguments: '{"path":"a.ts"}',
    });
    expect(container.querySelector(".dsh-tool-running")).not.toBeNull();
    await emit({
      v: 1,
      type: "tool.result",
      sessionId: "s",
      messageId: "step-1-1",
      callId: "c1",
      ok: true,
      content: "file body",
    });
    expect(container.querySelector(".dsh-tool-ok")).not.toBeNull();

    // Markdown actually rendered: heading, table, fenced code.
    expect(container.querySelector(".dsh-markdown h1")?.textContent).toBe("Title");
    expect(container.querySelector(".dsh-markdown table")).not.toBeNull();
    expect(container.querySelector(".dsh-markdown pre code")).not.toBeNull();
  });

  it("shows the plugin panel from plugin.catalog", async () => {
    const { container } = await renderApp();
    await emit({
      v: 1,
      type: "plugin.catalog",
      plugins: [
        { id: "demo.js", path: "/plugins/demo.js", status: "loaded" },
        { id: "bad.js", path: "/plugins/bad.js", status: "error", error: "boom" },
      ],
    });
    // Open the panel via the header toggle.
    const toggle = container.querySelector('button[aria-label="Plugins"]') as HTMLButtonElement;
    await act(async () => {
      toggle.click();
    });
    const rows = container.querySelectorAll(".dsh-plugin-row");
    expect(rows.length).toBe(2);
    expect(container.querySelector(".dsh-plugin-loaded")).not.toBeNull();
    expect(container.querySelector(".dsh-plugin-error")).not.toBeNull();
    expect(container.textContent).toContain("demo.js");
  });

  it("shows the ask_user question card and sends the answer", async () => {
    const { container } = await renderApp();
    await emit({
      v: 1,
      type: "question.request",
      sessionId: "s",
      questionId: "q-1",
      question: "Which environment?",
      options: ["staging", "prod"],
    });
    const card = container.querySelector(".dsh-question");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Which environment?");
    const buttons = card!.querySelectorAll(".dsh-question-option");
    expect(buttons.length).toBe(2);

    await act(async () => {
      (buttons[1] as HTMLButtonElement).click();
    });
    expect(container.querySelector(".dsh-question")).toBeNull();
  });
});
