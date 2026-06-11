export const EXTERNAL_PROPOSAL_CONTRACT_VERSION = "external-proposal-alpha-2026-05-25";
export const PROPOSAL_REVIEW_MODEL_VERSION = "proposal-review-model-alpha-2026-05-25";

export type ExternalProposalSource = {
  kind: "mcp_server" | "ai_client" | "user" | "other";
  name: string;
  reference?: string | undefined;
};

export type ExternalProposalParty = {
  address?: string | undefined;
  label?: string | undefined;
};

export type ExternalProposalAssetAmount = {
  amountDisplay: string;
  amountKind: "display_proposal";
  symbol?: string | undefined;
  coinType?: string | undefined;
  denomination?: string | undefined;
};

export type ExternalPaymentProposal = {
  type: "payment";
  id: string;
  source: ExternalProposalSource;
  network: "sui:mainnet";
  createdAt: string;
  expiresAt?: string | undefined;
  purpose: string;
  payment: {
    amount: ExternalProposalAssetAmount;
    recipient: ExternalProposalParty;
    target?: string | undefined;
  };
  assumptions?: string[] | undefined;
  requiredUserChoices?: string[] | undefined;
};

export type ExternalProposalActionTarget = {
  packageId?: string | undefined;
  module?: string | undefined;
  function?: string | undefined;
  objectId?: string | undefined;
  label?: string | undefined;
};

export type ExternalProposalAssetFlowItem = {
  direction: "outgoing" | "expected_incoming" | "fee";
  amount: ExternalProposalAssetAmount;
  recipient?: ExternalProposalParty | undefined;
  description?: string | undefined;
};

export type ExternalSuiActionProposal = {
  type: "sui_action";
  id: string;
  source: ExternalProposalSource;
  network: "sui:mainnet";
  createdAt: string;
  expiresAt?: string | undefined;
  purpose: string;
  action: {
    actionKind: string;
    target: ExternalProposalActionTarget;
    recipient?: ExternalProposalParty | undefined;
    assetFlow?: ExternalProposalAssetFlowItem[] | undefined;
  };
  assumptions?: string[] | undefined;
  requiredUserChoices?: string[] | undefined;
};

export type ExternalProposal = ExternalPaymentProposal | ExternalSuiActionProposal;

export type ProposalReviewEvidenceItem = {
  id: string;
  label: string;
  source: "external_proposal" | "local_schema";
  summary: string;
};

export type ProposalReviewGap = {
  id: string;
  label: string;
  reason: string;
};

export type ProposalReviewUnsupportedClaim = {
  id: string;
  label: string;
  reason: string;
};

export const EXTERNAL_PROPOSAL_SETTLEMENT_TOKEN_SELECTION_UNSUPPORTED_CLAIM_ID =
  "settlement_token_selection";

export const EXTERNAL_PROPOSAL_REVIEW_ALWAYS_UNSUPPORTED_CLAIMS = [
  {
    id: "external_transaction_material_trusted_authority",
    label: "External transaction material",
    reason:
      "External proposal data is not accepted as transaction-building input, signing data, or wallet authorization."
  },
  {
    id: "signing_readiness",
    label: "Signing readiness",
    reason:
      "This review session is read-only and has no reviewed signable adapter, transaction regeneration, or wallet handoff."
  },
  {
    id: "route_recommendation",
    label: "Route recommendation",
    reason:
      "The review model does not rank venues, choose routes, or make best-price recommendations."
  },
  {
    id: EXTERNAL_PROPOSAL_SETTLEMENT_TOKEN_SELECTION_UNSUPPORTED_CLAIM_ID,
    label: "Settlement-token selection",
    reason:
      "External proposal review can display declared asset fields, but it does not verify that the user selected a settlement token and does not choose one for the user."
  },
  {
    id: "fiat_usd_cash_out",
    label: "Fiat USD cash-out",
    reason:
      "Settlement assets are not treated as fiat USD, bank cash-out amounts, or peg guarantees."
  },
  {
    id: "profit_or_pnl",
    label: "P&L, tax, and cost basis",
    reason:
      "The current release does not compute profit, loss, tax, or cost basis."
  }
] as const satisfies readonly ProposalReviewUnsupportedClaim[];

export type ProposalRejectedExecutableField = {
  fieldName: string;
  reason: string;
};

export type ProposalReviewCheck = {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail";
  message: string;
  source: "proposal" | "adapter" | "registry" | "quote" | "wallet" | "simulation" | "network";
};

export type ProposalReviewModel = {
  modelVersion: typeof PROPOSAL_REVIEW_MODEL_VERSION;
  contractVersion: typeof EXTERNAL_PROPOSAL_CONTRACT_VERSION;
  proposalId: string;
  proposalType: ExternalProposal["type"];
  proposalSource: ExternalProposalSource;
  proposedAction: {
    kind: ExternalProposal["type"];
    title: string;
    purpose: string;
    network: "sui:mainnet";
    recipient?: ExternalProposalParty | undefined;
    target?: string | ExternalProposalActionTarget | undefined;
  };
  assetFlow: {
    outgoing: ExternalProposalAssetAmount[];
    expectedIncoming: ExternalProposalAssetAmount[];
    fees: ExternalProposalAssetAmount[];
  };
  recipients: ExternalProposalParty[];
  targets: Array<string | ExternalProposalActionTarget>;
  evidenceUsed: ProposalReviewEvidenceItem[];
  missingEvidence: ProposalReviewGap[];
  requiredUserChoices: ProposalReviewGap[];
  unsupportedClaims: ProposalReviewUnsupportedClaim[];
  rejectedExecutableFields: ProposalRejectedExecutableField[];
  freshness: {
    proposalCreatedAt: string;
    proposalExpiresAt?: string | undefined;
    evaluatedAt: string;
    status: "current" | "expired" | "created_in_future" | "expiry_not_provided";
    reason: string;
  };
  blockingChecks: ProposalReviewCheck[];
  nonSignableReason: {
    code: "external_proposal_review_only";
    message: string;
    blockedCapabilities: string[];
  };
};

export type ExternalProposalActionPlanData = {
  requestedIntent: ExternalProposal;
  implementationStatus: "read_only_review_only";
  contractVersion: typeof EXTERNAL_PROPOSAL_CONTRACT_VERSION;
};
