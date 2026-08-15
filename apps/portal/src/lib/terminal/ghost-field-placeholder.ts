/**
 * When a ghost suggestion paints inside an empty ticket field, the native
 * placeholder must be blank — otherwise "optional" (or similar) stacks on
 * top of the ghost and both look mixed together.
 */
export function ghostFieldPlaceholder(input: {
  hasGhost: boolean;
  emptyLabel: string;
}): string {
  return input.hasGhost ? "" : input.emptyLabel;
}
