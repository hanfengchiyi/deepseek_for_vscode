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
    activate({ subscriptions: [] } as vscode.ExtensionContext);
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      "dsh.openChat",
      expect.any(Function),
    );
  });

  it("deactivate is callable", () => {
    expect(() => deactivate()).not.toThrow();
  });
});
