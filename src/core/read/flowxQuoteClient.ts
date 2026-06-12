import { AggregatorQuoter, Protocol } from "@flowx-finance/sdk";
import {
  ReadServiceInputError,
  type FlowxQuoteClient,
  type FlowxQuoteRequest,
  type FlowxRoutePathEvidence,
  type FlowxProtocolConfigEvidence,
  type FlowxRouteQuote
} from "./readServiceTypes.js";

/**
 * Thin wrapper around the FlowX aggregator quoter, restricted to FlowX CLMM
 * single-hop routes. Normalizes the response into plain data so the read
 * service can validate it against the pinned registry, and so tests can
 * inject fakes without the SDK.
 */
const FLOWX_QUOTER_MAX_HOPS = 1;

export function createFlowxQuoteClient(): FlowxQuoteClient {
  const quoter = new AggregatorQuoter("mainnet");
  return {
    async getSwapRoutes(request: FlowxQuoteRequest): Promise<FlowxRouteQuote> {
      let result;
      try {
        result = await quoter.getRoutes({
          tokenIn: request.tokenInType,
          tokenOut: request.tokenOutType,
          amountIn: request.amountInRaw,
          includeSources: [Protocol.FLOWX_V3],
          maxHops: FLOWX_QUOTER_MAX_HOPS
        });
      } catch (error) {
        throw new ReadServiceInputError("quote_unavailable", "FlowX quoter request failed", {
          reason: error instanceof Error ? error.message : "unknown"
        });
      }
      return normalizeFlowxQuoterResult(result);
    }
  };
}

/**
 * Build-grade quote source for the FlowX review adapter: one quoter response
 * yields both the normalized quote (validated against the pinned registry)
 * and the SDK route entities the local transaction build consumes.
 */
export function createFlowxSwapReviewQuoteSource(options?: { now?: () => Date }): {
  getSwapRoutesForBuild(request: FlowxQuoteRequest): Promise<{
    normalized: FlowxRouteQuote;
    sdkRoutes: unknown;
    fetchedAt: string;
  }>;
} {
  const quoter = new AggregatorQuoter("mainnet");
  const now = options?.now ?? (() => new Date());
  return {
    async getSwapRoutesForBuild(request: FlowxQuoteRequest) {
      let result;
      try {
        result = await quoter.getRoutes({
          tokenIn: request.tokenInType,
          tokenOut: request.tokenOutType,
          amountIn: request.amountInRaw,
          includeSources: [Protocol.FLOWX_V3],
          maxHops: FLOWX_QUOTER_MAX_HOPS
        });
      } catch (error) {
        throw new ReadServiceInputError("quote_unavailable", "FlowX quoter request failed", {
          reason: error instanceof Error ? error.message : "unknown"
        });
      }
      return {
        normalized: normalizeFlowxQuoterResult(result),
        sdkRoutes: result.routes,
        fetchedAt: now().toISOString()
      };
    }
  };
}

type RawQuoterPath = {
  poolId?: unknown;
  source?: unknown;
  extra?: { swapXToY?: unknown; fee?: unknown } | undefined;
};

type RawQuoterResult = {
  amountIn?: { toString(): string } | string | undefined;
  amountOut?: { toString(): string } | string | undefined;
  rawQuote?: {
    paths?: RawQuoterPath[][] | undefined;
    protocolConfig?: Record<string, unknown> | undefined;
  };
};

export function normalizeFlowxQuoterResult(result: RawQuoterResult): FlowxRouteQuote {
  const rawQuote = result.rawQuote;
  if (!rawQuote || !Array.isArray(rawQuote.paths)) {
    throw new ReadServiceInputError("quote_unavailable", "FlowX quoter response is missing raw route paths", {
      hasRawQuote: rawQuote !== undefined
    });
  }
  const amountInRaw = stringifyAmount(result.amountIn, "amountIn");
  const amountOutRaw = stringifyAmount(result.amountOut, "amountOut");

  const paths: FlowxRoutePathEvidence[] = rawQuote.paths.flat().map((path, index) => {
    if (typeof path.poolId !== "string" || path.poolId.length === 0) {
      throw new ReadServiceInputError("quote_unavailable", "FlowX quoter path is missing a pool id", { index });
    }
    if (typeof path.source !== "string" || path.source.length === 0) {
      throw new ReadServiceInputError("quote_unavailable", "FlowX quoter path is missing a source label", { index });
    }
    return {
      poolId: path.poolId,
      source: path.source,
      swapXToY: typeof path.extra?.swapXToY === "boolean" ? path.extra.swapXToY : undefined,
      feeRate: typeof path.extra?.fee === "number" ? path.extra.fee : undefined
    };
  });
  if (paths.length === 0) {
    throw new ReadServiceInputError("quote_unavailable", "FlowX quoter returned no route paths", {});
  }

  return {
    amountInRaw,
    amountOutRaw,
    paths,
    protocolConfig: normalizeProtocolConfig(rawQuote.protocolConfig)
  };
}

function normalizeProtocolConfig(config: Record<string, unknown> | undefined): FlowxProtocolConfigEvidence | undefined {
  const clmm = config?.flowx_clmm;
  if (typeof clmm !== "object" || clmm === null) {
    return undefined;
  }
  const record = clmm as Record<string, unknown>;
  return {
    poolRegistryObjectId: typeof record.poolRegistryObjectId === "string" ? record.poolRegistryObjectId : undefined,
    versionedObjectId: typeof record.versionedObjectId === "string" ? record.versionedObjectId : undefined,
    wrappedRouterPackageId:
      typeof record.wrappedRouterPackageId === "string" ? record.wrappedRouterPackageId : undefined
  };
}

function stringifyAmount(value: RawQuoterResult["amountIn"], field: string): string {
  const text = typeof value === "string" ? value : value?.toString();
  if (text === undefined || !/^\d+$/.test(text)) {
    throw new ReadServiceInputError("quote_unavailable", "FlowX quoter amount is not a raw integer", { field });
  }
  return text;
}
