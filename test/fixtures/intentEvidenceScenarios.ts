import { TOOL_NAMES } from "../../src/mcp/toolNames.js";

export const KOREAN_DOLLAR_ALIAS = "\uB2EC\uB7EC";

export const SETTLEMENT_ASSET_ONLY_RESPONSE_FIELDS = [
  "responseSummary"
] as const;

export const FORBIDDEN_USD_SETTLEMENT_RESPONSE_INFERENCES = [
  "settlement_token_selection",
  "fiat_usd_cash_out",
  "best_route_or_venue_comparison",
  "transaction_building",
  "signing_readiness",
  "profit_or_pnl"
] as const;

export const MCP_REPLAY_FORBIDDEN_CLAIMS = [
  "settlement_token_selection",
  "fiat_usd_cash_out",
  "gas_reserve_or_fee_readiness",
  "best_route_or_venue_comparison",
  "route_dependent_payment_support",
  "payment_execution_readiness",
  "transaction_building",
  "signing_readiness",
  "profit_or_pnl",
  "cost_basis"
] as const;

const KOREAN_PAYMENT_COVERAGE_PROMPT =
  `1000${KOREAN_DOLLAR_ALIAS} \uACB0\uC81C \uAC00\uB2A5\uD574?`;
const KOREAN_BALANCE_TOTAL_PROMPT =
  `\uB0B4 ${KOREAN_DOLLAR_ALIAS} \uC790\uC0B0 \uBAA8\uC73C\uBA74 \uC5BC\uB9C8\uB098 \uB3FC?`;
const KOREAN_SHORTFALL_PROMPT = "\uBD80\uC871\uBD84\uC740 \uC5BC\uB9C8\uC57C?";

export const intentEvidenceScenarios = [
  {
    id: "korean_dollar_payment_coverage",
    userWordingCategory: "korean_usd_settlement_payment_coverage",
    userPrompt: KOREAN_PAYMENT_COVERAGE_PROMPT,
    intendedMcpToolPath: [
      TOOL_NAMES.readGetServerStatus,
      TOOL_NAMES.readListSettlementAssetGroups,
      TOOL_NAMES.readPreviewIntentEvidence
    ],
    balanceRawAmount: "1500000000",
    previewIntentEvidenceInput: {
      intentKind: "cover_payment_like_amount",
      denomination: KOREAN_DOLLAR_ALIAS,
      requiredDisplayAmount: "1000"
    },
    expectedCoverageStatus: "covered_by_settlement_asset_balance",
    expectedCurrentDisplayAmount: "1500",
    expectedShortfallDisplayAmount: "0",
    expectedSupportedClaims: [
      "settlement_asset_coverage_status",
      "settlement_asset_shortfall",
      "required_user_choices",
      "unsupported_inferences"
    ],
    expectsRequiredChoice: true,
    expectedAnswerShape: "Say the current settlement-asset wallet snapshot covers the requested display amount, then ask for returned required user choices.",
    forbiddenClaims: MCP_REPLAY_FORBIDDEN_CLAIMS
  },
  {
    id: "korean_dollar_balance_total",
    userWordingCategory: "korean_usd_settlement_balance_total",
    userPrompt: KOREAN_BALANCE_TOTAL_PROMPT,
    intendedMcpToolPath: [
      TOOL_NAMES.readGetServerStatus,
      TOOL_NAMES.readListSettlementAssetGroups,
      TOOL_NAMES.readPreviewIntentEvidence
    ],
    balanceRawAmount: "1500000000",
    previewIntentEvidenceInput: {
      intentKind: "summarize_settlement_asset_group_balance",
      denomination: KOREAN_DOLLAR_ALIAS
    },
    expectedCoverageStatus: "balance_total_only",
    expectedCurrentDisplayAmount: "1500",
    expectedShortfallDisplayAmount: undefined,
    expectedSupportedClaims: ["current_settlement_asset_total", "required_user_choices", "unsupported_inferences"],
    expectsRequiredChoice: false,
    expectedAnswerShape: "Report the current settlement-asset total only and do not invent a payment target or settlement token.",
    forbiddenClaims: MCP_REPLAY_FORBIDDEN_CLAIMS
  },
  {
    id: "korean_dollar_shortfall_with_prior_target",
    userWordingCategory: "korean_usd_settlement_shortfall_with_prior_target",
    userPrompt: KOREAN_SHORTFALL_PROMPT,
    intendedMcpToolPath: [
      TOOL_NAMES.readGetServerStatus,
      TOOL_NAMES.readListSettlementAssetGroups,
      TOOL_NAMES.readPreviewIntentEvidence
    ],
    balanceRawAmount: "400000000",
    targetAmountSource: "prior_conversation_required_display_amount",
    previewIntentEvidenceInput: {
      intentKind: "cover_payment_like_amount",
      denomination: KOREAN_DOLLAR_ALIAS,
      requiredDisplayAmount: "1000"
    },
    expectedCoverageStatus: "shortfall_in_settlement_asset_balance",
    expectedCurrentDisplayAmount: "400",
    expectedShortfallDisplayAmount: "600",
    expectedSupportedClaims: [
      "settlement_asset_coverage_status",
      "settlement_asset_shortfall",
      "required_user_choices",
      "unsupported_inferences"
    ],
    expectsRequiredChoice: true,
    expectedAnswerShape: "Report the settlement-asset shortfall from the prior target amount and ask only for returned required user choices.",
    forbiddenClaims: MCP_REPLAY_FORBIDDEN_CLAIMS
  }
] as const;

export type IntentEvidenceScenario = (typeof intentEvidenceScenarios)[number];
export type IntentEvidenceScenarioPrompt = IntentEvidenceScenario["userPrompt"];

export function scenarioInputForUserPrompt(userPrompt: IntentEvidenceScenarioPrompt) {
  const scenario = intentEvidenceScenarios.find((item) => item.userPrompt === userPrompt);
  if (!scenario) {
    throw new Error(`Intent evidence scenario not found for prompt: ${userPrompt}`);
  }
  return scenario.previewIntentEvidenceInput;
}
