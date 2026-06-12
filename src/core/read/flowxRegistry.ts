import { normalizeCoinType } from "./coinMetadata.js";
import { ReadServiceInputError } from "./readServiceTypes.js";

/**
 * Pinned FlowX CLMM mainnet registry.
 *
 * Values were read from Sui mainnet directly (package introspection, the
 * shared PoolRegistry object, and its dynamic fields) on 2026-06-12 and
 * cross-checked against @flowx-finance/sdk@2.1.0 CONFIGS and a live quoter
 * response. `scripts/generate-flowx-registry.ts` re-verifies every value
 * against the chain and fails loudly on drift; it never rewrites this module.
 *
 * Static known metadata only - not live liquidity, balances, quotes, or
 * final execution truth.
 */
export const FLOWX_CLMM_PROTOCOL_ID = "flowx-clmm";

export const FLOWX_CLMM_UNIT_SOURCE = "flowx_pinned_registry";

export const FLOWX_CLMM_MAINNET = {
  /** Current package storage id (upgrade version 7 at probe time). */
  currentPackageId: "0xde2c47eb0da8c74e4d0f6a220c41619681221b9c2590518095f0f0c2d3f3c772",
  /** Original publish id - all on-chain struct types use this address. */
  originalPackageId: "0x25929e7f29e0a30eb4e692952ba1b5b65a3a4d65ab5f2a32e1ba3edcb587f26d",
  poolRegistry: {
    objectId: "0x27565d24a4cd51127ac90e4074a841bbe356cca7bf5759ddc14a975be1632abc",
    initialSharedVersion: "101644053",
    type: "0x25929e7f29e0a30eb4e692952ba1b5b65a3a4d65ab5f2a32e1ba3edcb587f26d::pool_manager::PoolRegistry"
  },
  versioned: {
    objectId: "0x67624a1533b5aff5d0dfcf5e598684350efd38134d2d245f475524c03a64e656",
    initialSharedVersion: "101644053",
    type: "0x25929e7f29e0a30eb4e692952ba1b5b65a3a4d65ab5f2a32e1ba3edcb587f26d::versioned::Versioned"
  },
  /**
   * Universal-router surfaces used by the SDK-built swap transaction. The
   * wrappedRouterPackageId is delivered inside quoter API responses, so the
   * quote path re-checks it against this pin on every quote.
   */
  universalRouter: {
    packageId: "0xc263060d3cbb4155057f0010f92f63ca56d5121c298d01f7a33607342ec299b0",
    treasuryObjectId: "0x25db8128dc9ccbe5fcd15e5700fea555c6b111a8c8a1f20c426b696caac2bea4",
    tradeIdTrackerObjectId: "0x9ab469842f85fd2a1bac9ba695d867adb1caa7d5705809737922b5cee552eb6f",
    partnerRegistryObjectId: "0x29e6c1c2176485dc045a2e39eb8844b4ca1cf8452d964447c11202f84a76cb1a",
    versionedObjectId: "0xada98dd9e028db64e206dd81fdecb3dbc8b4c16be08d9f175550032bfdcf56f3",
    wrappedRouterPackageId: "0x1d200e5a0709f84736d1ec06a5e9a961f4fa86f2d43d15e3a0441ae152440ede"
  },
  /** Aggregator quoter source label for FlowX CLMM routes. */
  quoterSource: "FLOWX_CLMM",
  /** Pool fee rates use a 1_000_000 denominator (e.g. 3000 = 0.3%). */
  feeRateDenominator: 1_000_000
} as const;

export type FlowxCoinMeta = {
  symbol: string;
  coinType: string;
  decimals: number;
};

export const FLOWX_PINNED_COINS = {
  SUI: {
    symbol: "SUI",
    coinType: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
    decimals: 9
  },
  USDC: {
    symbol: "USDC",
    coinType: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    decimals: 6
  }
} as const satisfies Record<string, FlowxCoinMeta>;

export type FlowxPoolRegistryEntry = {
  /** Stable local pool key: SYMBOLX_SYMBOLY_FEERATE. */
  poolKey: string;
  poolId: string;
  symbolX: string;
  symbolY: string;
  coinTypeX: string;
  coinTypeY: string;
  decimalsX: number;
  decimalsY: number;
  /** Swap fee on the 1e6 denominator. */
  feeRate: number;
  tickSpacing: number;
  unitSource: typeof FLOWX_CLMM_UNIT_SOURCE;
};

function suiUsdcPool(poolId: string, feeRate: number, tickSpacing: number): FlowxPoolRegistryEntry {
  return {
    poolKey: `SUI_USDC_${feeRate}`,
    poolId,
    symbolX: FLOWX_PINNED_COINS.SUI.symbol,
    symbolY: FLOWX_PINNED_COINS.USDC.symbol,
    coinTypeX: FLOWX_PINNED_COINS.SUI.coinType,
    coinTypeY: FLOWX_PINNED_COINS.USDC.coinType,
    decimalsX: FLOWX_PINNED_COINS.SUI.decimals,
    decimalsY: FLOWX_PINNED_COINS.USDC.decimals,
    feeRate,
    tickSpacing,
    unitSource: FLOWX_CLMM_UNIT_SOURCE
  };
}

/**
 * Every SUI/USDC pool discovered by direct PoolRegistry dynamic-field reads
 * (2026-06-12, 1189 pools total). One pool exists per fee tier; the registry
 * lists all of them without ranking - pool selection is never advice here.
 */
export const FLOWX_PINNED_POOLS: readonly FlowxPoolRegistryEntry[] = [
  suiUsdcPool("0xf143ac1cc2c012e31df55f21a5d9f406adc8f1ac08d014f84475a3b21953dd37", 10, 1),
  suiUsdcPool("0x9c1cc6fc3c0060b9544dcaba50c9564706a558ef7e089895e86fbca1851c3d43", 100, 2),
  suiUsdcPool("0x6b3791da0ae8b8d94d112c21b682e9f7d49a0b177cddd5b0dd61ca3ff27bc847", 500, 10),
  suiUsdcPool("0xd477e8830f9aa070475149d75f285a4bd0a0386d8ce12f0e88e1c112cda21dfe", 1000, 20),
  suiUsdcPool("0x1aed0146a85e0aa58639bfaca3ae55aa7db119eaeae35d3ec4a90742ebbb3933", 2000, 40),
  suiUsdcPool("0x325239132e2b619147c00052986461cea02815172ea9d000c58e68484f514a90", 3000, 60),
  suiUsdcPool("0x8903db2e9aea9e76d310c52a8745cff1f1d11fe38bc120828bd7280e7497ba8c", 10000, 200)
];

export function listFlowxPoolRegistry(): readonly FlowxPoolRegistryEntry[] {
  return FLOWX_PINNED_POOLS;
}

export function getFlowxPoolById(poolId: string): FlowxPoolRegistryEntry | undefined {
  return FLOWX_PINNED_POOLS.find((pool) => pool.poolId === poolId);
}

export function canonicalFlowxSymbol(symbol: string): FlowxCoinMeta | undefined {
  const trimmed = symbol.trim();
  if (!trimmed) {
    return undefined;
  }
  const matches = Object.values(FLOWX_PINNED_COINS).filter(
    (coin) => coin.symbol.toLowerCase() === trimmed.toLowerCase()
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export type FlowxSwapPairResolution = {
  source: FlowxCoinMeta;
  target: FlowxCoinMeta;
  /** Direction relative to the pinned pools' X/Y ordering. */
  swapXToY: boolean;
  pools: readonly FlowxPoolRegistryEntry[];
};

export function resolveFlowxSwapPair(input: {
  sourceSymbol: string;
  targetSymbol: string;
}): FlowxSwapPairResolution {
  const source = canonicalFlowxSymbol(input.sourceSymbol);
  const target = canonicalFlowxSymbol(input.targetSymbol);
  if (!source || !target) {
    throw new ReadServiceInputError("registry_miss", "FlowX symbol is not in the pinned registry", {
      sourceSymbol: input.sourceSymbol,
      targetSymbol: input.targetSymbol,
      knownSymbols: Object.keys(FLOWX_PINNED_COINS)
    });
  }
  if (source.symbol === target.symbol) {
    throw new ReadServiceInputError("input_invalid", "FlowX swap pair uses the same symbol twice", {
      sourceSymbol: input.sourceSymbol,
      targetSymbol: input.targetSymbol
    });
  }

  const sourceType = normalizeCoinType(source.coinType);
  const targetType = normalizeCoinType(target.coinType);
  const xToY = FLOWX_PINNED_POOLS.filter(
    (pool) => normalizeCoinType(pool.coinTypeX) === sourceType && normalizeCoinType(pool.coinTypeY) === targetType
  );
  const yToX = FLOWX_PINNED_POOLS.filter(
    (pool) => normalizeCoinType(pool.coinTypeX) === targetType && normalizeCoinType(pool.coinTypeY) === sourceType
  );

  if (xToY.length > 0 && yToX.length > 0) {
    throw new ReadServiceInputError("registry_miss", "FlowX pinned pools resolve the pair in both orientations", {
      sourceSymbol: source.symbol,
      targetSymbol: target.symbol
    });
  }
  const pools = xToY.length > 0 ? xToY : yToX;
  if (pools.length === 0) {
    throw new ReadServiceInputError("registry_miss", "FlowX symbol pair has no pinned mainnet pools", {
      sourceSymbol: source.symbol,
      targetSymbol: target.symbol
    });
  }
  return {
    source,
    target,
    swapXToY: xToY.length > 0,
    pools
  };
}

export function assertFlowxRegistryShape(): void {
  const poolKeys = new Set<string>();
  const poolIds = new Set<string>();
  for (const pool of FLOWX_PINNED_POOLS) {
    if (poolKeys.has(pool.poolKey)) {
      throw new ReadServiceInputError("registry_miss", "FlowX pinned registry repeats a pool key", {
        poolKey: pool.poolKey
      });
    }
    if (poolIds.has(pool.poolId)) {
      throw new ReadServiceInputError("registry_miss", "FlowX pinned registry repeats a pool id", {
        poolId: pool.poolId
      });
    }
    poolKeys.add(pool.poolKey);
    poolIds.add(pool.poolId);
    if (!Number.isInteger(pool.feeRate) || pool.feeRate < 0 || pool.feeRate >= FLOWX_CLMM_MAINNET.feeRateDenominator) {
      throw new ReadServiceInputError("registry_miss", "FlowX pinned pool fee rate is outside the 1e6 denominator", {
        poolKey: pool.poolKey,
        feeRate: pool.feeRate
      });
    }
    if (!Number.isInteger(pool.tickSpacing) || pool.tickSpacing <= 0) {
      throw new ReadServiceInputError("registry_miss", "FlowX pinned pool tick spacing is not a positive integer", {
        poolKey: pool.poolKey,
        tickSpacing: pool.tickSpacing
      });
    }
  }
}
