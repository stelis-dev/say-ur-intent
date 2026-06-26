import type { UserAnswerUse } from "../core/evidence/userAnswerUse.js";
import { EXTERNAL_PROPOSAL_SETTLEMENT_TOKEN_SELECTION_UNSUPPORTED_CLAIM_ID } from "../core/proposal/types.js";
import { TOOL_NAMES } from "./toolNames.js";

export function interactionStatusUserAnswerUse(): UserAnswerUse {
  return {
    canAnswer: [
      "current_active_account_read_context",
      "pending_local_wallet_identity_interactions",
      "pending_local_review_interactions"
    ],
    cannotAnswer: [
      "wallet_login_or_authentication",
      "wallet_custody_or_authorization",
      "transaction_execution_result",
      "transaction_building",
      "signing_data_or_readiness",
      "complete_wallet_history",
      "profit_or_pnl"
    ],
    answerFields: ["activeAccount", "pendingWalletIdentitySessions", "pendingReviewSessions"],
    diagnosticOnlyFields: [
      "pendingWalletIdentitySessions.truncated",
      "pendingReviewSessions.truncated"
    ],
    followUp: {
      tool: TOOL_NAMES.sessionGetReviewStatus,
      inputFields: ["pendingReviewSessions.items[].reviewSessionId"],
      answerFields: ["pollingStatus", "statusCategory", "reviewState"],
      reason: "Use for the current status of a specific pending review; interaction status is a local overview."
    }
  };
}

export function walletIdentityUserAnswerUse(
  fields: {
    hasAccount?: boolean;
    hasFailure?: boolean;
    hasWalletInfo?: boolean;
    hasWaitOutcome?: boolean;
    hasOpenFields?: boolean;
  } = {}
): UserAnswerUse {
  const hasAccount = fields.hasAccount ?? false;
  const hasFailure = fields.hasFailure ?? false;
  const hasWalletInfo = fields.hasWalletInfo ?? false;
  const hasWaitOutcome = fields.hasWaitOutcome ?? false;
  const hasOpenFields = fields.hasOpenFields ?? false;
  const followUp =
    hasOpenFields || (!hasAccount && !hasFailure)
      ? {
          tool: TOOL_NAMES.sessionWaitWalletIdentity,
          inputFields: ["walletSessionId"],
          answerFields: ["status", "account", "chain", "waitOutcome"],
          reason:
            "Use after giving the walletUrl to check whether the local wallet identity capture connected, timed out, failed, or was rejected."
        }
      : hasAccount
        ? {
            tool: TOOL_NAMES.accountGetActiveAccount,
            answerFields: ["status", "account", "boundary"],
            reason:
              "Use after a connected wallet identity result before telling the user which active account read context is stored."
          }
        : undefined;

  return {
    canAnswer: [
      "local_wallet_identity_capture_status",
      ...(hasAccount ? ["active_account_candidate_captured_for_read_context"] : []),
      ...(hasFailure ? ["wallet_identity_failure_reason"] : []),
      ...(hasWaitOutcome ? ["whether_the_bounded_wait_finished_or_timed_out"] : [])
    ],
    cannotAnswer: [
      "wallet_login_or_authentication",
      "wallet_custody_or_authorization",
      "transaction_authorization",
      "transaction_building",
      "signing_data_or_readiness",
      "wallet_balance_or_activity",
      "complete_wallet_history",
      "profit_or_pnl"
    ],
    answerFields: [
      ...(hasWaitOutcome ? ["waitOutcome"] : []),
      "walletSessionId",
      ...(hasOpenFields ? ["walletUrl", "openTarget", "accessScope"] : []),
      "status",
      ...(hasAccount ? ["account", "chain"] : []),
      ...(hasFailure ? ["failureReason"] : []),
      "expiresAt",
      "lastActivityAt",
      "pollingHint"
    ],
    diagnosticOnlyFields: [
      ...(hasWalletInfo ? ["walletName", "walletId"] : []),
      ...(hasFailure ? ["failureDetail"] : [])
    ],
    ...(followUp === undefined ? {} : { followUp })
  };
}

export function executionResultUserAnswerUse(
  fields: { hasExecutionResult?: boolean; hasWaitOutcome?: boolean } = {}
): UserAnswerUse {
  const hasExecutionResult = fields.hasExecutionResult ?? false;
  const hasWaitOutcome = fields.hasWaitOutcome ?? false;

  return {
    canAnswer: [
      "current_local_execution_polling_status",
      "whether_user_action_or_chain_polling_is_still_pending",
      ...(hasExecutionResult ? ["recorded_review_execution_result"] : [])
    ],
    cannotAnswer: [
      ...(hasExecutionResult ? [] : ["recorded_review_execution_result_without_executionResult_field"]),
      "transaction_execution_guarantee",
      "chain_receipt_as_execution_guarantee",
      "chain_receipt_as_route_quality",
      "chain_receipt_as_fiat_pnl_tax_or_peg_evidence",
      "absolute_safety_verdict",
      "route_quality",
      "wallet_custody_or_authorization",
      "transaction_building",
      "signing_data_or_readiness",
      "complete_wallet_history",
      "profit_or_pnl"
    ],
    answerFields: [
      ...(hasWaitOutcome ? ["waitOutcome"] : []),
      "reviewSessionId",
      "status",
      "statusCategory",
      "lastActivityAt",
      "pollingHint",
      ...(hasExecutionResult ? ["executionResult"] : [])
    ],
    conclusionRuleFields: [
      "statusCategory",
      "pollingHint.finalStatuses",
      "pollingHint.userActionRequiredStatuses",
      "pollingHint.nonTerminalStatuses"
    ],
    diagnosticOnlyFields: [],
    followUp: {
      tool: TOOL_NAMES.sessionGetReviewStatus,
      inputFields: ["reviewSessionId"],
      answerFields: ["pollingStatus", "statusCategory", "reviewState"],
      reason: "Use for current review state and checks; execution polling status alone is not a safety or signing verdict."
    }
  };
}

export function reviewStatusUserAnswerUse(
  hasReviewState: boolean,
  hasAdapterLifecycle = false,
  hasHumanReadableReview = false,
  hasSimulation = false
): UserAnswerUse {
  return {
    canAnswer: [
      "current_local_review_session_status",
      "current_review_checks_when_reviewState_is_present",
      ...(hasAdapterLifecycle ? ["current_deepbook_review_lifecycle_stage_status"] : []),
      ...(hasHumanReadableReview ? ["current_human_readable_review_facts_projected_from_verified_review_evidence"] : []),
      ...(hasSimulation ? ["current_review_time_simulation_summary_projected_from_private_review_evidence"] : []),
      "whether_user_action_or_chain_polling_is_still_pending"
    ],
    cannotAnswer: [
      "transaction_execution_guarantee",
      "absolute_safety_verdict",
      "route_quality",
      "wallet_custody_or_authorization",
      "transaction_building",
      "transaction_bytes_or_digest_values",
      "signing_data_or_readiness",
      "complete_wallet_history",
      "profit_or_pnl"
    ],
    answerFields: [
      "reviewSessionId",
      "internalStatus",
      "pollingStatus",
      "statusCategory",
      ...(hasReviewState
        ? [
            "reviewState.status",
            "reviewState.checks",
            "reviewState.blockedReason",
            "reviewState.refreshReason"
          ]
        : []),
      ...(hasAdapterLifecycle
        ? [
            "reviewState.adapterLifecycle",
            "reviewState.adapterLifecycle.stageCatalogId",
            "reviewState.adapterLifecycle.completedStages",
            "reviewState.adapterLifecycle.missingStages"
          ]
        : []),
      ...(hasHumanReadableReview
        ? [
            "reviewState.humanReadableReview",
            "reviewState.humanReadableReview.kind",
            "reviewState.humanReadableReview.proposedAction",
            "reviewState.humanReadableReview.assetFlow",
            "reviewState.humanReadableReview.targets",
            "reviewState.humanReadableReview.evidenceUsed",
            "reviewState.humanReadableReview.missingEvidence",
            "reviewState.humanReadableReview.requiredUserChoices",
            "reviewState.humanReadableReview.freshness",
            "reviewState.humanReadableReview.unsupportedClaims",
            "reviewState.humanReadableReview.blockingChecks"
          ]
        : []),
      ...(hasSimulation
        ? [
            "reviewState.simulation",
            "reviewState.simulation.provider",
            "reviewState.simulation.checksEnabled",
            "reviewState.simulation.success",
            "reviewState.simulation.gasCostSummary",
            "reviewState.simulation.gasCostSummary.computationCostRaw",
            "reviewState.simulation.gasCostSummary.storageCostRaw",
            "reviewState.simulation.gasCostSummary.storageRebateRaw",
            "reviewState.simulation.gasCostSummary.nonRefundableStorageFeeRaw",
            "reviewState.simulation.balanceChanges",
            "reviewState.simulation.objectChanges"
          ]
        : []),
      "lastActivityAt"
    ],
    diagnosticOnlyFields: [],
    followUp: {
      tool: TOOL_NAMES.sessionGetExecutionResult,
      inputFields: ["reviewSessionId"],
      answerFields: ["executionResult"],
      reason: "Use when the user asks for a recorded execution result; status alone is not transaction execution proof."
    }
  };
}

export function reviewActivityListUserAnswerUse(): UserAnswerUse {
  return {
    canAnswer: ["local_review_session_rows_for_the_selected_account", "current_stored_review_status_counts_by_row"],
    cannotAnswer: [
      "sui_wallet_transaction_history",
      "complete_wallet_history",
      "execution_result_detail",
      "transaction_building",
      "signing_data_or_readiness",
      "profit_or_pnl"
    ],
    answerFields: ["activities", "activities[].reviewSessionId", "activities[].currentStatus", "activities[].updatedAt"],
    diagnosticOnlyFields: ["dataScope", "accountSource", "lowSampleWarning", "lowSampleThreshold", "truncated"],
    followUp: {
      tool: TOOL_NAMES.readGetReviewSessionDetail,
      inputFields: ["activities[].reviewSessionId"],
      answerFields: ["session", "planJson", "intentJson", "stateSnapshots", "transitions", "execution"],
      reason: "Use for stored plan, state snapshot, transition, and execution detail for one review session."
    }
  };
}

export function reviewFunnelUserAnswerUse(): UserAnswerUse {
  return {
    canAnswer: ["local_review_lifecycle_counts_for_the_selected_account"],
    cannotAnswer: [
      "sui_wallet_transaction_history",
      "complete_wallet_history",
      "execution_success_rate_for_all_wallet_activity",
      "transaction_building",
      "signing_data_or_readiness",
      "profit_or_pnl"
    ],
    answerFields: ["summary"],
    diagnosticOnlyFields: ["dataScope", "accountSource", "lowSampleWarning", "lowSampleThreshold", "truncated"]
  };
}

export function prepareActionReviewUserAnswerUse(
  fields: { hasBlockingPreliminaryChecks?: boolean } = {}
): UserAnswerUse {
  const hasBlockingPreliminaryChecks = fields.hasBlockingPreliminaryChecks ?? false;
  return {
    canAnswer: [
      "review_session_url_for_local_review_page",
      "preliminary_check_results_for_proposed_plan",
      "proposed_plan_asset_flow_preview",
      ...(hasBlockingPreliminaryChecks ? ["why_signing_is_currently_blocked_for_this_review"] : [])
    ],
    cannotAnswer: [
      "transaction_execution_guarantee",
      "transaction_building",
      "signing_data_or_readiness",
      "wallet_custody_or_authorization",
      "route_quality",
      "fiat_usd_cash_out",
      "profit_or_pnl"
    ],
    answerFields: [
      "reviewSessionId",
      "reviewUrl",
      "plans",
      "plans[].title",
      "plans[].summary",
      "plans[].assetFlowPreview",
      "plans[].preliminaryChecks",
      "preliminaryChecks"
    ],
    conclusionRuleFields: ["plans[].preliminaryChecks", "preliminaryChecks"],
    diagnosticOnlyFields: ["plans[].adapterData", "plans[].createdAt", "plans[].id"],
    followUp: {
      tool: TOOL_NAMES.sessionGetReviewStatus,
      inputFields: ["reviewSessionId"],
      answerFields: ["pollingStatus", "statusCategory", "reviewState"],
      reason: "Use for current review readiness; the prepare response only describes the proposal and any blocking preliminary checks."
    }
  };
}

export function prepareExternalProposalReviewUserAnswerUse(): UserAnswerUse {
  return {
    canAnswer: [
      "review_session_url_for_local_review_page",
      "external_proposal_summary_for_local_review",
      "proposal_asset_flow_preview",
      "proposal_recipient_or_target_fields",
      "missing_evidence_for_non_signable_review",
      "required_user_choices_for_non_signable_review",
      "unsupported_claims_for_non_signable_review",
      "why_signing_is_currently_blocked_for_this_review"
    ],
    cannotAnswer: [
      "transaction_execution_guarantee",
      "transaction_building",
      "signing_data_or_readiness",
      "wallet_custody_or_authorization",
      "route_quality",
      EXTERNAL_PROPOSAL_SETTLEMENT_TOKEN_SELECTION_UNSUPPORTED_CLAIM_ID,
      "fiat_usd_cash_out",
      "profit_or_pnl"
    ],
    answerFields: [
      "reviewSessionId",
      "reviewUrl",
      "plans",
      "plans[].reviewModel.proposedAction",
      "plans[].reviewModel.assetFlow",
      "plans[].reviewModel.recipients",
      "plans[].reviewModel.targets",
      "plans[].reviewModel.evidenceUsed",
      "plans[].reviewModel.missingEvidence",
      "plans[].reviewModel.requiredUserChoices",
      "plans[].reviewModel.unsupportedClaims",
      "plans[].reviewModel.freshness",
      "plans[].reviewModel.blockingChecks",
      "plans[].reviewModel.nonSignableReason",
      "preliminaryChecks"
    ],
    conclusionRuleFields: [
      "plans[].reviewModel.unsupportedClaims",
      "plans[].reviewModel.nonSignableReason",
      "preliminaryChecks"
    ],
    diagnosticOnlyFields: [
      "plans[].adapterData",
      "plans[].createdAt",
      "plans[].id",
      "plans[].reviewModel.rejectedExecutableFields"
    ],
    followUp: {
      tool: TOOL_NAMES.sessionGetReviewStatus,
      inputFields: ["reviewSessionId"],
      answerFields: ["pollingStatus", "statusCategory", "reviewState"],
      reason:
        "Use for current review status after the user opens the local page; the prepare response does not make the proposal signable."
    }
  };
}

export function reviewSessionDetailUserAnswerUse(hasExecution = false): UserAnswerUse {
  return {
    canAnswer: [
      "stored_local_review_session_plan_and_lifecycle_detail",
      "stored_review_state_snapshots",
      ...(hasExecution ? ["stored_review_execution_result"] : [])
    ],
    cannotAnswer: [
      "sui_wallet_transaction_history",
      "complete_wallet_history",
      ...(hasExecution ? [] : ["stored_review_execution_result_without_execution_field"]),
      "transaction_execution_guarantee",
      "absolute_safety_verdict",
      "route_quality",
      "wallet_custody_or_authorization",
      "transaction_building",
      "signing_data_or_readiness",
      "profit_or_pnl"
    ],
    answerFields: [
      "session",
      "planJson",
      "intentJson",
      "stateSnapshots",
      "transitions",
      ...(hasExecution ? ["execution", "execution.resultJson"] : [])
    ],
    diagnosticOnlyFields: ["dataScope", "accountSource", "lowSampleWarning", "lowSampleThreshold", "truncated"],
    followUp: {
      tool: TOOL_NAMES.sessionGetReviewStatus,
      inputFields: ["session.reviewSessionId"],
      answerFields: ["pollingStatus", "reviewState"],
      reason: "Use for the current in-memory review status; stored detail is local review history."
    }
  };
}
