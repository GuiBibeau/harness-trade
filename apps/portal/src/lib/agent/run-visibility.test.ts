import { describe, expect, test } from "bun:test";
import { backgroundRunMode } from "./run-visibility";

describe("background agent run visibility", () => {
  test("surfaces a LIVE run after the terminal switches to PAPER", () => {
    expect(
      backgroundRunMode("paper", {
        live: true,
        paper: false,
      }),
    ).toBe("live");
  });

  test("surfaces a PAPER run after the terminal switches to LIVE", () => {
    expect(
      backgroundRunMode("live", {
        live: false,
        paper: true,
      }),
    ).toBe("paper");
  });

  test("does not duplicate the active workspace status", () => {
    expect(
      backgroundRunMode("paper", {
        live: false,
        paper: true,
      }),
    ).toBeNull();
  });
});
