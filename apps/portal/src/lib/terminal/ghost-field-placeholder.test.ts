import { describe, expect, test } from "bun:test";
import { ghostFieldPlaceholder } from "./ghost-field-placeholder";

describe("ghostFieldPlaceholder", () => {
  test("clears the label while a ghost is showing", () => {
    expect(
      ghostFieldPlaceholder({ hasGhost: true, emptyLabel: "optional" }),
    ).toBe("");
    expect(
      ghostFieldPlaceholder({ hasGhost: true, emptyLabel: "required" }),
    ).toBe("");
  });

  test("keeps the empty-field label when there is no ghost", () => {
    expect(
      ghostFieldPlaceholder({ hasGhost: false, emptyLabel: "optional" }),
    ).toBe("optional");
    expect(
      ghostFieldPlaceholder({ hasGhost: false, emptyLabel: "required" }),
    ).toBe("required");
  });
});
