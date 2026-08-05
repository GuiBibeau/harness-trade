import { describe, expect, test } from "bun:test";
import { isNearAgentTail } from "./scroll-policy";

describe("agent scroll policy", () => {
  test("sticks to streaming output while the reader is near the tail", () => {
    expect(
      isNearAgentTail({
        scrollHeight: 1_000,
        clientHeight: 500,
        scrollTop: 430,
      }),
    ).toBe(true);
  });

  test("preserves the reader's position when they scroll into history", () => {
    expect(
      isNearAgentTail({
        scrollHeight: 1_000,
        clientHeight: 500,
        scrollTop: 180,
      }),
    ).toBe(false);
  });
});
