import { z } from "zod";

import { assertNoForbiddenMcpFields } from "../action/forbiddenFields.js";
import {
  adapterLifecycleSchema,
  assetFlowPreviewSchema,
  executionResultSchema,
  humanReadableReviewSummarySchema,
  internalSessionStatusSchema,
  reviewCheckSchema,
  reviewStatusSchema,
  transactionSimulationSummarySchema,
} from "../action/schemas.js";
import { ptbVisualizationArtifactSchema } from "../action/signableAdapterContract.js";
import {
  suiChainReceiptEvidenceSchema,
  type SuiChainReceiptEvidence,
} from "../action/suiChainReceiptEvidence.js";
import type {
  ActionPlan,
  ExecutionResult,
  ReviewSession,
  ReviewState,
} from "../action/types.js";
import { proposalReviewModelSchema } from "../proposal/schemas.js";

const factSourceSchema = z.enum([
  "review_state",
  "execution_result",
  "chain_receipt",
]);

const labeledSessionFactSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    value: z.string(),
    source: factSourceSchema,
    meaning: z.string().min(1),
  })
  .strict();

const reviewedRequestSchema = z
  .object({
    planId: z.string().min(1),
    title: z.string().min(1),
    summary: z.string(),
    actionKind: z.string().min(1),
    adapterId: z.string().min(1),
    protocol: z.string().min(1),
    createdAt: z.string().min(1),
    assetFlowPreview: assetFlowPreviewSchema,
    reviewModel: proposalReviewModelSchema.optional(),
  })
  .strict();

const reviewedEvidenceSchema = z
  .object({
    account: z.string().optional(),
    status: reviewStatusSchema,
    updatedAt: z.string().min(1),
    checks: z.array(reviewCheckSchema),
    adapterLifecycle: adapterLifecycleSchema.optional(),
    blockedReason: z.string().optional(),
    refreshReason: z.string().optional(),
    humanReadableReview: humanReadableReviewSummarySchema.optional(),
    simulation: transactionSimulationSummarySchema.optional(),
    ptbVisualization: ptbVisualizationArtifactSchema.optional(),
    walletReview: z
      .object({
        transactionMaterialCommitment: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

const executionAnalysisSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("not_reported"),
      statusLabel: z.string().min(1),
    })
    .strict(),
  z
    .object({
      state: z.literal("signed_pending_result"),
      statusLabel: z.string().min(1),
      planId: z.string().min(1),
      txDigest: z.string().min(1),
      recordedAt: z.string().min(1),
      chainReceipt: z.undefined().optional(),
    })
    .strict(),
  z
    .object({
      state: z.literal("success"),
      statusLabel: z.string().min(1),
      planId: z.string().min(1),
      txDigest: z.string().min(1),
      recordedAt: z.string().min(1),
      chainReceipt: suiChainReceiptEvidenceSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("failure"),
      statusLabel: z.string().min(1),
      planId: z.string().min(1),
      txDigest: z.string().optional(),
      recordedAt: z.string().min(1),
      failureReason: z.string().min(1),
      chainReceipt: suiChainReceiptEvidenceSchema.optional(),
    })
    .strict(),
]);

export const reviewExecutionAnalysisPayloadSchema = z
  .object({
    kind: z.literal("review_execution_analysis_v1"),
    reviewSessionId: z.string().min(1),
    generatedAt: z.string().min(1),
    sessionStatus: internalSessionStatusSchema,
    summary: z
      .object({
        state: z.enum([
          "review_not_recorded",
          "review_recorded",
          "signed_pending_result",
          "success",
          "failure",
          "expired",
        ]),
        message: z.string().min(1),
      })
      .strict(),
    reviewedRequest: reviewedRequestSchema.optional(),
    reviewedEvidence: reviewedEvidenceSchema.optional(),
    execution: executionAnalysisSchema,
    labeledSessionFacts: z.array(labeledSessionFactSchema),
    unsupportedUses: z.array(z.string().min(1)),
  })
  .strict();

export type ReviewExecutionAnalysisPayload = z.infer<
  typeof reviewExecutionAnalysisPayloadSchema
>;

export function buildReviewExecutionAnalysisPayload(
  session: ReviewSession,
  now = new Date(),
): ReviewExecutionAnalysisPayload {
  const plan = selectPlan(session);
  const reviewState = session.reviewState;
  const executionResult = session.executionResult;
  const payload = {
    kind: "review_execution_analysis_v1",
    reviewSessionId: session.id,
    generatedAt: now.toISOString(),
    sessionStatus: session.status,
    summary: buildSummary(session),
    ...(plan ? { reviewedRequest: buildReviewedRequest(plan) } : {}),
    ...(reviewState ? { reviewedEvidence: buildReviewedEvidence(reviewState) } : {}),
    execution: buildExecutionAnalysis(executionResult),
    labeledSessionFacts: buildLabeledFacts(reviewState, executionResult),
    unsupportedUses: [
      "This page displays local review evidence and server-read chain receipt facts for this review session.",
      "It does not contain transaction bytes, BCS, wallet signatures, signing readiness, payment readiness, route quality, best-price advice, fiat value, P&L, tax evidence, cost-basis evidence, or a USDC/USD peg proof.",
      "It is not a substitute for wallet review; the user's wallet remains the only approval surface.",
    ],
  };

  const parsed = reviewExecutionAnalysisPayloadSchema.parse(payload);
  assertNoForbiddenMcpFields(parsed);
  return parsed;
}

function selectPlan(session: ReviewSession): ActionPlan | undefined {
  const selectedPlanId =
    session.reviewState?.planId ?? session.executionResult?.planId;
  if (selectedPlanId) {
    return session.plans.find((candidate) => candidate.id === selectedPlanId);
  }
  return session.plans[0];
}

function buildReviewedRequest(plan: ActionPlan) {
  return {
    planId: plan.id,
    title: plan.title,
    summary: plan.summary,
    actionKind: plan.actionKind,
    adapterId: plan.adapterId,
    protocol: plan.protocol,
    createdAt: plan.createdAt,
    assetFlowPreview: plan.assetFlowPreview,
    ...(plan.reviewModel ? { reviewModel: plan.reviewModel } : {}),
  };
}

function buildReviewedEvidence(reviewState: ReviewState) {
  return {
    ...(reviewState.account ? { account: reviewState.account } : {}),
    status: reviewState.status,
    updatedAt: reviewState.updatedAt,
    checks: reviewState.checks,
    ...(reviewState.adapterLifecycle
      ? { adapterLifecycle: reviewState.adapterLifecycle }
      : {}),
    ...(reviewState.blockedReason
      ? { blockedReason: reviewState.blockedReason }
      : {}),
    ...(reviewState.refreshReason
      ? { refreshReason: reviewState.refreshReason }
      : {}),
    ...(reviewState.humanReadableReview
      ? { humanReadableReview: reviewState.humanReadableReview }
      : {}),
    ...(reviewState.simulation ? { simulation: reviewState.simulation } : {}),
    ...(reviewState.ptbVisualization
      ? { ptbVisualization: reviewState.ptbVisualization }
      : {}),
    ...(reviewState.walletReviewAdapterContract
      ? {
          walletReview: {
            transactionMaterialCommitment:
              reviewState.walletReviewAdapterContract
                .transactionMaterialCommitment,
          },
        }
      : {}),
  };
}

function buildExecutionAnalysis(
  executionResult: ExecutionResult | undefined,
): ReviewExecutionAnalysisPayload["execution"] {
  if (!executionResult) {
    return {
      state: "not_reported",
      statusLabel: "No execution result has been recorded for this session.",
    };
  }
  if (executionResult.status === "signed_pending_result") {
    return {
      state: "signed_pending_result",
      statusLabel:
        "The page reported a submitted transaction digest; the server has not recorded a chain receipt yet.",
      planId: executionResult.planId,
      txDigest: executionResult.txDigest,
      recordedAt: executionResult.recordedAt,
    };
  }
  if (executionResult.status === "success") {
    return {
      state: "success",
      statusLabel:
        "The server recorded a Sui mainnet chain receipt for this transaction digest.",
      planId: executionResult.planId,
      txDigest: executionResult.txDigest,
      recordedAt: executionResult.recordedAt,
      chainReceipt: executionResult.chainReceipt,
    };
  }
  return {
    state: "failure",
    statusLabel: failureStatusLabel(executionResult),
    planId: executionResult.planId,
    ...(executionResult.txDigest ? { txDigest: executionResult.txDigest } : {}),
    recordedAt: executionResult.recordedAt,
    failureReason: executionResult.failureReason,
    ...(executionResult.chainReceipt
      ? { chainReceipt: executionResult.chainReceipt }
      : {}),
  };
}

function failureStatusLabel(
  executionResult: Extract<ExecutionResult, { status: "failure" }>,
): string {
  if (!executionResult.txDigest) {
    return "The page recorded a local pre-chain failure before a transaction digest was submitted.";
  }
  if (executionResult.chainReceipt) {
    return "The server recorded a Sui mainnet chain receipt with failed effects.";
  }
  return "The server recorded a receipt verification failure for the submitted transaction digest.";
}

function buildSummary(session: ReviewSession): ReviewExecutionAnalysisPayload["summary"] {
  const executionResult = session.executionResult;
  if (executionResult?.status === "success") {
    return {
      state: "success",
      message: "Server-read chain receipt evidence is recorded for this session.",
    };
  }
  if (executionResult?.status === "failure") {
    return {
      state: "failure",
      message: "An execution failure or receipt verification failure is recorded.",
    };
  }
  if (executionResult?.status === "signed_pending_result") {
    return {
      state: "signed_pending_result",
      message:
        "A submitted transaction digest is recorded and can be rechecked by the server.",
    };
  }
  if (session.status === "expired") {
    return {
      state: "expired",
      message: "The review session has expired.",
    };
  }
  if (session.reviewState) {
    return {
      state: "review_recorded",
      message:
        "Local review evidence is recorded; no execution result is recorded for this session.",
    };
  }
  return {
    state: "review_not_recorded",
    message:
      "No local review evidence or execution result is recorded for this session.",
  };
}

function buildLabeledFacts(
  reviewState: ReviewState | undefined,
  executionResult: ExecutionResult | undefined,
) {
  const chainReceipt = executionResult?.chainReceipt;
  return [
    fact(
      "reviewed-transaction-commitment",
      "Reviewed transaction commitment",
      reviewState?.walletReviewAdapterContract?.transactionMaterialCommitment,
      "review_state",
      "The digest commitment bound to the transaction material that the review page prepared for wallet handoff.",
    ),
    fact(
      "reported-transaction-digest",
      "Reported transaction digest",
      executionResult?.txDigest,
      "execution_result",
      "The transaction digest recorded in the local execution result for this review session.",
    ),
    fact(
      "reviewed-account",
      "Reviewed account",
      reviewState?.account,
      "review_state",
      "The account address used by the local review evidence when it was available.",
    ),
    fact(
      "receipt-sender",
      "Receipt sender",
      chainReceipt?.sender,
      "chain_receipt",
      "The sender reported by the server-read Sui transaction receipt when a chain receipt is stored.",
    ),
    fact(
      "execution-result-state",
      "Execution result state",
      executionResult?.status,
      "execution_result",
      "The local execution result state recorded for the review session.",
    ),
    fact(
      "chain-effects-status",
      "Chain effects status",
      chainEffectsStatus(chainReceipt),
      "chain_receipt",
      "The execution status reported by the stored Sui chain receipt.",
    ),
  ].filter((item): item is z.infer<typeof labeledSessionFactSchema> => item !== undefined);
}

function chainEffectsStatus(
  chainReceipt: SuiChainReceiptEvidence | undefined,
): string | undefined {
  if (!chainReceipt) {
    return undefined;
  }
  if (chainReceipt.effectsStatus.success) {
    return "success";
  }
  return chainReceipt.effectsStatus.errorMessage
    ? `failure: ${chainReceipt.effectsStatus.errorMessage}`
    : chainReceipt.effectsStatus.errorKind
      ? `failure: ${chainReceipt.effectsStatus.errorKind}`
    : "failure";
}

function fact(
  id: string,
  label: string,
  value: string | undefined,
  source: z.infer<typeof factSourceSchema>,
  meaning: string,
) {
  if (value === undefined) {
    return undefined;
  }
  return {
    id,
    label,
    value,
    source,
    meaning,
  };
}
