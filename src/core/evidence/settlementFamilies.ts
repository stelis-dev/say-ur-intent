import { formatRawAmount, normalizeCoinType } from "../read/coinMetadata.js";
import { DEEPBOOK_PINNED_SDK_METADATA_SOURCE } from "../read/deepbookSourceOwners.js";
import { listDeepbookTokenRegistry } from "../read/deepbookRegistry.js";
import {
  SUI_USD_SETTLEMENT_ASSET_GROUP_ID,
  type DeepBookCoinRegistry,
  type SettlementAssetGroup,
  type SettlementAssetGroupAlias,
  type SettlementAssetGroupAsset,
  type SettlementAssetGroupExcludedAsset
} from "../read/readServiceTypes.js";

const USD_SETTLEMENT_SYMBOLS = new Set(["USDC", "USDT", "WUSDC", "WUSDT", "AUSD", "USDSUI", "SUIUSDE"]);
export const SUI_USD_SETTLEMENT_ASSETS_ALIASES = [
  "dollar",
  "dollars",
  "usd",
  "usd-like",
  "stablecoin",
  "stablecoins"
] as const satisfies readonly SettlementAssetGroupAlias[];

export function normalizeSettlementDenomination(denomination: string): SettlementAssetGroupAlias {
  const normalized = denomination.trim().toLowerCase();
  if (normalized === "달러") {
    return "dollar";
  }
  if ((SUI_USD_SETTLEMENT_ASSETS_ALIASES as readonly string[]).includes(normalized)) {
    return normalized as SettlementAssetGroupAlias;
  }
  throw new Error("Unsupported settlement denomination");
}

export function buildUsdSettlementAssetGroup(coins?: DeepBookCoinRegistry): SettlementAssetGroup {
  const registry = listDeepbookTokenRegistry(coins);
  const includedAssets: SettlementAssetGroupAsset[] = [];
  const excludedAssets: SettlementAssetGroupExcludedAsset[] = [];

  for (const token of registry) {
    const coinType = normalizeCoinType(token.type);
    if (USD_SETTLEMENT_SYMBOLS.has(token.symbol)) {
      includedAssets.push({
        symbol: token.symbol,
        coinType,
        decimals: token.decimals,
        unitSource: token.unitSource,
        poolKeys: [...token.poolKeys]
      });
    } else {
      excludedAssets.push({
        symbol: token.symbol,
        coinType,
        reason: excludedSettlementAssetReason(token.symbol)
      });
    }
  }

  includedAssets.sort((left, right) => left.symbol.localeCompare(right.symbol));
  excludedAssets.sort((left, right) => left.symbol.localeCompare(right.symbol));

  return {
    id: SUI_USD_SETTLEMENT_ASSET_GROUP_ID,
    label: "Sui USD-denominated settlement assets",
    aliases: [...SUI_USD_SETTLEMENT_ASSETS_ALIASES],
    includedAssets,
    excludedAssets,
    evidenceSources: {
      ...DEEPBOOK_PINNED_SDK_METADATA_SOURCE
    },
    limitations: [
      "static_pinned_sdk_registry_not_live_liquidity",
      "not_fiat_usd_cash_out",
      "not_payment_execution",
      "not_route_recommendation",
      "not_signing_readiness"
    ]
  };
}

export function commonAssetGroupDecimals(assets: SettlementAssetGroupAsset[]): number | undefined {
  const decimals = new Set(assets.map((asset) => asset.decimals));
  return decimals.size === 1 ? assets[0]?.decimals : undefined;
}

export function formatSettlementAssetRawAmount(rawAmount: string, decimals: number): string {
  return formatRawAmount(rawAmount, decimals);
}

function excludedSettlementAssetReason(symbol: string): SettlementAssetGroupExcludedAsset["reason"] {
  if (symbol === "DEEP") {
    return "protocol_fee_asset";
  }
  if (symbol === "SUI") {
    return "gas_or_volatile_asset";
  }
  if (["BETH", "LZWBTC", "WETH", "WBTC", "XBTC"].includes(symbol)) {
    return "volatile_or_non_usd_asset";
  }
  return "not_in_usd_settlement_asset_group";
}
