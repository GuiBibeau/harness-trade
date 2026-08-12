/**
 * Out-of-order protection for market switches: a late REST/WS payload for
 * market A must not paint after the UI has moved to B.
 */
export function isCurrentMarketGeneration(input: {
  seq: number;
  currentSeq: number;
  expectedSymbol: string;
  selectedSymbol: string;
}): boolean {
  return (
    input.seq === input.currentSeq &&
    input.expectedSymbol === input.selectedSymbol
  );
}
