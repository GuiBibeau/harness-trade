// Arrow keys step numeric ticket inputs (Shift = ×10), clamped at zero.
// Price fields step by the formatBookPrice magnitude rule and re-format
// via fmtTriggerPrice so the string stays Number()-parseable; USD fields
// step $5. Writes back through a real input event so bind:value (and any
// oninput side effect, e.g. scheduleSpotQuote) fires.
//
// Shared Svelte action for TicketForm/SpotTicketForm (both venues step the
// same way); pure DOM + math, no page state.
import { fmtTriggerPrice } from "./trade-math";

export type StepInputKind = "usd" | "price";

export function stepInput(
  node: HTMLInputElement,
  params: { kind: StepInputKind },
): { update: (next: { kind: StepInputKind }) => void; destroy: () => void } {
  let kind = params.kind;
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const current = Number(node.value);
    const base = Number.isFinite(current) && current > 0 ? current : 0;
    const unit =
      kind === "usd" ? 5 : base >= 1_000 ? 1 : base >= 1 ? 0.01 : 0.0001;
    const delta =
      unit * (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
    const next = Math.max(0, base + delta);
    node.value =
      kind === "price"
        ? fmtTriggerPrice(next)
        : String(Number(next.toFixed(2)));
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }
  node.addEventListener("keydown", onKeydown);
  return {
    update(next: { kind: StepInputKind }) {
      kind = next.kind;
    },
    destroy() {
      node.removeEventListener("keydown", onKeydown);
    },
  };
}
