import type { ExecutionResult, InternalSessionStatus, ReviewSession } from "../action/types.js";

export const EXECUTION_POLLING_INTERVAL_SECONDS = 3;

export type ExecutionPollingStatus =
  | "pending"
  | "awaiting_wallet"
  | "awaiting_signature"
  | "refresh_required"
  | "blocked"
  | "signed_pending_result"
  | "success"
  | "failure"
  | "expired";

export const EXECUTION_STATUS_CATEGORIES = [
  "final",
  "user_action_required",
  "awaiting_chain_result",
  "non_terminal"
] as const;

export type ExecutionStatusCategory = (typeof EXECUTION_STATUS_CATEGORIES)[number];

export function isFinalSessionStatus(status: InternalSessionStatus): boolean {
  return status === "success" || status === "failure" || status === "expired";
}

export function executionPollingHint() {
  return {
    nonTerminalStatuses: [
      "pending",
      "awaiting_wallet",
      "awaiting_signature",
      "signed_pending_result"
    ] as ExecutionPollingStatus[],
    waitStoppingStatuses: ["success", "failure", "refresh_required", "blocked", "expired"] as ExecutionPollingStatus[],
    finalStatuses: ["success", "failure", "expired"] as ExecutionPollingStatus[],
    userActionRequiredStatuses: ["refresh_required", "blocked"] as ExecutionPollingStatus[],
    recommendedIntervalSeconds: EXECUTION_POLLING_INTERVAL_SECONDS
  };
}

export function executionStatusCategory(status: ExecutionPollingStatus): ExecutionStatusCategory {
  switch (status) {
    case "success":
    case "failure":
    case "expired":
      return "final";
    case "blocked":
    case "refresh_required":
      return "user_action_required";
    case "signed_pending_result":
      return "awaiting_chain_result";
    case "pending":
    case "awaiting_wallet":
    case "awaiting_signature":
      return "non_terminal";
    default:
      return assertNever(status);
  }
}

export function isWaitStoppingExecutionStatus(status: ExecutionPollingStatus): boolean {
  const category = executionStatusCategory(status);
  return category === "final" || category === "user_action_required";
}

export function isInteractionPendingReviewStatus(status: ExecutionPollingStatus): boolean {
  const category = executionStatusCategory(status);
  return category !== "final";
}

export function getExecutionPollingStatus(session: ReviewSession): ExecutionPollingStatus {
  if (session.status === "expired") {
    return "expired";
  }

  if (session.executionResult) {
    return executionResultStatus(session.executionResult);
  }

  switch (session.status) {
    case "proposed":
      return "pending";
    case "awaiting_wallet":
      return "awaiting_wallet";
    case "wallet_connected":
    case "ready_for_wallet_review":
      return "awaiting_signature";
    case "refresh_required":
      return "refresh_required";
    case "blocked":
      return "blocked";
    case "signed_pending_result":
      return "signed_pending_result";
    case "success":
      return "success";
    case "failure":
      return "failure";
    default:
      return assertNever(session.status);
  }
}

function executionResultStatus(result: ExecutionResult): ExecutionPollingStatus {
  return result.status;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled session status: ${String(value)}`);
}
