import { validateMnemonic } from "@scure/bip39";
import { wordlist as englishBip39Wordlist } from "@scure/bip39/wordlists/english.js";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { z } from "zod";
import { suiAddressStringSchema } from "../suiAddress.js";
import {
  EXTERNAL_PROPOSAL_CONTRACT_VERSION,
  PROPOSAL_REVIEW_MODEL_VERSION
} from "./types.js";

const isoUtcStringSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected ISO 8601 UTC timestamp");

const EXECUTABLE_MATERIAL_TEXT_PATTERN =
  /transaction\s*bytes?|transactionBytes|tx\s*bytes?|serialized\s*transaction|serializedTransaction|signed\s*transaction|signing\s*request|signingRequest|wallet\s*authorization|walletAuthorization|private\s*key|privateKey|secret\s*key|secretKey|seed\s*phrase|mnemonic|suiprivkey|signature|route[-_\s]*selected|routeSelectedPlan|bcs\s*transaction|programmable\s*transaction/i;
const LONG_HEX_OR_BASE64LIKE_PAYLOAD_PATTERN = /(?:0x[0-9a-fA-F]{160,}|[A-Za-z0-9+/_=-]{160,})/;
const SUI_PRIVATE_KEY_CANDIDATE_PATTERN = /suiprivkey1[023456789acdefghjklmnpqrstuvwxyz]+/gi;
const RAW_SECRET_HEX_PATTERN = /(^|[^0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}($|[^0-9a-fA-F])/;
const RAW_SECRET_BASE64_PATTERN = /(^|[^A-Za-z0-9+/_=-])(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9+/]{44}|[A-Za-z0-9_-]{43,44})($|[^A-Za-z0-9+/_=-])/;
const POSITIVE_DECIMAL_DISPLAY_AMOUNT_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const BIP39_WORD_COUNTS = [12, 15, 18, 21, 24] as const;

type ProposalTextSchemaOptions = {
  allowRawSecretLikeText?: boolean;
};

function proposalTextSchema(
  maxLength: number,
  fieldName: string,
  options: ProposalTextSchemaOptions = {}
) {
  return z.string().min(1).max(maxLength).superRefine((value, ctx) => {
    if (
      EXECUTABLE_MATERIAL_TEXT_PATTERN.test(value) ||
      LONG_HEX_OR_BASE64LIKE_PAYLOAD_PATTERN.test(value) ||
      containsSuiPrivateKeyMaterial(value) ||
      containsValidEnglishBip39Mnemonic(value) ||
      (!options.allowRawSecretLikeText && containsRawSecretLikeText(value))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `${fieldName} must not contain executable, signing, private-key, mnemonic, route-selected, or encoded secret-like material`
      });
    }
  });
}

function identifierTextSchema(maxLength: number, fieldName: string) {
  return proposalTextSchema(maxLength, fieldName, { allowRawSecretLikeText: true });
}

function containsSuiPrivateKeyMaterial(value: string): boolean {
  const matches = value.match(SUI_PRIVATE_KEY_CANDIDATE_PATTERN) ?? [];
  return matches.some((candidate) => {
    try {
      decodeSuiPrivateKey(candidate.toLowerCase());
      return true;
    } catch {
      return candidate.toLowerCase().startsWith("suiprivkey1");
    }
  });
}

function containsValidEnglishBip39Mnemonic(value: string): boolean {
  const words = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  for (const wordCount of BIP39_WORD_COUNTS) {
    if (words.length < wordCount) {
      continue;
    }
    for (let index = 0; index <= words.length - wordCount; index += 1) {
      if (validateMnemonic(words.slice(index, index + wordCount).join(" "), englishBip39Wordlist)) {
        return true;
      }
    }
  }
  return false;
}

function containsRawSecretLikeText(value: string): boolean {
  return RAW_SECRET_HEX_PATTERN.test(value) || RAW_SECRET_BASE64_PATTERN.test(value);
}

const proposalDisplayAmountSchema = proposalTextSchema(80, "amountDisplay").refine(
  (value) =>
    POSITIVE_DECIMAL_DISPLAY_AMOUNT_PATTERN.test(value) &&
    /[1-9]/.test(value),
  {
    message: "Expected a positive decimal display amount"
  }
);

const externalProposalSourceSchema = z.object({
  kind: z.enum(["mcp_server", "ai_client", "user", "other"]),
  name: proposalTextSchema(120, "source.name"),
  reference: proposalTextSchema(256, "source.reference").optional()
}).strict();

const externalProposalPartySchema = z.object({
  address: suiAddressStringSchema.optional(),
  label: proposalTextSchema(120, "party.label").optional()
}).strict().refine((party) => party.address !== undefined || party.label !== undefined, {
  message: "Expected address or label"
});

const externalProposalAssetAmountSchema = z.object({
  amountDisplay: proposalDisplayAmountSchema,
  amountKind: z.literal("display_proposal").default("display_proposal"),
  symbol: proposalTextSchema(64, "amount.symbol").optional(),
  coinType: identifierTextSchema(512, "amount.coinType").optional(),
  denomination: proposalTextSchema(64, "amount.denomination").optional()
}).strict();

const externalProposalActionTargetSchema = z.object({
  packageId: identifierTextSchema(128, "action.target.packageId").optional(),
  module: proposalTextSchema(128, "action.target.module").optional(),
  function: proposalTextSchema(128, "action.target.function").optional(),
  objectId: identifierTextSchema(128, "action.target.objectId").optional(),
  label: proposalTextSchema(120, "action.target.label").optional()
}).strict().refine(
  (target) =>
    target.packageId !== undefined ||
    target.module !== undefined ||
    target.function !== undefined ||
    target.objectId !== undefined ||
    target.label !== undefined,
  { message: "Expected at least one action target field" }
);

const externalProposalAssetFlowItemSchema = z.object({
  direction: z.enum(["outgoing", "expected_incoming", "fee"]),
  amount: externalProposalAssetAmountSchema,
  recipient: externalProposalPartySchema.optional(),
  description: proposalTextSchema(512, "assetFlow.description").optional()
}).strict();

const externalProposalBaseSchema = z.object({
  id: proposalTextSchema(120, "proposal.id"),
  source: externalProposalSourceSchema,
  network: z.literal("sui:mainnet"),
  createdAt: isoUtcStringSchema,
  expiresAt: isoUtcStringSchema.optional(),
  purpose: proposalTextSchema(512, "purpose"),
  assumptions: z.array(proposalTextSchema(512, "assumptions[]")).max(20).optional(),
  requiredUserChoices: z.array(proposalTextSchema(512, "requiredUserChoices[]")).max(20).optional()
}).strict();

const externalPaymentProposalSchema = externalProposalBaseSchema.extend({
  type: z.literal("payment"),
  payment: z.object({
    amount: externalProposalAssetAmountSchema,
    recipient: externalProposalPartySchema,
    target: proposalTextSchema(512, "payment.target").optional()
  }).strict()
}).strict();

const externalSuiActionProposalSchema = externalProposalBaseSchema.extend({
  type: z.literal("sui_action"),
  action: z.object({
    actionKind: proposalTextSchema(120, "action.actionKind"),
    target: externalProposalActionTargetSchema,
    recipient: externalProposalPartySchema.optional(),
    assetFlow: z.array(externalProposalAssetFlowItemSchema).max(20).optional()
  }).strict()
}).strict();

export const externalProposalSchema = z.discriminatedUnion("type", [
  externalPaymentProposalSchema,
  externalSuiActionProposalSchema
]);

const proposalReviewCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "warning", "fail"]),
  message: z.string(),
  source: z.enum(["proposal", "adapter", "registry", "quote", "wallet", "simulation", "network"])
}).strict();

const proposalReviewGapSchema = z.object({
  id: z.string(),
  label: z.string(),
  reason: z.string()
}).strict();

export const proposalReviewModelSchema = z.object({
  modelVersion: z.literal(PROPOSAL_REVIEW_MODEL_VERSION),
  contractVersion: z.literal(EXTERNAL_PROPOSAL_CONTRACT_VERSION),
  proposalId: z.string(),
  proposalType: z.enum(["payment", "sui_action"]),
  proposalSource: externalProposalSourceSchema,
  proposedAction: z.object({
    kind: z.enum(["payment", "sui_action"]),
    title: z.string(),
    purpose: z.string(),
    network: z.literal("sui:mainnet"),
    recipient: externalProposalPartySchema.optional(),
    target: z.union([z.string(), externalProposalActionTargetSchema]).optional()
  }).strict(),
  assetFlow: z.object({
    outgoing: z.array(externalProposalAssetAmountSchema),
    expectedIncoming: z.array(externalProposalAssetAmountSchema),
    fees: z.array(externalProposalAssetAmountSchema)
  }).strict(),
  recipients: z.array(externalProposalPartySchema),
  targets: z.array(z.union([z.string(), externalProposalActionTargetSchema])),
  evidenceUsed: z.array(z.object({
    id: z.string(),
    label: z.string(),
    source: z.enum(["external_proposal", "local_schema"]),
    summary: z.string()
  }).strict()),
  missingEvidence: z.array(proposalReviewGapSchema),
  requiredUserChoices: z.array(proposalReviewGapSchema),
  unsupportedClaims: z.array(z.object({
    id: z.string(),
    label: z.string(),
    reason: z.string()
  }).strict()),
  rejectedExecutableFields: z.array(z.object({
    fieldName: z.string(),
    reason: z.string()
  }).strict()),
  freshness: z.object({
    proposalCreatedAt: isoUtcStringSchema,
    proposalExpiresAt: isoUtcStringSchema.optional(),
    evaluatedAt: isoUtcStringSchema,
    status: z.enum(["current", "expired", "created_in_future", "expiry_not_provided"]),
    reason: z.string()
  }).strict(),
  blockingChecks: z.array(proposalReviewCheckSchema),
  nonSignableReason: z.object({
    code: z.literal("external_proposal_review_only"),
    message: z.string(),
    blockedCapabilities: z.array(z.string())
  }).strict()
}).strict();

export const externalProposalActionPlanDataSchema = z.object({
  requestedIntent: externalProposalSchema,
  implementationStatus: z.literal("read_only_review_only"),
  contractVersion: z.literal(EXTERNAL_PROPOSAL_CONTRACT_VERSION)
}).strict();

export type ExternalProposalInput = z.input<typeof externalProposalSchema>;
