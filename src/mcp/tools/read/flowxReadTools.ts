import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FLOWX_CLMM_MAINNET,
  FLOWX_CLMM_PROTOCOL_ID,
  FLOWX_CLMM_UNIT_SOURCE,
  FLOWX_SWAP_QUOTE_QUANTITY_KIND,
  listFlowxPoolRegistry
} from "../../../core/read/readService.js";
import { noParamsInputSchema, successOutputSchema } from "../../schemas.js";
import { okToolResult } from "../../result.js";
import type { McpServerDeps } from "../../server.js";
import { TOOL_NAMES } from "../../toolNames.js";
import { fetchedAtSchema, userAnswerUseSchema } from "./commonSchemas.js";
import { readServiceError } from "./readToolHelpers.js";

const flowxPoolRegistryEntrySchema = z.object({
  poolKey: z.string(),
  poolId: z.string(),
  symbolX: z.string(),
  symbolY: z.string(),
  coinTypeX: z.string(),
  coinTypeY: z.string(),
  decimalsX: z.number().int().nonnegative(),
  decimalsY: z.number().int().nonnegative(),
  feeRate: z.number().int().nonnegative(),
  tickSpacing: z.number().int().positive(),
  unitSource: z.literal(FLOWX_CLMM_UNIT_SOURCE)
});

const flowxQuoteSourceSchema = z.object({
  sdk: z.literal("@flowx-finance/sdk"),
  transport: z.literal("https"),
  method: z.literal("AggregatorQuoter.getRoutes"),
  chainVerified: z.literal(false)
});

const flowxQuoteAmountSchema = z.object({
  raw: z.string().regex(/^\d+$/),
  display: z.string().regex(/^\d+(?:\.\d+)?$/),
  decimals: z.number().int().nonnegative()
});

const flowxRouteEvidenceSchema = z.object({
  kind: z.literal("flowx_aggregator_route"),
  routeSource: z.literal("flowx_quoter_api"),
  routeChosenBy: z.literal("flowx_router_not_this_server"),
  singleHop: z.literal(true),
  pools: z.array(
    z.object({
      poolKey: z.string(),
      poolId: z.string(),
      feeRate: z.number().int().nonnegative(),
      tickSpacing: z.number().int().positive(),
      swapXToY: z.boolean()
    })
  ),
  protocolConfigPinMatch: z.literal(true)
});

const flowxQuoteQuantitySemanticsSchema = z.object({
  kind: z.literal(FLOWX_SWAP_QUOTE_QUANTITY_KIND),
  inputAmountKind: z.literal("display_source_amount_converted_to_raw"),
  allowedUse: z.literal("indicative_flowx_route_quote"),
  rawAmountAvailable: z.literal(true),
  rawEvidenceField: z.literal("routeEvidence"),
  chainVerified: z.literal(false),
  paymentCoverageAvailable: z.literal(false),
  shortfallContributionAvailable: z.literal(false),
  routeDependentPaymentSupportAvailable: z.literal(false),
  requiresIntentEvidenceForCoverage: z.literal(true),
  canUseForPaymentAnswer: z.literal(false),
  canUseForShortfallAnswer: z.literal(false),
  doNotCombineWithPaymentAnswer: z.literal(true),
  requiredPaymentAnswerTool: z.literal("read.preview_intent_evidence"),
  paymentAnswerUseBlockedReason: z.literal("quote_output_is_price_reference_not_payment_answer"),
  requiredPaymentAnswerField: z.literal("responseSummary"),
  fiatUsdCashOutAvailable: z.literal(false),
  externalMarketPriceConversionAvailable: z.literal(false),
  externalMarketLookupAvailable: z.literal(false),
  usdPegAssumptionAvailable: z.literal(false),
  bankCashOutEstimateAvailable: z.literal(false),
  profitAndLossAvailable: z.literal(false),
  costBasisAvailable: z.literal(false),
  priceImpactAvailable: z.literal(false),
  midPriceSlippageAvailable: z.literal(false),
  venueComparisonAvailable: z.literal(false),
  routeRecommendationAvailable: z.literal(false),
  notFor: z.array(z.string()).min(1)
});

export function registerFlowxReadTools(server: McpServer, deps: McpServerDeps): void {
  server.registerTool(
    TOOL_NAMES.readListFlowxPools,
    {
      title: "List FlowX pools",
      description: "List pinned FlowX CLMM mainnet pools for supported pairs. Static registry only; not live liquidity, pool ranking, or route advice.",
      inputSchema: noParamsInputSchema,
      outputSchema: successOutputSchema({
        protocolId: z.literal(FLOWX_CLMM_PROTOCOL_ID),
        source: z.string(),
        currentPackageId: z.string(),
        poolRegistryObjectId: z.string(),
        feeRateDenominator: z.number().int().positive(),
        pools: z.array(flowxPoolRegistryEntrySchema)
      }),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () =>
      okToolResult({
        protocolId: FLOWX_CLMM_PROTOCOL_ID,
        source: "flowx pinned registry (chain-verified snapshot)",
        currentPackageId: FLOWX_CLMM_MAINNET.currentPackageId,
        poolRegistryObjectId: FLOWX_CLMM_MAINNET.poolRegistry.objectId,
        feeRateDenominator: FLOWX_CLMM_MAINNET.feeRateDenominator,
        pools: listFlowxPoolRegistry().map((pool) => ({ ...pool }))
      })
  );

  server.registerTool(
    TOOL_NAMES.readQuoteFlowxSwap,
    {
      title: "Quote FlowX swap",
      description: "Indicative FlowX route quote with the router-selected pool reported as evidence. Not min-out, price impact, route advice, payment coverage, or signing readiness.",
      inputSchema: {
        sourceSymbol: z.string().min(1),
        targetSymbol: z.string().min(1),
        amountDisplay: z.string().min(1)
      },
      outputSchema: successOutputSchema({
        status: z.literal("ok"),
        pair: z.object({
          sourceSymbol: z.string(),
          targetSymbol: z.string(),
          sourceCoinType: z.string(),
          targetCoinType: z.string()
        }),
        amountIn: flowxQuoteAmountSchema,
        amountOut: flowxQuoteAmountSchema.extend({ indicative: z.literal(true) }),
        routeEvidence: flowxRouteEvidenceSchema,
        fetchedAt: fetchedAtSchema,
        userAnswerUse: userAnswerUseSchema,
        quantitySemantics: flowxQuoteQuantitySemanticsSchema,
        source: flowxQuoteSourceSchema
      }),
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ sourceSymbol, targetSymbol, amountDisplay }) => {
      try {
        return okToolResult(
          await deps.readService.quoteFlowxSwap({
            sourceSymbol,
            targetSymbol,
            amountDisplay
          })
        );
      } catch (error) {
        return readServiceError(error, deps);
      }
    }
  );
}
