import type { ApprovalContext, ToolContext } from "eve/tools";

export type AgentMode = "observe" | "ask" | "auto";
export type AccountMode = "paper" | "live";

export type AgentPrincipal = {
  userId: string;
  agentMode: AgentMode;
  accountMode: AccountMode;
  paused: boolean;
};

type EveContext = ToolContext | ApprovalContext<unknown>;

function attributes(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function parseMode(value: unknown): AgentMode {
  return value === "observe" || value === "auto" ? value : "ask";
}

/** Exported for unit tests — live requires the server-stamped liveAccess flag. */
export function parseAccountMode(
  value: unknown,
  liveAccess: unknown,
): AccountMode {
  if (value !== "live") return "paper";
  // Defense in depth: even if a stale attribute says live, require the
  // server-stamped liveAccess flag from Eve auth.
  return liveAccess === true || liveAccess === "true" ? "live" : "paper";
}

export function requireAgentPrincipal(ctx: EveContext): AgentPrincipal {
  const current = ctx.session.auth.current;
  const initiator = ctx.session.auth.initiator;
  if (
    !current ||
    !initiator ||
    current.principalType !== "user" ||
    initiator.principalType !== "user" ||
    current.principalId !== initiator.principalId
  ) {
    throw new Error("agent-session-owner-mismatch");
  }
  const attrs = attributes(current.attributes);
  return {
    userId: current.principalId,
    agentMode: parseMode(attrs.agentMode),
    accountMode: parseAccountMode(attrs.accountMode, attrs.liveAccess),
    paused: attrs.paused === true || attrs.paused === "true",
  };
}

export function decideTransactionApproval(
  principal: AgentPrincipal,
):
  | { type: "denied"; reason: string }
  | { type: "approved"; reason: string }
  | "user-approval" {
  if (principal.paused) {
    return { type: "denied", reason: "Money-PAUSE is engaged." };
  }
  if (principal.agentMode === "observe") {
    return { type: "denied", reason: "Observe mode is read-only." };
  }
  if (principal.agentMode === "ask") return "user-approval";
  if (principal.accountMode === "paper") {
    return {
      type: "approved",
      reason: "Auto mode permits paper execution.",
    };
  }
  // Live money always requires an explicit approval — Auto never silently
  // signs/broadcasts against the server-custody wallet.
  return "user-approval";
}

export function transactionApproval(
  ctx: ApprovalContext<Record<string, unknown>>,
) {
  let principal: AgentPrincipal;
  try {
    principal = requireAgentPrincipal(ctx);
  } catch {
    return { type: "denied" as const, reason: "Session owner mismatch." };
  }
  return decideTransactionApproval(principal);
}
