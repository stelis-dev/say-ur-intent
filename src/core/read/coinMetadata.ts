import { normalizeStructTag, parseToUnits } from "@mysten/sui/utils";
import type { SuiClientTypes } from "@mysten/sui/client";

export const COIN_METADATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const SUI_METADATA_UNIT_SOURCE = "sui_core_getCoinMetadata" as const;
export const DEEPBOOK_SCALAR_UNIT_SOURCE = "deepbook_mainnetCoins_scalar" as const;
export const DISPLAY_AMOUNT_SOURCE = "raw_balance_with_verified_decimals" as const;

export type UnitSource = typeof SUI_METADATA_UNIT_SOURCE | typeof DEEPBOOK_SCALAR_UNIT_SOURCE;
export type UnitCacheStatus = "hit" | "miss" | "expired_refetched";
export type UnitUnavailableReason =
  | "metadata_not_found"
  | "metadata_lookup_failed"
  | "coin_type_unresolved"
  | "no_verified_decimals";

export type AvailableCoinUnit = {
  status: "available";
  source: UnitSource;
  decimals: number;
  symbol: string;
  name: string;
  cacheStatus?: UnitCacheStatus | undefined;
};

export type UnavailableCoinUnit = {
  status: "unavailable";
  reason: UnitUnavailableReason;
};

export type CoinUnit = AvailableCoinUnit | UnavailableCoinUnit;

export type CoinDisplayAmount = {
  amount: string;
  symbol: string;
  source: typeof DISPLAY_AMOUNT_SOURCE;
};

export type WalletBalanceWithUnit = SuiClientTypes.Balance & {
  unit: CoinUnit;
  display?: CoinDisplayAmount | undefined;
};

export type CoinMetadataCacheRecord = {
  coinType: string;
  chainIdentifier: string;
  decimals: number;
  symbol: string;
  name: string;
  fetchedAt: string;
  expiresAt: string;
};

export type CoinMetadataCacheLookup =
  | { status: "hit"; record: CoinMetadataCacheRecord }
  | { status: "expired"; record: CoinMetadataCacheRecord }
  | { status: "miss" };

export interface CoinMetadataCache {
  getCoinMetadata(input: {
    coinType: string;
    chainIdentifier: string;
    now: Date;
  }): Promise<CoinMetadataCacheLookup>;
  setCoinMetadata(record: CoinMetadataCacheRecord): Promise<void>;
}

export function normalizeCoinType(coinType: string): string {
  return normalizeStructTag(coinType);
}

export function decimalsFromScalar(scalar: number): number | undefined {
  if (!Number.isSafeInteger(scalar) || scalar < 1) {
    return undefined;
  }
  let value = scalar;
  let decimals = 0;
  while (value > 1 && value % 10 === 0) {
    value /= 10;
    decimals += 1;
  }
  return value === 1 ? decimals : undefined;
}

export function assertValidDecimals(decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Coin metadata decimals must be an integer from 0 to 255");
  }
  return decimals;
}

export function formatRawAmount(rawAmount: string, decimals: number): string {
  assertValidDecimals(decimals);
  if (!/^\d+$/.test(rawAmount)) {
    throw new Error("raw amount must be an unsigned integer string");
  }
  const normalizedRaw = rawAmount.replace(/^0+(?=\d)/, "");
  if (decimals === 0) {
    return normalizedRaw;
  }
  const padded = normalizedRaw.padStart(decimals + 1, "0");
  const integerPart = padded.slice(0, -decimals).replace(/^0+(?=\d)/, "");
  const fractionalPart = padded.slice(-decimals).replace(/0+$/, "");
  return fractionalPart.length === 0 ? integerPart : `${integerPart}.${fractionalPart}`;
}

export function assertDisplayAmountSyntax(displayAmount: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(displayAmount)) {
    throw new Error("display amount must be an unsigned decimal string");
  }
  return displayAmount;
}

export function parseDisplayAmountToRaw(displayAmount: string, decimals: number): string {
  assertValidDecimals(decimals);
  assertDisplayAmountSyntax(displayAmount);
  try {
    return parseToUnits(displayAmount, decimals).toString();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message.startsWith("Too many decimal places")) {
      throw new Error("display amount has more fractional digits than verified decimals");
    }
    throw error;
  }
}
