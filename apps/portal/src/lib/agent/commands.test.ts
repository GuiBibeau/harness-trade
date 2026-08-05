import { describe, expect, test } from "bun:test";
import { parseAgentCommand } from "./commands";

describe("agent commands", () => {
  test("recognizes exact workspace commands without swallowing normal prompts", () => {
    expect(parseAgentCommand(" /new ")).toEqual({ name: "new" });
    expect(parseAgentCommand("/auto")).toEqual({ name: "mode", mode: "auto" });
    expect(parseAgentCommand("/pause")).toEqual({ name: "paused", paused: true });
    expect(parseAgentCommand("/new position on SOL")).toBeNull();
    expect(parseAgentCommand("explain /auto mode")).toBeNull();
  });
});
