import { describe, it, expect, vi } from "vitest";

// Mock the `vscode` module before importing the SUT
vi.mock("vscode", () => ({
  commands: {
    registerCommand: vi.fn(),
  },
  window: {
    showInformationMessage: vi.fn(),
    registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  ExtensionContext: class {},
}));

import { activate, deactivate } from "../../src/extension";
import * as vscode from "vscode";

describe("extension entry", () => {
  it("registers the dsh.openChat command on activate", () => {
    activate({ subscriptions: [] } as unknown as vscode.ExtensionContext);
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      "dsh.openChat",
      expect.any(Function),
    );
  });

  it("registers the sidebar chat view provider on activate", () => {
    activate({ subscriptions: [] } as unknown as vscode.ExtensionContext);
    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
      "dsh.chatView",
      expect.anything(),
      // Keeps the webview DOM (chat state) alive across sidebar hides.
      { webviewOptions: { retainContextWhenHidden: true } },
    );
  });

  it("deactivate is callable", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
