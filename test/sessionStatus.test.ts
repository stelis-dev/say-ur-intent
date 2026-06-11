import { describe, expect, it } from "vitest";
import type { ReviewSession } from "../src/core/action/types.js";
import {
  EXECUTION_POLLING_INTERVAL_SECONDS,
  executionPollingHint,
  executionStatusCategory,
  getExecutionPollingStatus,
  isFinalSessionStatus,
  isInteractionPendingReviewStatus,
  isWaitStoppingExecutionStatus
} from "../src/core/session/status.js";

const baseSession: ReviewSession = {
  id: "session_1",
  tokenHash: "hash",
  status: "proposed",
  plans: [],
  createdAt: new Date(0).toISOString(),
  expiresAt: new Date(1000).toISOString(),
  lastActivityAt: new Date(0).toISOString()
};

describe("execution polling status", () => {
  it("maps internal session states to public polling states", () => {
    expect(getExecutionPollingStatus({ ...baseSession, status: "proposed" })).toBe("pending");
    expect(getExecutionPollingStatus({ ...baseSession, status: "awaiting_wallet" })).toBe(
      "awaiting_wallet"
    );
    expect(getExecutionPollingStatus({ ...baseSession, status: "wallet_connected" })).toBe(
      "awaiting_signature"
    );
    expect(getExecutionPollingStatus({ ...baseSession, status: "ready_for_wallet_review" })).toBe(
      "awaiting_signature"
    );
    expect(getExecutionPollingStatus({ ...baseSession, status: "refresh_required" })).toBe("refresh_required");
    expect(getExecutionPollingStatus({ ...baseSession, status: "blocked" })).toBe("blocked");
    expect(getExecutionPollingStatus({ ...baseSession, status: "expired" })).toBe("expired");
  });

  it("uses recorded execution result status for active sessions", () => {
    expect(
      getExecutionPollingStatus({
        ...baseSession,
        status: "signed_pending_result",
        executionResult: {
          reviewSessionId: "session_1",
          planId: "plan_1",
          status: "success",
          txDigest: "digest",
          recordedAt: new Date(1).toISOString()
        }
      })
    ).toBe("success");
  });

  it("reports expired when a pending result outlives the session", () => {
    expect(
      getExecutionPollingStatus({
        ...baseSession,
        status: "expired",
        executionResult: {
          reviewSessionId: "session_1",
          planId: "plan_1",
          status: "signed_pending_result",
          txDigest: "digest",
          recordedAt: new Date(1).toISOString()
        }
      })
    ).toBe("expired");
  });

  it("keeps wait-stopping status separate from internal final status", () => {
    expect(isFinalSessionStatus("blocked")).toBe(false);
    expect(isWaitStoppingExecutionStatus("blocked")).toBe(true);
    expect(executionStatusCategory("blocked")).toBe("user_action_required");

    expect(isFinalSessionStatus("refresh_required")).toBe(false);
    expect(isWaitStoppingExecutionStatus("refresh_required")).toBe(true);
    expect(executionStatusCategory("refresh_required")).toBe("user_action_required");

    expect(isWaitStoppingExecutionStatus("signed_pending_result")).toBe(false);
    expect(isInteractionPendingReviewStatus("signed_pending_result")).toBe(true);
    expect(executionStatusCategory("signed_pending_result")).toBe("awaiting_chain_result");

    expect(isWaitStoppingExecutionStatus("success")).toBe(true);
    expect(executionStatusCategory("success")).toBe("final");
  });

  it("keeps user-action-required review statuses visible as pending interactions", () => {
    expect(isInteractionPendingReviewStatus("pending")).toBe(true);
    expect(isInteractionPendingReviewStatus("awaiting_wallet")).toBe(true);
    expect(isInteractionPendingReviewStatus("awaiting_signature")).toBe(true);
    expect(isInteractionPendingReviewStatus("signed_pending_result")).toBe(true);
    expect(isInteractionPendingReviewStatus("refresh_required")).toBe(true);
    expect(isInteractionPendingReviewStatus("blocked")).toBe(true);

    expect(isInteractionPendingReviewStatus("success")).toBe(false);
    expect(isInteractionPendingReviewStatus("failure")).toBe(false);
    expect(isInteractionPendingReviewStatus("expired")).toBe(false);
  });

  it("builds execution polling hints from the shared polling contract", () => {
    expect(executionPollingHint()).toEqual({
      nonTerminalStatuses: ["pending", "awaiting_wallet", "awaiting_signature", "signed_pending_result"],
      waitStoppingStatuses: ["success", "failure", "refresh_required", "blocked", "expired"],
      finalStatuses: ["success", "failure", "expired"],
      userActionRequiredStatuses: ["refresh_required", "blocked"],
      recommendedIntervalSeconds: EXECUTION_POLLING_INTERVAL_SECONDS
    });
  });
});
