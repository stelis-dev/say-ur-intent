import {
  type Coin,
  mainnetCoins,
  mainnetPools,
  type Pool
} from "@mysten/deepbook-v3";
import {
  DEEPBOOK_SCALAR_UNIT_SOURCE,
  decimalsFromScalar,
  normalizeCoinType
} from "./coinMetadata.js";
import {
  ReadServiceInputError,
  type DeepBookCoinRegistry,
  type QuoteDirection,
  type DeepbookTokenRegistryEntry
} from "./readServiceTypes.js";

export const PINNED_DEEPBOOK_COINS = mainnetCoins as DeepBookCoinRegistry;

type DeepbookCoinEntry = { symbol: string; coin: Coin };

export function listDeepbookTokenRegistry(
  coins: DeepBookCoinRegistry = PINNED_DEEPBOOK_COINS
): DeepbookTokenRegistryEntry[] {
  assertDeepbookScalars(coins);
  const poolKeysBySymbol = new Map<string, string[]>();

  for (const [poolKey, pool] of Object.entries(mainnetPools as Record<string, Pool>)) {
    for (const symbol of [pool.baseCoin, pool.quoteCoin]) {
      const current = poolKeysBySymbol.get(symbol) ?? [];
      current.push(poolKey);
      poolKeysBySymbol.set(symbol, current);
    }
  }

  return Object.entries(coins)
    .map(([symbol, coin]) => toDeepbookTokenRegistryEntry(symbol, coin, (poolKeysBySymbol.get(symbol) ?? []).sort()))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function deepbookUnitForCoinType(
  coinType: string,
  coins: DeepBookCoinRegistry
): { decimals: number; symbol: string; name: string } | undefined {
  const entry = findDeepbookCoinEntry(coinType, coins);
  if (!entry) {
    return undefined;
  }
  const decimals = decimalsFromScalar(entry.coin.scalar);
  if (decimals === undefined) {
    throw invalidDeepbookScalar(entry.symbol, entry.coin.scalar);
  }
  return { decimals, symbol: entry.symbol, name: entry.symbol };
}

export function findDeepbookCoinEntry(
  normalizedCoinType: string,
  coins: DeepBookCoinRegistry
): DeepbookCoinEntry | undefined {
  // Validate the whole pinned token unit registry before using any DeepBook
  // coin match so one bad scalar cannot make the registry look partially trustworthy.
  assertDeepbookScalars(coins);
  for (const [symbol, coin] of Object.entries(coins)) {
    if (normalizeCoinType(coin.type) === normalizedCoinType) {
      return { symbol, coin };
    }
  }
  return undefined;
}

export function getDeepbookCoinEntryBySymbol(symbol: string, coins: DeepBookCoinRegistry): DeepbookCoinEntry {
  assertDeepbookScalars(coins);
  const coin = coins[symbol];
  if (!coin) {
    throw new ReadServiceInputError("registry_miss", "DeepBook pool coin is missing from the pinned token registry", {
      symbol
    });
  }
  return { symbol, coin };
}

export function canonicalDeepbookSymbol(
  symbol: string,
  coins: DeepBookCoinRegistry = PINNED_DEEPBOOK_COINS
): string | undefined {
  const trimmed = symbol.trim();
  if (!trimmed) {
    return undefined;
  }
  const matches = Object.keys(coins).filter((candidate) => candidate.toLowerCase() === trimmed.toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

export function getKnownPool(poolKey: string): Pool {
  const pool = (mainnetPools as Record<string, Pool>)[poolKey];
  if (!pool) {
    throw new ReadServiceInputError("registry_miss", "Unknown DeepBook mainnet pool key", { poolKey });
  }
  return pool;
}

export type DeepbookSymbolPairResolution = {
  poolKey: string;
  pool: Pool;
  direction: QuoteDirection;
  sourceSymbol: string;
  targetSymbol: string;
};

export function resolveDeepbookPoolForSymbols(input: {
  sourceSymbol: string;
  targetSymbol: string;
}): DeepbookSymbolPairResolution {
  const matches: DeepbookSymbolPairResolution[] = [];
  for (const [poolKey, pool] of Object.entries(mainnetPools as Record<string, Pool>)) {
    if (pool.baseCoin === input.sourceSymbol && pool.quoteCoin === input.targetSymbol) {
      matches.push({
        poolKey,
        pool,
        direction: "base_to_quote",
        sourceSymbol: input.sourceSymbol,
        targetSymbol: input.targetSymbol
      });
    }
    if (pool.quoteCoin === input.sourceSymbol && pool.baseCoin === input.targetSymbol) {
      matches.push({
        poolKey,
        pool,
        direction: "quote_to_base",
        sourceSymbol: input.sourceSymbol,
        targetSymbol: input.targetSymbol
      });
    }
  }

  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length > 1) {
    throw new ReadServiceInputError("registry_miss", "DeepBook symbol pair resolves to multiple mainnet pools", {
      sourceSymbol: input.sourceSymbol,
      targetSymbol: input.targetSymbol,
      poolKeys: matches.map((match) => match.poolKey)
    });
  }
  throw new ReadServiceInputError("registry_miss", "DeepBook symbol pair is not a known direct mainnet pool", {
    sourceSymbol: input.sourceSymbol,
    targetSymbol: input.targetSymbol
  });
}

export function invalidDeepbookScalar(symbol: string, scalar: number): ReadServiceInputError {
  return new ReadServiceInputError("registry_miss", "DeepBook token scalar is not a power of ten", {
    symbol,
    scalar
  });
}

function toDeepbookTokenRegistryEntry(symbol: string, coin: Coin, poolKeys: string[]): DeepbookTokenRegistryEntry {
  const decimals = decimalsFromScalar(coin.scalar);
  if (decimals === undefined) {
    throw invalidDeepbookScalar(symbol, coin.scalar);
  }
  return {
    symbol,
    address: coin.address,
    type: coin.type,
    scalar: coin.scalar,
    decimals,
    unitSource: DEEPBOOK_SCALAR_UNIT_SOURCE,
    ...(coin.feed === undefined ? {} : { feed: coin.feed }),
    ...(coin.currencyId === undefined ? {} : { currencyId: coin.currencyId }),
    ...(coin.priceInfoObjectId === undefined ? {} : { priceInfoObjectId: coin.priceInfoObjectId }),
    poolKeys
  };
}

function assertDeepbookScalars(coins: DeepBookCoinRegistry): void {
  for (const [symbol, coin] of Object.entries(coins)) {
    if (decimalsFromScalar(coin.scalar) === undefined) {
      throw invalidDeepbookScalar(symbol, coin.scalar);
    }
  }
}
