import { describe, it, expect } from "vitest";
import { isBridgeHook, BRIDGE_HOOK_MARKER } from "../src/bridge-command.js";

describe("isBridgeHook", () => {
  it("matches hooks with the bridge marker", () => {
    expect(
      isBridgeHook({
        type: "command",
        command: `/usr/local/bin/brv-claude-plugin ingest ${BRIDGE_HOOK_MARKER}`,
      }),
    ).toBe(true);
  });

  it("matches dev-mode hooks with the bridge marker", () => {
    expect(
      isBridgeHook({
        type: "command",
        command: `node /tmp/bridge/dist/cli.js sync ${BRIDGE_HOOK_MARKER}`,
      }),
    ).toBe(true);
  });

  it("rejects hooks without the marker", () => {
    expect(
      isBridgeHook({
        type: "command",
        command: "some-other-hook --flag",
      }),
    ).toBe(false);
  });

  it("rejects hooks with no command field", () => {
    expect(isBridgeHook({ type: "prompt", prompt: "check something" })).toBe(
      false,
    );
  });

  it("rejects hooks with non-string command", () => {
    expect(isBridgeHook({ command: 42 })).toBe(false);
  });
});
