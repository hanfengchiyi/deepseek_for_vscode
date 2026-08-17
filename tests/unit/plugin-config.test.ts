/**
 * Tests for the runtime-plugin enable/disable config
 * (`src/dsh-bridge/plugin-config.ts`). Each case works in a fresh temp
 * DSH_HOME; the config file only exists after the first toggle.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  RUNTIME_PLUGINS,
  listRuntimePlugins,
  readDisabledPlugins,
  setPluginEnabled,
} from "../../src/dsh-bridge/plugin-config";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-plugincfg-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("readDisabledPlugins", () => {
  it("returns an empty set when no config file exists", async () => {
    expect([...(await readDisabledPlugins(home))]).toEqual([]);
  });

  it("returns an empty set for a malformed config file", async () => {
    fs.writeFileSync(path.join(home, "vscode-extension.json"), "not json");
    expect([...(await readDisabledPlugins(home))]).toEqual([]);
  });
});

describe("setPluginEnabled", () => {
  it("persists a disable and re-enables cleanly", async () => {
    await setPluginEnabled(home, "ask-user", false);
    expect([...(await readDisabledPlugins(home))]).toEqual(["ask-user"]);

    await setPluginEnabled(home, "ask-user", true);
    expect([...(await readDisabledPlugins(home))]).toEqual([]);
  });

  it("rejects disabling a required plugin", async () => {
    await expect(setPluginEnabled(home, "llm", false)).rejects.toThrow("required");
  });

  it("rejects unknown plugin ids", async () => {
    await expect(setPluginEnabled(home, "nope", false)).rejects.toThrow("unknown runtime plugin");
  });
});

describe("listRuntimePlugins", () => {
  it("lists the full runtime set with enabled state", async () => {
    await setPluginEnabled(home, "workspace", false);
    const list = await listRuntimePlugins(home);
    expect(list.length).toBe(RUNTIME_PLUGINS.length);
    expect(list.find((p) => p.id === "workspace")?.enabled).toBe(false);
    expect(list.find((p) => p.id === "llm")?.enabled).toBe(true);
    // Required plugins always read enabled even if the config lies.
    await setPluginEnabled(home, "workspace", true);
  });
});
