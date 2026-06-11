import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  EXTERNAL_ACTIVITY_SCAN_MAX_LIMIT,
  REVIEW_ACTIVITY_LIST_MAX_LIMIT,
  REVIEW_ACTIVITY_LOW_SAMPLE_THRESHOLD
} from "../../../core/activity/activityStore.js";
import {
  externalActivityGasCostFactSchema,
  externalActivityTransactionCompactFactsSchema,
  externalActivityTransactionDetailSchema
} from "../../../core/activity/transactionActivityDetails.js";
import type {
  ScanSuiAccountActivityResult,
  ScanSuiFunctionActivityResult,
  SuiTransactionActivityFact,
  SummarizeSuiActivityScanResult,
  SummarizeSuiFunctionActivityScanResult
} from "../../../core/activity/transactionActivityTypes.js";
import { suiActivityAnalysisLimitations } from "../../../core/activity/transactionActivityAnalysis.js";
import { suiTransactionDigestSchema } from "../../../core/suiAddress.js";
import { okToolResult } from "../../result.js";
import { successOutputSchema } from "../../schemas.js";
import type { McpServerDeps } from "../../server.js";
import { transactionActivityToolError } from "../../toolErrors.js";
import { TOOL_NAMES } from "../../toolNames.js";
import {
  fetchedAtSchema,
  reviewActivityAccountSourceSchema,
  reviewActivityDataScopeSchema,
  reviewActivityInputSchema,
  userAnswerUseSchema
} from "./commonSchemas.js";
import {
  externalActivityTransactionRecordOutput,
  inspectSuiTransactionUserAnswerUse,
  liveSuiActivityUserAnswerUse,
  requestedAccountTransactionFactOutput,
  storedSuiActivityUserAnswerUse,
  suiActivityQuantitySemantics,
  transactionDetailAvailability,
  transactionFactAuditOutput,
  transactionFactOutput
} from "./transactionActivityOutput.js";

const transactionDigestSchema = suiTransactionDigestSchema;
const externalActivityRelationshipSchema = z.enum(["affected", "sent"]);
const externalActivityStatusSchema = z.enum(["success", "failure", "unknown"]);
const externalActivityScanIncompleteReasonSchema = z.enum([
  "limit_reached",
  "ordering_unverified",
  "cursor_invalid",
  "provider_error"
]);
const suiActivityScanInputSchema = {
  account: z.string().min(1).optional(),
  relationship: externalActivityRelationshipSchema.optional(),
  limit: z.number().int().min(1).max(EXTERNAL_ACTIVITY_SCAN_MAX_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
  fromCheckpoint: z.string().regex(/^\d+$/).optional(),
  toCheckpoint: z.string().regex(/^\d+$/).optional(),
  fromTimestamp: fetchedAtSchema.optional(),
  toTimestamp: fetchedAtSchema.optional()
};
const suiFunctionActivityScanInputSchema = {
  function: z.string().min(1),
  account: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(EXTERNAL_ACTIVITY_SCAN_MAX_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
  fromCheckpoint: z.string().regex(/^\d+$/).optional(),
  toCheckpoint: z.string().regex(/^\d+$/).optional(),
  fromTimestamp: fetchedAtSchema.optional(),
  toTimestamp: fetchedAtSchema.optional()
};

const suiTransactionActivitySourceSchema = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("graphql"),
    endpointHost: z.string(),
    chainIdentifier: z.string(),
    method: z.enum(["Query.transaction", "Query.transactions"])
  }),
  z.object({
    transport: z.literal("local_db"),
    method: z.literal("stored_normalized_facts")
  })
]);

const accountBalanceChangeCompletenessSchema = z.enum(["complete", "truncated", "unavailable"]);
const accountBalanceChangeEvidenceSchema = z.enum([
  "account_balance_changes_returned",
  "no_account_balance_changes_returned",
  "incomplete_account_balance_changes",
  "account_balance_changes_unavailable"
]);
const accountBalanceChangeInferencePolicySchema = z.enum([
  "use_returned_account_balance_changes",
  "account_absence_proven_by_complete_details",
  "do_not_infer_from_transaction_context"
]);
const transactionAccountRoleSchema = z.enum(["sender", "affected_only"]);
const transactionAccountEffectLimitationSchema = z.enum([
  "provider_balance_changes_truncated",
  "transaction_details_unavailable"
]);

const requestedAccountCoinFlowSchema = z.object({
  coinType: z.string(),
  increaseRaw: z.string().regex(/^\d+$/),
  decreaseRaw: z.string().regex(/^\d+$/),
  netRaw: z.string().regex(/^-?\d+$/),
  transactionCount: z.number().int().positive()
}).strict();

const transactionAccountEffectsSchema = z.object({
  account: z.string(),
  scope: z.literal("requested_account"),
  role: transactionAccountRoleSchema,
  sentByAccount: z.boolean(),
  balanceChangeEvidence: accountBalanceChangeEvidenceSchema,
  accountBalanceChangeAbsenceProven: z.boolean(),
  accountBalanceChangeInferencePolicy: accountBalanceChangeInferencePolicySchema,
  balanceChangeCompleteness: accountBalanceChangeCompletenessSchema,
  balanceChanges: z.array(z.object({
    index: z.number().int().nonnegative(),
    coinType: z.string(),
    amountRaw: z.string().regex(/^-?\d+$/),
    direction: z.enum(["increase", "decrease", "zero"])
  }).strict()),
  coinFlows: z.array(z.object({
    coinType: z.string(),
    increaseRaw: z.string().regex(/^\d+$/),
    decreaseRaw: z.string().regex(/^\d+$/),
    netRaw: z.string().regex(/^-?\d+$/)
  }).strict()),
  limitations: z.array(transactionAccountEffectLimitationSchema)
}).strict();

const requestedAccountActivitySchema = z.object({
  account: z.string(),
  relationship: externalActivityRelationshipSchema,
  sentCount: z.number().int().nonnegative(),
  affectedOnlyCount: z.number().int().nonnegative(),
  balanceChangeCompleteness: accountBalanceChangeCompletenessSchema,
  coinFlows: z.array(requestedAccountCoinFlowSchema)
}).strict();

const suiActivityQuantitySemanticsSchema = z.object({
  kind: z.literal("sui_activity_raw_amounts"),
  rawAmountsOnly: z.literal(true),
  displayConversionRequires: z.literal("verified_coin_metadata_decimals"),
  gasRawUnit: z.literal("MIST"),
  gasUnitSource: z.literal("@mysten/sui MIST_PER_SUI"),
  gasDisplayFields: z.tuple([
    z.literal("transaction.compact.gasCost.display"),
    z.literal("requestedAccountTransactionFacts[].transactionContext.gasCost.display"),
    z.literal("transactions[].transactionContext.gasCost.display"),
    z.literal("analysis.gas.netGasCost.display")
  ]),
  rawAmountFields: z.tuple([
    z.literal("transaction.details.balanceChanges[].amountRaw"),
    z.literal("transaction.requestedAccountEffect.balanceChanges[].amountRaw"),
    z.literal("transaction.requestedAccountEffect.coinFlows[].*Raw"),
    z.literal("requestedAccount.coinFlows[].*Raw"),
    z.literal("requestedAccountTransactionFacts[].accountBalanceChanges[].amountRaw"),
    z.literal("requestedAccountTransactionFacts[].accountCoinFlows[].*Raw"),
    z.literal("requestedAccountTransactionFacts[].requestedAccountEffect.balanceChanges[].amountRaw"),
    z.literal("requestedAccountTransactionFacts[].requestedAccountEffect.coinFlows[].*Raw"),
    z.literal("transactions[].requestedAccountEffect.balanceChanges[].amountRaw"),
    z.literal("transactions[].requestedAccountEffect.coinFlows[].*Raw"),
    z.literal("transactions[].details.balanceChanges[].amountRaw"),
    z.literal("transactions[].compact.balanceChanges[].amountRaw"),
    z.literal("analysis.coinFlows[].*Raw")
  ]),
  notFor: z.tuple([
    z.literal("display_conversion_without_verified_decimals"),
    z.literal("fiat_usd_cash_out"),
    z.literal("profit_or_pnl"),
    z.literal("position_valuation")
  ])
}).strict();

const suiTransactionFactSchema = z.object({
  digest: z.string(),
  checkpoint: z.string().optional(),
  timestamp: fetchedAtSchema.optional(),
  status: externalActivityStatusSchema,
  sender: z.string().optional(),
  requestedAccountEffect: transactionAccountEffectsSchema.optional(),
  compact: externalActivityTransactionCompactFactsSchema.optional(),
  details: externalActivityTransactionDetailSchema.optional()
});

const requestedAccountTransactionContextSchema = externalActivityTransactionCompactFactsSchema.omit({
  balanceChanges: true
});

const suiTransactionAuditFactSchema = z.object({
  digest: z.string(),
  checkpoint: z.string().optional(),
  timestamp: fetchedAtSchema.optional(),
  status: externalActivityStatusSchema,
  sender: z.string().optional(),
  requestedAccountEffect: transactionAccountEffectsSchema.optional(),
  transactionContext: requestedAccountTransactionContextSchema.optional(),
  detailLookup: z.object({
    tool: z.literal("read.inspect_sui_transaction"),
    digest: z.string()
  })
});

const requestedAccountTransactionFactSchema = z.object({
  digest: z.string(),
  checkpoint: z.string().optional(),
  timestamp: fetchedAtSchema.optional(),
  status: externalActivityStatusSchema,
  sender: z.string().optional(),
  requestedAccount: z.string(),
  accountScope: z.literal("requested_account"),
  accountRole: transactionAccountRoleSchema,
  sentByAccount: z.boolean(),
  accountBalanceChangeEvidence: accountBalanceChangeEvidenceSchema,
  accountBalanceChangeAbsenceProven: z.boolean(),
  accountBalanceChangeInferencePolicy: accountBalanceChangeInferencePolicySchema,
  accountBalanceChangeCompleteness: accountBalanceChangeCompletenessSchema,
  accountBalanceChanges: transactionAccountEffectsSchema.shape.balanceChanges,
  accountCoinFlows: transactionAccountEffectsSchema.shape.coinFlows,
  accountEffectLimitations: z.array(transactionAccountEffectLimitationSchema),
  requestedAccountEffect: transactionAccountEffectsSchema,
  transactionContext: requestedAccountTransactionContextSchema.optional(),
  detailLookup: z.object({
    tool: z.literal("read.inspect_sui_transaction"),
    digest: z.string()
  })
});

const suiActivityAnalysisSchema = z.object({
  overview: z.object({
    transactionCount: z.number().int().nonnegative(),
    analyzedTransactionCount: z.number().int().nonnegative(),
    statusCounts: z.object({
      success: z.number().int().nonnegative(),
      failure: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative()
    }).strict(),
    relationshipCounts: z.object({
      affected: z.number().int().nonnegative(),
      sent: z.number().int().nonnegative()
    }).strict(),
    earliestTimestamp: fetchedAtSchema.optional(),
    latestTimestamp: fetchedAtSchema.optional(),
    earliestCheckpoint: z.string().optional(),
    latestCheckpoint: z.string().optional()
  }).strict(),
  moveCallTargets: z.array(z.object({
    target: z.string(),
    count: z.number().int().positive()
  }).strict()),
  protocols: z.array(z.object({
    protocolId: z.string(),
    displayName: z.string().optional(),
    count: z.number().int().positive()
  }).strict()),
  coinFlows: z.array(z.object({
    coinType: z.string(),
    increaseRaw: z.string().regex(/^\d+$/),
    decreaseRaw: z.string().regex(/^\d+$/),
    netRaw: z.string().regex(/^-?\d+$/),
    transactionCount: z.number().int().positive()
  }).strict()),
  objectChanges: z.object({
    created: z.number().int().nonnegative(),
    mutated: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative()
  }).strict(),
  eventTypes: z.array(z.object({
    eventType: z.string(),
    count: z.number().int().positive()
  }).strict()),
  gas: z.object({
    transactionCount: z.number().int().positive(),
    netGasCostRaw: z.string().regex(/^-?\d+$/),
    netGasCost: externalActivityGasCostFactSchema
  }).strict().optional(),
  failures: z.array(z.object({
    message: z.string(),
    count: z.number().int().positive(),
    abortCodeRaw: z.string().regex(/^\d+$/).optional(),
    package: z.string().optional(),
    module: z.string().optional(),
    function: z.string().optional()
  }).strict()),
  limitations: z.array(z.enum(suiActivityAnalysisLimitations))
}).strict();

const externalActivityScanRecordSchema = z.object({
  scanId: z.string(),
  kind: z.enum(["digest_lookup", "account_scan", "function_scan"]),
  accountId: z.number().int().positive(),
  account: z.string(),
  relationship: externalActivityRelationshipSchema,
  inputDigest: z.string().optional(),
  fromCheckpoint: z.string().optional(),
  toCheckpoint: z.string().optional(),
  fromTimestamp: fetchedAtSchema.optional(),
  toTimestamp: fetchedAtSchema.optional(),
  limit: z.number().int().min(1).max(EXTERNAL_ACTIVITY_SCAN_MAX_LIMIT),
  requestCursor: z.string().optional(),
  responseCursor: z.string().optional(),
  endpointHost: z.string(),
  chainIdentifier: z.string(),
  fetchedAt: fetchedAtSchema,
  storedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  windowComplete: z.boolean().nullable(),
  incompleteReason: externalActivityScanIncompleteReasonSchema.optional()
});

const externalActivityTransactionRecordSchema = z.object({
  accountId: z.number().int().positive(),
  account: z.string(),
  digest: z.string(),
  relationship: externalActivityRelationshipSchema,
  checkpoint: z.string().optional(),
  timestamp: fetchedAtSchema.optional(),
  status: externalActivityStatusSchema,
  knownSenderAccountId: z.number().int().positive().optional(),
  firstScanId: z.string(),
  lastScanId: z.string(),
  firstFetchedAt: fetchedAtSchema,
  lastFetchedAt: fetchedAtSchema,
  lastScanIncompleteReason: externalActivityScanIncompleteReasonSchema.optional(),
  compact: externalActivityTransactionCompactFactsSchema.optional(),
  details: externalActivityTransactionDetailSchema.optional(),
  detailLookup: z.object({
    tool: z.literal("read.inspect_sui_transaction"),
    digest: z.string()
  }).optional()
});

const transactionDetailAvailabilitySchema = z.object({
  totalTransactions: z.number().int().nonnegative(),
  withDetails: z.number().int().nonnegative(),
  withoutDetails: z.number().int().nonnegative(),
  detailAvailability: z.enum(["none", "some", "all"]),
  allReturnedTransactionsHaveDetails: z.boolean()
}).strict();

const liveActivityScanPersistenceSchema = z.object({
  stored: z.boolean(),
  reason: z.enum(["account_not_known"]).optional(),
  scan: externalActivityScanRecordSchema.optional()
});

const liveActivityScanOutputBase = {
  status: z.literal("ok"),
  fetchedAt: fetchedAtSchema,
  account: z.string(),
  accountKnown: z.boolean(),
  accountSource: reviewActivityAccountSourceSchema,
  relationship: externalActivityRelationshipSchema,
  userAnswerUse: userAnswerUseSchema,
  requestedAccount: requestedAccountActivitySchema,
  requestedAccountTransactionFacts: z.array(requestedAccountTransactionFactSchema),
  transactionDetailAvailability: transactionDetailAvailabilitySchema,
  quantitySemantics: suiActivityQuantitySemanticsSchema,
  source: suiTransactionActivitySourceSchema,
  hasMore: z.boolean(),
  continuationCursor: z.string().optional(),
  windowComplete: z.boolean().nullable(),
  orderingVerified: z.boolean(),
  incompleteReason: externalActivityScanIncompleteReasonSchema.optional(),
  persistence: liveActivityScanPersistenceSchema
};

const liveFunctionActivityScanOutputBase = {
  ...liveActivityScanOutputBase,
  function: z.string(),
  relationship: z.literal("sent")
};

export function registerTransactionActivityTools(server: McpServer, deps: McpServerDeps): void {
  server.registerTool(
    TOOL_NAMES.readInspectSuiTransaction,
    {
      title: "Inspect Sui transaction",
      description: "Lookup one Sui transaction digest. Stores only when sender or balance owner matches a known local wallet.",
      inputSchema: {
        digest: transactionDigestSchema,
        account: z.string().min(1).optional()
      },
      outputSchema: successOutputSchema({
        status: z.literal("ok"),
        fetchedAt: fetchedAtSchema,
        source: suiTransactionActivitySourceSchema,
        userAnswerUse: userAnswerUseSchema,
        quantitySemantics: suiActivityQuantitySemanticsSchema,
        transaction: suiTransactionFactSchema,
        persistence: z.object({
          stored: z.boolean(),
          reason: z.enum(["no_known_wallet_relation", "transaction_not_found"]).optional(),
          account: z.string().optional(),
          relationship: externalActivityRelationshipSchema.optional(),
          scan: externalActivityScanRecordSchema.optional()
        })
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async ({ digest, account }) => {
      try {
        const result = await deps.transactionActivityService.inspectSuiTransaction({ digest, account });
        const transaction = transactionFactOutput(result.transaction);
        return okToolResult({
          ...result,
          userAnswerUse: inspectSuiTransactionUserAnswerUse({
            hasSender: transaction.sender !== undefined,
            hasRequestedAccountEffect: transaction.requestedAccountEffect !== undefined,
            hasDetails: transaction.details !== undefined
          }),
          quantitySemantics: suiActivityQuantitySemantics(),
          transaction
        });
      } catch (error) {
        return transactionActivityToolError(error, deps.logger);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.readScanSuiAccountActivity,
    {
      title: "Scan Sui account activity rows",
      description: "Bounded GraphQL account activity scan with requested-account facts and digest detail lookups. Not background indexing or complete history.",
      inputSchema: suiActivityScanInputSchema,
      outputSchema: successOutputSchema({
        ...liveActivityScanOutputBase,
        transactions: z.array(suiTransactionAuditFactSchema),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async (input) => {
      try {
        const result = await deps.transactionActivityService.scanSuiAccountActivity(input);
        return okToolResult(liveActivityScanToolOutput(result, transactionFactAuditOutput));
      } catch (error) {
        return transactionActivityToolError(error, deps.logger);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.readScanSuiFunctionActivity,
    {
      title: "Scan sent Sui function activity rows",
      description: "Bounded GraphQL scan for transactions the account sent that called one full package::module::function. Returns requested-account facts and digest detail lookups.",
      inputSchema: suiFunctionActivityScanInputSchema,
      outputSchema: successOutputSchema({
        ...liveFunctionActivityScanOutputBase,
        transactions: z.array(suiTransactionAuditFactSchema),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async (input) => {
      try {
        const result = await deps.transactionActivityService.scanSuiFunctionActivity(input);
        return okToolResult(liveActivityScanToolOutput(result, transactionFactAuditOutput));
      } catch (error) {
        return transactionActivityToolError(error, deps.logger);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.readSummarizeSuiAccountActivity,
    {
      title: "Summarize Sui account activity",
      description: "Summarize stored normalized Sui activity facts. Not complete history or P&L.",
      inputSchema: {
        ...reviewActivityInputSchema,
        limit: z.number().int().min(1).max(REVIEW_ACTIVITY_LIST_MAX_LIMIT).optional()
      },
      outputSchema: successOutputSchema({
        status: z.literal("ok"),
        dataScope: reviewActivityDataScopeSchema,
        accountSource: reviewActivityAccountSourceSchema,
        userAnswerUse: userAnswerUseSchema,
        quantitySemantics: suiActivityQuantitySemanticsSchema,
        lowSampleWarning: z.boolean(),
        lowSampleThreshold: z.literal(REVIEW_ACTIVITY_LOW_SAMPLE_THRESHOLD),
        truncated: z.boolean(),
        source: suiTransactionActivitySourceSchema,
        summary: z.object({
          transactionCount: z.number().int().nonnegative(),
          statusCounts: z.object({
            success: z.number().int().nonnegative(),
            failure: z.number().int().nonnegative(),
            unknown: z.number().int().nonnegative()
          }),
          relationshipCounts: z.object({
            affected: z.number().int().nonnegative(),
            sent: z.number().int().nonnegative()
          }),
          earliestTimestamp: fetchedAtSchema.optional(),
          latestTimestamp: fetchedAtSchema.optional()
        }),
        analysis: suiActivityAnalysisSchema,
        transactionDetailAvailability: transactionDetailAvailabilitySchema,
        transactions: z.array(externalActivityTransactionRecordSchema)
      }),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ account, from, to, limit }) => {
      try {
        const summary = await deps.transactionActivityService.summarizeSuiAccountActivity({
          account,
          from,
          to,
          limit
        });
        const detailAvailability = transactionDetailAvailability(summary.transactions);
        return okToolResult({
          ...summary,
          userAnswerUse: storedSuiActivityUserAnswerUse(detailAvailability),
          quantitySemantics: suiActivityQuantitySemantics(),
          source: {
            transport: "local_db",
            method: "stored_normalized_facts"
          },
          transactionDetailAvailability: detailAvailability,
          transactions: summary.transactions.map(externalActivityTransactionRecordOutput)
        });
      } catch (error) {
        return transactionActivityToolError(error, deps.logger);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.readSummarizeSuiActivityScan,
    {
      title: "Summarize Sui activity scan",
      description: "Bounded GraphQL account activity summary with requested-account facts and deterministic normalized-fact analysis. Not complete history or P&L.",
      inputSchema: suiActivityScanInputSchema,
      outputSchema: successOutputSchema({
        ...liveActivityScanOutputBase,
        analysis: suiActivityAnalysisSchema,
        transactions: z.array(suiTransactionAuditFactSchema),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async (input) => {
      try {
        const result = await deps.transactionActivityService.summarizeSuiActivityScan(input);
        return okToolResult(liveActivityScanToolOutput(result, transactionFactAuditOutput));
      } catch (error) {
        return transactionActivityToolError(error, deps.logger);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.readSummarizeSuiFunctionActivityScan,
    {
      title: "Summarize sent Sui function activity",
      description: "Bounded sent-function activity summary with requested-account facts and deterministic normalized-fact analysis. Not route, P&L, or position analysis.",
      inputSchema: suiFunctionActivityScanInputSchema,
      outputSchema: successOutputSchema({
        ...liveFunctionActivityScanOutputBase,
        analysis: suiActivityAnalysisSchema,
        transactions: z.array(suiTransactionAuditFactSchema),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async (input) => {
      try {
        const result = await deps.transactionActivityService.summarizeSuiFunctionActivityScan(input);
        return okToolResult(liveActivityScanToolOutput(result, transactionFactAuditOutput));
      } catch (error) {
        return transactionActivityToolError(error, deps.logger);
      }
    }
  );
}

type LiveActivityScanToolResult =
  | ScanSuiAccountActivityResult
  | ScanSuiFunctionActivityResult
  | SummarizeSuiActivityScanResult
  | SummarizeSuiFunctionActivityScanResult;

function liveActivityScanToolOutput<TTransactionOutput>(
  result: LiveActivityScanToolResult,
  transactionOutput: (transaction: SuiTransactionActivityFact) => TTransactionOutput
) {
  const detailAvailability = transactionDetailAvailability(result.transactions);
  return {
    status: result.status,
    fetchedAt: result.fetchedAt,
    account: result.account,
    accountKnown: result.accountKnown,
    accountSource: result.accountSource,
    ...("function" in result ? { function: result.function } : {}),
    relationship: result.relationship,
    userAnswerUse: liveSuiActivityUserAnswerUse({
      includeAnalysis: "analysis" in result,
      transactionDetailAvailability: detailAvailability
    }),
    requestedAccount: result.requestedAccount,
    requestedAccountTransactionFacts: requestedAccountTransactionFacts(result.transactions),
    transactionDetailAvailability: detailAvailability,
    quantitySemantics: suiActivityQuantitySemantics(),
    source: result.source,
    ...("analysis" in result ? { analysis: result.analysis } : {}),
    transactions: result.transactions.map(transactionOutput),
    hasMore: result.hasMore,
    ...(result.continuationCursor === undefined ? {} : { continuationCursor: result.continuationCursor }),
    windowComplete: result.windowComplete,
    orderingVerified: result.orderingVerified,
    ...(result.incompleteReason === undefined ? {} : { incompleteReason: result.incompleteReason }),
    persistence: result.persistence
  };
}

function requestedAccountTransactionFacts(
  transactions: Parameters<typeof requestedAccountTransactionFactOutput>[0][]
) {
  return transactions.flatMap((transaction) => {
    const fact = requestedAccountTransactionFactOutput(transaction);
    return fact === undefined ? [] : [fact];
  });
}
