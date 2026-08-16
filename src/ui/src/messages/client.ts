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
