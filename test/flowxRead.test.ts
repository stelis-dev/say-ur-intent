import { describe, expect, it } from "vitest";
import { mainnetCoins } from "@mysten/deepbook-v3";
import { normalizeFlowxQuoterResult } from "../src/core/read/flowxQuoteClient.js";
import { flowxQuoteQuantitySemantics, validateFlowxRouteQuote } from "../src/core/read/flowxReadHelpers.js";
import {
  FLOWX_CLMM_MAINNET,
  FLOWX_PINNED_COINS,
  FLOWX_PINNED_POOLS,
  assertFlowxRegistryShape,
  canonicalFlowxSymbol,
  getFlowxPoolById,
  resolveFlowxSwapPair
} from "../src/core/read/flowxRegistry.js";
import { normalizeCoinType } from "../src/core/read/coinMetadata.js";
import { SuiReadService } from "../src/core/read/readService.js";
import {
  ReadServiceInputError,
  type FlowxQuoteClient,
  type FlowxRouteQuote
} from "../src/core/read/readServiceTypes.js";
import { MemoryCoinMetadataCache } from "./fixtures/memoryCoinMetadataCache.js";

const ACTIVE_POOL = FLOWX_PINNED_POOLS.find((pool) => pool.feeRate === 3000)!;

function pinnedProtocolConfig() {
  return {
    poolRegistryObjectId: FLOWX_CLMM_MAINNET.poolRegistry.objectId,
    versionedObjectId: FLOWX_CLMM_MAINNET.versioned.objectId,
    wrappedRouterPackageId: FLOWX_CLMM_MAINNET.universalRouter.wrappedRouterPackageId
  };
}

function validQuote(overrides: Partial<FlowxRouteQuote> = {}): FlowxRouteQuote {
  return {
    amountInRaw: "1000000000",
    amountOutRaw: "753052",
    paths: [
      {
        poolId: ACTIVE_POOL.poolId,
        source: "FLOWX_CLMM",
        swapXToY: true,
        feeRate: 3000
      }
    ],
    protocolConfig: pinnedProtocolConfig(),
    ...overrides
  };
}

describe("flowx pinned registry", () => {
  it("holds a structurally valid pinned registry", () => {
    expect(() => assertFlowxRegistryShape()).not.toThrow();
    expect(FLOWX_PINNED_POOLS.length).toBe(7);
  });

  it("matches DeepBook pinned coin types for shared symbols", () => {
    for (const coin of Object.values(FLOWX_PINNED_COINS)) {
      const deepbookCoin = mainnetCoins[coin.symbol as keyof typeof mainnetCoins];
      if (deepbookCoin === undefined) {
        throw new Error(`DeepBook registry is missing ${coin.symbol}`);
      }
      expect(normalizeCoinType(coin.coinType)).toBe(normalizeCoinType(deepbookCoin.type));
    }
  });

  it("resolves SUI->USDC as x-to-y across all fee tiers", () => {
    const resolution = resolveFlowxSwapPair({ sourceSymbol: "sui", targetSymbol: "usdc" });
    expect(resolution.swapXToY).toBe(true);
    expect(resolution.pools.length).toBe(7);
    expect(resolution.source.symbol).toBe("SUI");
  });

  it("resolves USDC->SUI as y-to-x", () => {
    const resolution = resolveFlowxSwapPair({ sourceSymbol: "USDC", targetSymbol: "SUI" });
    expect(resolution.swapXToY).toBe(false);
  });

  it("rejects unknown symbols and same-symbol pairs", () => {
    expect(() => resolveFlowxSwapPair({ sourceSymbol: "SUI", targetSymbol: "DEEP" })).toThrow(ReadServiceInputError);
    expect(() => resolveFlowxSwapPair({ sourceSymbol: "SUI", targetSymbol: "sui" })).toThrow(ReadServiceInputError);
    expect(canonicalFlowxSymbol("nope")).toBeUndefined();
    expect(getFlowxPoolById("0x0")).toBeUndefined();
  });
});

describe("flowx quoter result normalization", () => {
  it("normalizes a raw quoter response into plain route data", () => {
    const normalized = normalizeFlowxQuoterResult({
      amountIn: "1000000000",
      amountOut: "753052",
      rawQuote: {
        paths: [
          [
            {
              poolId: ACTIVE_POOL.poolId,
              source: "FLOWX_CLMM",
              extra: { swapXToY: true, fee: 3000 }
            }
          ]
        ],
        protocolConfig: { flowx_clmm: pinnedProtocolConfig() }
      }
    });
    expect(normalized.amountOutRaw).toBe("753052");
    expect(normalized.paths[0]?.feeRate).toBe(3000);
    expect(normalized.protocolConfig?.wrappedRouterPackageId).toBe(
      FLOWX_CLMM_MAINNET.universalRouter.wrappedRouterPackageId
    );
  });

  it("fails closed when raw paths or amounts are missing", () => {
    expect(() => normalizeFlowxQuoterResult({ amountIn: "1", amountOut: "2" })).toThrow(ReadServiceInputError);
    expect(() =>
      normalizeFlowxQuoterResult({
        amountIn: "not-a-number",
        amountOut: "2",
        rawQuote: { paths: [[{ poolId: "0x1", source: "FLOWX_CLMM" }]] }
      })
    ).toThrow(ReadServiceInputError);
  });
});

describe("flowx route quote validation", () => {
  const pair = resolveFlowxSwapPair({ sourceSymbol: "SUI", targetSymbol: "USDC" });

  it("accepts a pinned single-hop FlowX CLMM route", () => {
    const { pools } = validateFlowxRouteQuote({
      pair,
      requestedAmountInRaw: "1000000000",
      quote: validQuote()
    });
    expect(pools).toEqual([
      {
        poolKey: ACTIVE_POOL.poolKey,
        poolId: ACTIVE_POOL.poolId,
        feeRate: 3000,
        tickSpacing: 60,
        swapXToY: true
      }
    ]);
  });

  it.each([
    ["echoed input mismatch", validQuote({ amountInRaw: "999" })],
    ["foreign source", validQuote({ paths: [{ ...validQuote().paths[0]!, source: "CETUS" }] })],
    ["unknown pool", validQuote({ paths: [{ ...validQuote().paths[0]!, poolId: "0xdead" }] })],
    ["direction mismatch", validQuote({ paths: [{ ...validQuote().paths[0]!, swapXToY: false }] })],
    ["fee mismatch", validQuote({ paths: [{ ...validQuote().paths[0]!, feeRate: 500 }] })],
    [
      "multi-hop",
      validQuote({
        paths: [validQuote().paths[0]!, { ...validQuote().paths[0]!, poolId: FLOWX_PINNED_POOLS[0]!.poolId }]
      })
    ],
    ["missing protocol config", validQuote({ protocolConfig: undefined })],
    [
      "drifted protocol config",
      validQuote({ protocolConfig: { ...pinnedProtocolConfig(), wrappedRouterPackageId: "0xdrifted" } })
    ]
  ])("fails closed on %s", (_label, quote) => {
    expect(() =>
      validateFlowxRouteQuote({ pair, requestedAmountInRaw: "1000000000", quote })
    ).toThrow(ReadServiceInputError);
  });

  it("keeps quote semantics chain-unverified and payment-blocked", () => {
    const semantics = flowxQuoteQuantitySemantics();
    expect(semantics.chainVerified).toBe(false);
    expect(semantics.canUseForPaymentAnswer).toBe(false);
    expect(semantics.notFor).toContain("best_route");
    expect(semantics.notFor).toContain("transaction_building");
  });
});

describe("readService.quoteFlowxSwap", () => {
  function buildService(client: FlowxQuoteClient): SuiReadService {
    return new SuiReadService({
      client: {
        core: {
          listBalances: () => Promise.reject(new Error("not used")),
          getCoinMetadata: () => Promise.reject(new Error("not used"))
        }
      },
      network: "mainnet",
      chainIdentifier: "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S",
      coinMetadataCache: new MemoryCoinMetadataCache(),
      now: () => new Date("2026-06-12T12:00:00.000Z"),
      flowxQuoteClient: client
    });
  }

  it("returns a validated indicative quote with display conversions", async () => {
    const requests: unknown[] = [];
    const service = buildService({
      getSwapRoutes: async (request) => {
        requests.push(request);
        return validQuote();
      }
    });

    const summary = await service.quoteFlowxSwap({
      sourceSymbol: "SUI",
      targetSymbol: "USDC",
      amountDisplay: "1"
    });

    expect(requests).toEqual([
      {
        tokenInType: FLOWX_PINNED_COINS.SUI.coinType,
        tokenOutType: FLOWX_PINNED_COINS.USDC.coinType,
        amountInRaw: "1000000000"
      }
    ]);
    expect(summary.amountIn).toEqual({ raw: "1000000000", display: "1", decimals: 9 });
    expect(summary.amountOut).toEqual({ raw: "753052", display: "0.753052", decimals: 6, indicative: true });
    expect(summary.routeEvidence.pools[0]?.poolKey).toBe("SUI_USDC_3000");
    expect(summary.routeEvidence.routeChosenBy).toBe("flowx_router_not_this_server");
    expect(summary.source.chainVerified).toBe(false);
    expect(summary.fetchedAt).toBe("2026-06-12T12:00:00.000Z");
    expect(summary.userAnswerUse.cannotAnswer).toContain("route_recommendation");
  });

  it("rejects zero and malformed display amounts before quoting", async () => {
    const service = buildService({
      getSwapRoutes: async () => {
        throw new Error("quoter must not be called");
      }
    });
    await expect(
      service.quoteFlowxSwap({ sourceSymbol: "SUI", targetSymbol: "USDC", amountDisplay: "0" })
    ).rejects.toThrow(ReadServiceInputError);
    await expect(
      service.quoteFlowxSwap({ sourceSymbol: "SUI", targetSymbol: "USDC", amountDisplay: "-1" })
    ).rejects.toThrow(ReadServiceInputError);
    await expect(
      service.quoteFlowxSwap({ sourceSymbol: "SUI", targetSymbol: "USDC", amountDisplay: "1.0000000001" })
    ).rejects.toThrow(ReadServiceInputError);
  });

  it("propagates fail-closed route validation from the quoter response", async () => {
    const service = buildService({
      getSwapRoutes: async () => validQuote({ protocolConfig: undefined })
    });
    await expect(
      service.quoteFlowxSwap({ sourceSymbol: "SUI", targetSymbol: "USDC", amountDisplay: "1" })
    ).rejects.toThrow(/protocol config pin/);
  });
});
