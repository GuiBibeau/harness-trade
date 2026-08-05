import { describe, expect, test } from "bun:test";
import { createTurnCancellation } from "./turn-cancellation";

describe("turn cancellation", () => {
  test("queues an early Stop request and cancels once the turn id arrives", async () => {
    const calls: string[] = [];
    const states: string[] = [];
    const cancellation = createTurnCancellation({
      cancel: async (turnId) => {
        calls.push(turnId);
      },
      onChange: (snapshot) => states.push(snapshot.state),
    });

    cancellation.request();
    expect(cancellation.snapshot()).toMatchObject({ state: "requested" });
    expect(calls).toEqual([]);

    cancellation.observe({
      type: "turn.started",
      data: { turnId: "turn-42" },
    });
    await cancellation.settled();
    cancellation.observe({
      type: "turn.started",
      data: { turnId: "turn-42" },
    });

    expect(calls).toEqual(["turn-42"]);
    expect(states).toEqual(["requested", "cancelling"]);
    expect(cancellation.snapshot()).toMatchObject({
      state: "cancelling",
      turnId: "turn-42",
    });
  });

  test("returns to idle when the durable turn settles", async () => {
    const states: string[] = [];
    const cancellation = createTurnCancellation({
      cancel: async () => undefined,
      onChange: (snapshot) => states.push(snapshot.state),
    });

    cancellation.observe({
      type: "turn.started",
      data: { turnId: "turn-7" },
    });
    cancellation.request();
    await cancellation.settled();
    cancellation.observe({ type: "turn.cancelled" });

    expect(states).toEqual(["requested", "cancelling", "idle"]);
    expect(cancellation.snapshot()).toEqual({ state: "idle" });
  });
});
