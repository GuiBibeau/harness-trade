export type AgentAccountMode = "live" | "paper";

export type AgentRunStatus = {
  active: boolean;
  canCancel: boolean;
  label: string;
  stopping: boolean;
  cancel: () => void;
};

export function backgroundRunMode(
  activeMode: AgentAccountMode,
  running: Readonly<Record<AgentAccountMode, boolean>>,
): AgentAccountMode | null {
  const inactiveMode = activeMode === "paper" ? "live" : "paper";
  return running[inactiveMode] ? inactiveMode : null;
}

export function idleAgentRunStatus(): AgentRunStatus {
  return {
    active: false,
    canCancel: false,
    label: "Ready",
    stopping: false,
    cancel: () => undefined,
  };
}
