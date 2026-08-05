export function isNearAgentTail(input: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  threshold?: number;
}): boolean {
  const remaining = input.scrollHeight - input.clientHeight - input.scrollTop;
  return remaining <= (input.threshold ?? 96);
}
