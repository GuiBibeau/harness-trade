import type { AgentMode } from "./modes";

export type AgentCommand =
  | { name: "new" | "threads" | "settings" }
  | { name: "mode"; mode: AgentMode }
  | { name: "paused"; paused: boolean };

export function parseAgentCommand(value: string): AgentCommand | null {
  switch (value.trim().toLowerCase()) {
    case "/new":
      return { name: "new" };
    case "/threads":
      return { name: "threads" };
    case "/settings":
      return { name: "settings" };
    case "/observe":
      return { name: "mode", mode: "observe" };
    case "/ask":
      return { name: "mode", mode: "ask" };
    case "/auto":
      return { name: "mode", mode: "auto" };
    case "/pause":
      return { name: "paused", paused: true };
    case "/resume":
      return { name: "paused", paused: false };
    default:
      return null;
  }
}
