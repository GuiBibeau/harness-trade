import { describe, expect, test } from "bun:test";
import { defaultFillSoundsEnabled, prefersReducedMotion } from "./fill-sounds";

describe("fill sound defaults", () => {
  test("without window.matchMedia, reduced-motion is false and sounds default on", () => {
    expect(prefersReducedMotion()).toBe(false);
    expect(defaultFillSoundsEnabled()).toBe(true);
  });
});
