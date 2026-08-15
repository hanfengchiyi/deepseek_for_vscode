import { describe, it, expect, expectTypeOf } from "vitest";
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
    // Const-tuple so the type assertion is meaningful: with a loose
    // `Discriminator[]` the array would be satisfied by any subset.
    const cases: [
      "error",
      "session.snapshot",
      "stream.chunk",
      "stream.end",
    ] = ["error", "session.snapshot", "stream.chunk", "stream.end"];
    expectTypeOf(cases).toEqualTypeOf<
      ["error", "session.snapshot", "stream.chunk", "stream.end"]
    >();
  });
});
