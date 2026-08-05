export type TurnCancellationState =
  | "idle"
  | "requested"
  | "cancelling"
  | "error";

export type TurnCancellationSnapshot = {
  state: TurnCancellationState;
  turnId?: string;
  error?: string;
};

export type TurnCancellationEvent = {
  type: string;
  data?: unknown;
};

export function createTurnCancellation(options: {
  cancel: (turnId: string) => Promise<unknown>;
  onChange?: (snapshot: TurnCancellationSnapshot) => void;
}) {
  let requested = false;
  let turnId: string | undefined;
  let sentTurnId: string | undefined;
  let state: TurnCancellationState = "idle";
  let error: string | undefined;
  let pending: Promise<void> | null = null;

  function snapshot(): TurnCancellationSnapshot {
    return {
      state,
      ...(turnId ? { turnId } : {}),
      ...(error ? { error } : {}),
    };
  }

  function emit(): void {
    options.onChange?.(snapshot());
  }

  function dispatch(): void {
    if (!requested || !turnId || sentTurnId === turnId) return;
    sentTurnId = turnId;
    state = "cancelling";
    emit();
    pending = options.cancel(turnId).then(
      () => undefined,
      (cause: unknown) => {
        requested = false;
        sentTurnId = undefined;
        state = "error";
        error =
          cause instanceof Error ? cause.message : "Unable to stop this run.";
        emit();
      },
    );
  }

  function observe(event: TurnCancellationEvent): void {
    const eventTurnId =
      typeof event.data === "object" &&
      event.data !== null &&
      "turnId" in event.data &&
      typeof event.data.turnId === "string"
        ? event.data.turnId
        : undefined;
    if (event.type === "turn.started" && eventTurnId) {
      turnId = eventTurnId;
      dispatch();
      return;
    }
    if (
      event.type === "turn.cancelled" ||
      event.type === "turn.completed" ||
      event.type === "turn.failed"
    ) {
      reset();
    }
  }

  function request(): void {
    if (state === "requested" || state === "cancelling") return;
    requested = true;
    error = undefined;
    state = "requested";
    emit();
    dispatch();
  }

  function reset(): void {
    requested = false;
    turnId = undefined;
    sentTurnId = undefined;
    state = "idle";
    error = undefined;
    pending = null;
    emit();
  }

  return {
    observe,
    request,
    reset,
    settled: () => pending ?? Promise.resolve(),
    snapshot,
  };
}
