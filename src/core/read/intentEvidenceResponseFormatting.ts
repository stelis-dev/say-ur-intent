import {
  INTENT_EVIDENCE_QUANTITY_KIND,
  INTENT_EVIDENCE_TARGET_ASSET_SELECTION_SOURCES,
  type IntentEvidenceCandidateConversion,
  type IntentEvidenceKind,
  type IntentEvidenceQuantitySemantics,
  type IntentEvidenceResponseEvidence,
  type IntentEvidenceResponseSummary,
  type IntentEvidenceSelectedTarget,
  type IntentEvidenceSettlementAssetCoverage,
  type IntentEvidenceSettlementAssetCoverageBoundary,
  type IntentEvidenceTargetAssetSelectionSource,
  type SettlementAssetGroupAsset
} from "./readServiceTypes.js";

export function intentEvidenceQuantitySemantics(): IntentEvidenceQuantitySemantics {
  return {
    kind: INTENT_EVIDENCE_QUANTITY_KIND,
    allowedUse: "pre_transaction_evidence",
    naturalLanguageIntentEvidence: true,
    transactionBuildingAvailable: false,
    signingReadinessAvailable: false,
    routeRecommendationAvailable: false,
    fiatUsdCashOutAvailable: false,
    profitAndLossAvailable: false,
    costBasisAvailable: false,
    notFor: [
      "transaction_building",
      "signing_data",
      "signing_readiness",
      "payment_execution",
      "best_route",
      "route_recommendation",
      "fiat_usd_cash_out",
      "external_market_price_conversion",
      "profit_or_pnl",
      "cost_basis"
    ]
  };
}

export function isSupportedIntentEvidenceKind(intentKind: string): intentKind is IntentEvidenceKind {
  return intentKind === "cover_payment_like_amount" || intentKind === "summarize_settlement_asset_group_balance";
}

export function isIntentEvidenceTargetAssetSelectionSource(
  source: string
): source is IntentEvidenceTargetAssetSelectionSource {
  return (INTENT_EVIDENCE_TARGET_ASSET_SELECTION_SOURCES as readonly string[]).includes(source);
}

export function intentEvidenceSettlementAssetCoverageBoundary(): IntentEvidenceSettlementAssetCoverageBoundary {
  return [
    "current_wallet_coin_balance_snapshot",
    "settlement_asset_assets_only",
    "not_settlement_token_selection",
    "not_route_dependent_payment_support",
    "not_payment_execution_readiness",
    "not_gas_readiness"
  ];
}

export function intentEvidenceResponseEvidence(
  targetAsset: SettlementAssetGroupAsset | undefined,
  settlementAssetCoverage: IntentEvidenceSettlementAssetCoverage,
  candidateConversions: IntentEvidenceCandidateConversion[]
): IntentEvidenceResponseEvidence {
  const settlementAssetClaims = intentEvidenceSettlementAssetResponseClaims(settlementAssetCoverage);
  if (targetAsset === undefined || isIntentEvidenceSettlementAssetCoverageUnavailable(settlementAssetCoverage)) {
    return {
      mode: "settlement_asset_only",
      primaryEvidenceFields: ["responseSummary"],
      supportedResponseClaims: [...settlementAssetClaims, "required_user_choices", "unsupported_inferences"]
    };
  }

  return {
    mode: "selected_target_context",
    primaryEvidenceFields: [
      "responseSummary",
      "selectedTarget",
      "candidateConversions",
      "requiredUserChoices"
    ],
    supportedResponseClaims: [
      ...settlementAssetClaims,
      "selected_target_shortfall",
      ...(candidateConversions.some((candidate) => candidate.status === "quoted")
        ? (["direct_pool_quote_evidence"] as const)
        : []),
      "required_user_choices",
      "unsupported_inferences"
    ]
  };
}

function intentEvidenceSettlementAssetResponseClaims(
  settlementAssetCoverage: IntentEvidenceSettlementAssetCoverage
): IntentEvidenceResponseEvidence["supportedResponseClaims"] {
  if (settlementAssetCoverage.status === "balance_total_only") {
    return ["current_settlement_asset_total"];
  }
  if (isIntentEvidenceSettlementAssetCoverageUnavailable(settlementAssetCoverage)) {
    return ["settlement_asset_coverage_unavailable"];
  }
  return ["settlement_asset_coverage_status", "settlement_asset_shortfall"];
}

export function intentEvidenceSupportedClaims(
  settlementAssetCoverage: IntentEvidenceSettlementAssetCoverage,
  selectedTarget: IntentEvidenceSelectedTarget | undefined,
  candidateConversions: IntentEvidenceCandidateConversion[]
): string[] {
  if (isIntentEvidenceSettlementAssetCoverageUnavailable(settlementAssetCoverage)) {
    return ["settlement_asset_coverage_unavailable"];
  }

  const claims = [
    "current_wallet_usd_settlement_coin_balance_snapshot",
    "verified_display_amounts_from_pinned_or_onchain_decimals",
    "settlement_asset_balance_total_when_common_decimals_are_available"
  ];

  if (settlementAssetCoverage.status !== "balance_total_only") {
    claims.push("settlement_asset_shortfall_when_common_decimals_are_available");
  }
  if (selectedTarget !== undefined && candidateConversions.some((candidate) => candidate.status === "quoted")) {
    claims.push("direct_deepbook_pool_and_quote_evidence_when_target_asset_is_selected");
  }
  return claims;
}

function intentEvidenceAnswerCompleteness(input: {
  settlementAssetCoverage: IntentEvidenceSettlementAssetCoverage;
  responseEvidenceMode: IntentEvidenceResponseEvidence["mode"];
}): IntentEvidenceResponseSummary["answerCompleteness"] {
  if (isIntentEvidenceSettlementAssetCoverageUnavailable(input.settlementAssetCoverage)) {
    return {
      answerCompleteFor: "settlement_asset_coverage_unavailable_answer",
      requiredAnswerFields: [
        "responseSummary.unavailableReason",
        "blockedReasons",
        "responseSummary.requiredUserChoices"
      ],
      notCompleteFor: [
        "settlement_asset_balance_total",
        "payment_coverage_status",
        "payment_shortfall",
        "selected_target_context",
        "route_dependent_payment_support",
        "payment_execution_readiness",
        "transaction_building",
        "signing_readiness"
      ]
    };
  }

  if (input.responseEvidenceMode === "selected_target_context") {
    return {
      answerCompleteFor: "selected_target_context_answer",
      requiredAnswerFields: ["responseSummary", "selectedTarget", "candidateConversions", "requiredUserChoices"],
      notCompleteFor: [
        "route_dependent_payment_support",
        "settlement_token_selection",
        "payment_execution_readiness",
        "transaction_building",
        "signing_readiness"
      ]
    };
  }

  return {
    answerCompleteFor: "settlement_asset_group_answer",
    requiredAnswerFields: ["responseSummary"],
    notCompleteFor: [
      "selected_target_context",
      "route_dependent_payment_support",
      "settlement_token_selection",
      "payment_execution_readiness",
      "transaction_building",
      "signing_readiness"
    ]
  };
}

export function isIntentEvidenceSettlementAssetCoverageUnavailable(
  settlementAssetCoverage: IntentEvidenceSettlementAssetCoverage
): settlementAssetCoverage is Extract<
  IntentEvidenceSettlementAssetCoverage,
  { status: "unavailable_mixed_decimals" | "unavailable_wallet_balance_scan_incomplete" }
> {
  return (
    settlementAssetCoverage.status === "unavailable_mixed_decimals" ||
    settlementAssetCoverage.status === "unavailable_wallet_balance_scan_incomplete"
  );
}

export function intentEvidenceResponseSummary(input: {
  intentKind: IntentEvidenceKind;
  assetGroupId: IntentEvidenceResponseSummary["assetGroupId"];
  settlementAssetCoverage: IntentEvidenceSettlementAssetCoverage;
  responseEvidenceMode: IntentEvidenceResponseEvidence["mode"];
  requiredUserChoices: string[];
}): IntentEvidenceResponseSummary {
  const questionKind: IntentEvidenceResponseSummary["questionKind"] =
    input.intentKind === "cover_payment_like_amount" ? "payment_coverage" : "settlement_asset_group_balance_total";
  const answerCompleteness = intentEvidenceAnswerCompleteness({
    settlementAssetCoverage: input.settlementAssetCoverage,
    responseEvidenceMode: input.responseEvidenceMode
  });
  const base = {
    questionKind,
    answerCompleteness,
    doNotCallQuoteToolsForThisQuestion: true as const,
    coverageBasis: "settlement_asset_wallet_balance_only" as const,
    assetGroupId: input.assetGroupId,
    requiredUserChoices: input.requiredUserChoices,
    separateQuoteOutputs: {
      usedForPaymentAnswer: false as const,
      usedForShortfallAnswer: false as const,
      reason: "separate_quote_tool_outputs_are_price_estimates_only" as const,
      paymentAnswerField: "responseSummary" as const
    },
    doNotUseForConclusion: [
      "separate_quote_tool_results",
      "assets_outside_settlement_group",
      "route_dependent_payment_support"
    ] as IntentEvidenceResponseSummary["doNotUseForConclusion"],
    excludedFromConclusion: [
      "separate_quote_tool_results",
      "candidate_conversion_quote_evidence",
      "assets_outside_settlement_group",
      "settlement_token_selection",
      "route_dependent_payment_support",
      "gas_reserve_or_fee_readiness",
      "payment_execution_readiness",
      "transaction_building",
      "signing_readiness",
      "fiat_usd_cash_out",
      "profit_or_pnl",
      "cost_basis"
    ] as IntentEvidenceResponseSummary["excludedFromConclusion"]
  };

  if (input.settlementAssetCoverage.status === "balance_total_only") {
    return {
      ...base,
      conclusionKind: "current_settlement_asset_total",
      currentDisplayAmount: input.settlementAssetCoverage.currentDisplayAmount,
      requiredDisplayAmount: null,
      shortfallDisplayAmount: null,
      amountsUsedForAnswer: {
        currentDisplayAmount: "current_wallet_balance_in_settlement_asset_group",
        requiredDisplayAmount: null,
        shortfallDisplayAmount: null
      }
    };
  }

  if (isIntentEvidenceSettlementAssetCoverageUnavailable(input.settlementAssetCoverage)) {
    return {
      ...base,
      conclusionKind: "settlement_asset_coverage_unavailable",
      currentDisplayAmount: null,
      requiredDisplayAmount: input.settlementAssetCoverage.requiredDisplayAmount ?? null,
      shortfallDisplayAmount: null,
      unavailableReason: input.settlementAssetCoverage.reason,
      amountsUsedForAnswer: {
        currentDisplayAmount: null,
        requiredDisplayAmount:
          input.settlementAssetCoverage.requiredDisplayAmount === undefined ? null : "amount_requested_by_user",
        shortfallDisplayAmount: null
      }
    };
  }

  return {
    ...base,
    conclusionKind: input.settlementAssetCoverage.status,
    currentDisplayAmount: input.settlementAssetCoverage.currentDisplayAmount,
    requiredDisplayAmount: input.settlementAssetCoverage.requiredDisplayAmount,
    shortfallDisplayAmount: input.settlementAssetCoverage.shortfallDisplayAmount,
    amountsUsedForAnswer: {
      currentDisplayAmount: "current_wallet_balance_in_settlement_asset_group",
      requiredDisplayAmount: "amount_requested_by_user",
      shortfallDisplayAmount: "required_amount_minus_current_settlement_asset_balance"
    }
  };
}
