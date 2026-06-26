import { describe, expect, it } from "vitest";

import { findForbiddenMcpFields } from "../src/core/action/forbiddenFields.js";
import type { ActionPlan, ExecutionResult, ReviewSession, ReviewState } from "../src/core/action/types.js";
import {
  buildReviewExecutionAnalysisPayload,
  reviewExecutionAnalysisPayloadSchema
} from "../src/core/session/reviewExecutionAnalysis.js";
import { chainReceiptAccount, chainReceiptDigest, chainReceiptFixture } from "./fixtures/chainReceipt.js";

const plan: ActionPlan = {
  id: "plan_1",
  actionKind: "swap",
  adapterId: "deepbook-swap",
  protocol: "DeepBookV3",
  title: "Review swap",
  summary: "Review a swap",
  assetFlowPreview: {
    outgoing: [{ symbol: "SUI", amount: "1", amountKind: "display_intent" }],
    expectedIncoming: [{ symbol: "USDC", amount: "unknown", amountKind: "display_intent", approx: true }]
  },
  adapterData: {
    privateKey: "must-never-leak",
    transactionBytes: "must-never-leak"
  },
  createdAt: "2026-06-26T00:00:00.000Z"
};
const suiCoinType = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";

function reviewState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    reviewSessionId: "review_1",
    planId: plan.id,
    account: chainReceiptAccount,
    status: "ready_for_wallet_review",
    checks: [
      {
        id: "ownership",
        label: "Object ownership",
        status: "pass",
        message: "Owned input objects were resolved.",
        source: "wallet"
      }
    ],
    updatedAt: "2026-06-26T00:01:00.000Z",
    walletReviewAdapterContract: {
      transactionMaterialCommitment: chainReceiptDigest
    },
    ...overrides
  } as ReviewState;
}

function session(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    id: "review_1",
    tokenHash: "secret-token-hash",
    status: "ready_for_wallet_review",
    plans: [plan],
    account: chainReceiptAccount,
    reviewState: reviewState(),
    createdAt: "2026-06-26T00:00:00.000Z",
    expiresAt: "2026-06-26T00:30:00.000Z",
    lastActivityAt: "2026-06-26T00:02:00.000Z",
    ...overrides
  } as ReviewSession;
}

describe("review execution analysis payload", () => {
  it("builds a schema-valid success analysis from stored review evidence and chain receipt facts", () => {
    const executionResult: ExecutionResult = {
      reviewSessionId: "review_1",
      planId: plan.id,
      status: "success",
      txDigest: chainReceiptDigest,
      recordedAt: "2026-06-26T00:03:00.000Z",
      chainReceipt: chainReceiptFixture()
    };

    const payload = buildReviewExecutionAnalysisPayload(
      session({ status: "success", executionResult }),
      new Date("2026-06-26T00:04:00.000Z")
    );

    expect(reviewExecutionAnalysisPayloadSchema.parse(payload)).toEqual(payload);
    expect(payload.execution.state).toBe("success");
    if (payload.execution.state !== "success") {
      throw new Error("expected success execution analysis");
    }
    expect(payload.execution.chainReceipt.sender).toBe(chainReceiptAccount);
    expect(payload.reviewedRequest).toEqual(expect.objectContaining({
      planId: plan.id,
      title: plan.title,
      protocol: plan.protocol
    }));
    expect(payload.reviewedEvidence?.walletReview?.transactionMaterialCommitment).toBe(chainReceiptDigest);
    expect(payload.labeledSessionFacts.map((fact) => fact.id)).toContain("receipt-sender");
    expect(findForbiddenMcpFields(payload)).toEqual([]);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("must-never-leak");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toMatch(/all matched|safe to sign|ready to sign/i);
  });

  it("keeps pending execution analysis free of chain receipt facts", () => {
    const executionResult: ExecutionResult = {
      reviewSessionId: "review_1",
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: chainReceiptDigest,
      recordedAt: "2026-06-26T00:03:00.000Z"
    };

    const payload = buildReviewExecutionAnalysisPayload(
      session({ status: "signed_pending_result", executionResult }),
      new Date("2026-06-26T00:04:00.000Z")
    );

    expect(payload.execution.state).toBe("signed_pending_result");
    expect(payload.execution).not.toHaveProperty("chainReceipt");
    expect(payload.labeledSessionFacts.find((fact) => fact.id === "receipt-sender")).toBeUndefined();
    expect(payload.labeledSessionFacts.find((fact) => fact.id === "chain-effects-status")).toBeUndefined();
    expect(payload.labeledSessionFacts.every((fact) => fact.value !== "Unavailable")).toBe(true);
    expect(findForbiddenMcpFields(payload)).toEqual([]);
  });

  it("displays chain execution failures as receipt facts, not a browser verdict", () => {
    const executionResult: ExecutionResult = {
      reviewSessionId: "review_1",
      planId: plan.id,
      status: "failure",
      txDigest: chainReceiptDigest,
      recordedAt: "2026-06-26T00:03:00.000Z",
      failureReason: "chain_execution_failed",
      chainReceipt: chainReceiptFixture({
        effectsStatus: { success: false, errorKind: "MoveAbort", errorMessage: "aborted" }
      })
    };

    const payload = buildReviewExecutionAnalysisPayload(
      session({ status: "failure", executionResult }),
      new Date("2026-06-26T00:04:00.000Z")
    );

    expect(payload.execution.state).toBe("failure");
    if (payload.execution.state !== "failure") {
      throw new Error("expected failure execution analysis");
    }
    expect(payload.execution.statusLabel).toBe(
      "The server recorded a Sui mainnet chain receipt with failed effects."
    );
    expect(payload.execution.chainReceipt?.effectsStatus).toEqual({
      success: false,
      errorKind: "MoveAbort",
      errorMessage: "aborted"
    });
    expect(payload.labeledSessionFacts.find((fact) => fact.id === "chain-effects-status")).toEqual(
      expect.objectContaining({ value: "failure: aborted", source: "chain_receipt" })
    );
    expect(JSON.stringify(payload)).not.toMatch(/all matched|safe to sign|ready to sign/i);
  });

  it("separates local pre-chain failures from server-read receipt failures", () => {
    const executionResult: ExecutionResult = {
      reviewSessionId: "review_1",
      planId: plan.id,
      status: "failure",
      recordedAt: "2026-06-26T00:03:00.000Z",
      failureReason: "wallet_rejected"
    };

    const payload = buildReviewExecutionAnalysisPayload(
      session({ status: "failure", executionResult }),
      new Date("2026-06-26T00:04:00.000Z")
    );

    expect(payload.execution.state).toBe("failure");
    if (payload.execution.state !== "failure") {
      throw new Error("expected failure execution analysis");
    }
    expect(payload.execution.statusLabel).toBe(
      "The page recorded a local pre-chain failure before a transaction digest was submitted."
    );
    expect(payload.execution).not.toHaveProperty("txDigest");
    expect(payload.execution).not.toHaveProperty("chainReceipt");
    expect(payload.labeledSessionFacts.find((fact) => fact.id === "receipt-sender")).toBeUndefined();
    expect(payload.labeledSessionFacts.every((fact) => fact.value !== "Unavailable")).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/server-side receipt verification failure/i);
    expect(findForbiddenMcpFields(payload)).toEqual([]);
  });

  it("pins simulation summary records to the public fields rendered by the analysis page", () => {
    const payload = buildReviewExecutionAnalysisPayload(
      session({
        reviewState: reviewState({
          simulation: {
            provider: "client.core.simulateTransaction",
            checksEnabled: true,
            success: true,
            gasCostSummary: {
              computationCostRaw: "100",
              storageCostRaw: "50",
              storageRebateRaw: "20",
              nonRefundableStorageFeeRaw: "0"
            },
            balanceChanges: [
              {
                address: chainReceiptAccount,
                coinType: suiCoinType,
                amount: "-1000"
              }
            ],
            objectChanges: [
              {
                objectId: chainReceiptAccount,
                objectType: `0x2::coin::Coin<${suiCoinType}>`,
                inputState: "mutated",
                outputState: "mutated",
                idOperation: "none"
              }
            ]
          }
        })
      }),
      new Date("2026-06-26T00:04:00.000Z")
    );

    expect(payload.reviewedEvidence?.simulation?.balanceChanges?.[0]).toEqual({
      address: chainReceiptAccount,
      coinType: suiCoinType,
      amount: "-1000"
    });
    expect(payload.reviewedEvidence?.simulation?.objectChanges?.[0]).toEqual(
      expect.objectContaining({
        objectId: chainReceiptAccount,
        inputState: "mutated",
        outputState: "mutated",
        idOperation: "none"
      })
    );
    expect(() =>
      reviewExecutionAnalysisPayloadSchema.parse({
        ...payload,
        reviewedEvidence: {
          ...payload.reviewedEvidence,
          simulation: {
            ...payload.reviewedEvidence?.simulation,
            balanceChanges: [{ owner: chainReceiptAccount, amount: "-1000" }]
          }
        }
      })
    ).toThrow();
  });
});
