import { FLOWX_CLMM_MAINNET, getFlowxPoolById, type FlowxSwapPairResolution } from "./flowxRegistry.js";
import {
  FLOWX_SWAP_QUOTE_QUANTITY_KIND,
  ReadServiceInputError,
  type FlowxQuoteQuantitySemantics,
  type FlowxQuotedPoolEvidence,
  type FlowxRouteQuote
} from "./readServiceTypes.js";

export function flowxQuoteQuantitySemantics(): FlowxQuoteQuantitySemantics {
  return {
    kind: FLOWX_SWAP_QUOTE_QUANTITY_KIND,
    inputAmountKind: "display_source_amount_converted_to_raw",
    allowedUse: "indicative_flowx_route_quote",
    rawAmountAvailable: true,
    rawEvidenceField: "routeEvidence",
    chainVerified: false,
    paymentCoverageAvailable: false,
    shortfallContributionAvailable: false,
    routeDependentPaymentSupportAvailable: false,
    requiresIntentEvidenceForCoverage: true,
    canUseForPaymentAnswer: false,
    canUseForShortfallAnswer: false,
    doNotCombineWithPaymentAnswer: true,
    requiredPaymentAnswerTool: "read.preview_intent_evidence",
    paymentAnswerUseBlockedReason: "quote_output_is_price_reference_not_payment_answer",
    requiredPaymentAnswerField: "responseSummary",
    fiatUsdCashOutAvailable: false,
    externalMarketPriceConversionAvailable: false,
    externalMarketLookupAvailable: false,
    usdPegAssumptionAvailable: false,
    bankCashOutEstimateAvailable: false,
    profitAndLossAvailable: false,
    costBasisAvailable: false,
    priceImpactAvailable: false,
    midPriceSlippageAvailable: false,
    venueComparisonAvailable: false,
    routeRecommendationAvailable: false,
    notFor: [
      "signing",
      "funding",
      "payment_coverage",
      "shortfall_contribution",
      "route_dependent_payment_support",
      "route_liquidity",
      "min_out",
      "liquidity_verdict",
      "price_impact",
      "mid_price_slippage",
      "quote_vs_mid_slippage",
      "effective_price",
      "venue_comparison",
      "best_route",
      "route_recommendation",
      "transaction_building",
      "fiat_usd_cash_out",
      "external_market_price_conversion",
      "external_market_lookup",
      "usd_peg_assumption",
      "bank_cash_out_estimate",
      "profit_or_pnl",
      "cost_basis"
    ]
  };
}

/**
 * Validate a normalized FlowX quoter response against the pinned registry and
 * the requested pair. Every check fails closed: an unknown pool, a foreign
 * route source, a multi-hop path, an amount echo mismatch, or a drifted
 * protocol config pin stops the quote instead of being silently accepted.
 */
export function validateFlowxRouteQuote(input: {
  pair: FlowxSwapPairResolution;
  requestedAmountInRaw: string;
  quote: FlowxRouteQuote;
}): { pools: FlowxQuotedPoolEvidence[] } {
  const { pair, quote } = input;

  if (quote.amountInRaw !== input.requestedAmountInRaw) {
    throw new ReadServiceInputError("quote_unavailable", "FlowX quoter echoed a different input amount", {
      requested: input.requestedAmountInRaw,
      echoed: quote.amountInRaw
    });
  }

  const pools: FlowxQuotedPoolEvidence[] = [];
  for (const path of quote.paths) {
    if (path.source !== FLOWX_CLMM_MAINNET.quoterSource) {
      throw new ReadServiceInputError("quote_unavailable", "FlowX route includes a non-FlowX-CLMM source", {
        poolId: path.poolId,
        source: path.source
      });
    }
    const pinned = getFlowxPoolById(path.poolId);
    if (!pinned) {
      throw new ReadServiceInputError("quote_unavailable", "FlowX route uses a pool that is not in the pinned registry", {
        poolId: path.poolId,
        action: "regenerate_flowx_registry"
      });
    }
    if (path.swapXToY !== undefined && path.swapXToY !== pair.swapXToY) {
      throw new ReadServiceInputError("quote_unavailable", "FlowX route direction disagrees with the pinned pair orientation", {
        poolId: path.poolId,
        routeSwapXToY: path.swapXToY,
        pinnedSwapXToY: pair.swapXToY
      });
    }
    if (path.feeRate !== undefined && path.feeRate !== pinned.feeRate) {
      throw new ReadServiceInputError("quote_unavailable", "FlowX route fee disagrees with the pinned pool fee", {
        poolId: path.poolId,
        routeFeeRate: path.feeRate,
        pinnedFeeRate: pinned.feeRate
      });
    }
    pools.push({
      poolKey: pinned.poolKey,
      poolId: pinned.poolId,
      feeRate: pinned.feeRate,
      tickSpacing: pinned.tickSpacing,
      swapXToY: pair.swapXToY
    });
  }

  if (pools.length !== 1) {
    throw new ReadServiceInputError("quote_unavailable", "FlowX route is not a single-hop path", {
      hopCount: pools.length
    });
  }

  const config = quote.protocolConfig;
  if (!config) {
    throw new ReadServiceInputError("quote_unavailable", "FlowX quoter response did not carry the protocol config pin", {});
  }
  const pinDrift: Record<string, { pinned: string; observed: string | undefined }> = {};
  if (config.poolRegistryObjectId !== FLOWX_CLMM_MAINNET.poolRegistry.objectId) {
    pinDrift.poolRegistryObjectId = {
      pinned: FLOWX_CLMM_MAINNET.poolRegistry.objectId,
      observed: config.poolRegistryObjectId
    };
  }
  if (config.versionedObjectId !== FLOWX_CLMM_MAINNET.versioned.objectId) {
    pinDrift.versionedObjectId = {
      pinned: FLOWX_CLMM_MAINNET.versioned.objectId,
      observed: config.versionedObjectId
    };
  }
  if (config.wrappedRouterPackageId !== FLOWX_CLMM_MAINNET.universalRouter.wrappedRouterPackageId) {
    pinDrift.wrappedRouterPackageId = {
      pinned: FLOWX_CLMM_MAINNET.universalRouter.wrappedRouterPackageId,
      observed: config.wrappedRouterPackageId
    };
  }
  if (Object.keys(pinDrift).length > 0) {
    throw new ReadServiceInputError("quote_unavailable", "FlowX protocol config drifted from the pinned registry", {
      pinDrift,
      action: "regenerate_flowx_registry"
    });
  }

  return { pools };
}
