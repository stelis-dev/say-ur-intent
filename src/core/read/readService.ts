import type { SuiClientTypes } from "@mysten/sui/client";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  COIN_METADATA_CACHE_TTL_MS,
  DEEPBOOK_SCALAR_UNIT_SOURCE,
  assertValidDecimals,
  decimalsFromScalar,
  formatRawAmount,
  parseDisplayAmountToRaw,
  normalizeCoinType,
  type CoinMetadataCache,
  type CoinUnit,
  type CoinMetadataCacheLookup,
  type CoinMetadataCacheRecord,
  type WalletBalanceWithUnit
} from "./coinMetadata.js";
import { createDeepBookReadClient } from "./deepbookRawQuoteClient.js";
import {
  DEEPBOOK_USDC_INDEX_BAR_INTERVAL_MINUTES,
  DEEPBOOK_USDC_INDEX_PRICE_CONVENTION,
  utcIsoWeekFromDate,
  type DeepbookUsdcIndexFetchSource,
  type DeepbookUsdcIndexPair,
  type DeepbookUsdcIndexWeeklyBarsResult,
  type UtcIsoWeek
} from "./deepbookUsdcIndexSource.js";
import { createFlowxQuoteClient } from "./flowxQuoteClient.js";
import { flowxQuoteQuantitySemantics, validateFlowxRouteQuote } from "./flowxReadHelpers.js";
import { resolveFlowxSwapPair } from "./flowxRegistry.js";
import {
  deepbookUnitForCoinType,
  canonicalDeepbookSymbol,
  getDeepbookCoinEntryBySymbol,
  getKnownPool,
  invalidDeepbookScalar,
  listDeepbookTokenRegistry,
  PINNED_DEEPBOOK_COINS,
  resolveDeepbookPoolForSymbols
} from "./deepbookRegistry.js";
import { sumRawAmounts } from "./amounts.js";
import {
  buildUsdSettlementAssetGroup,
  commonAssetGroupDecimals,
  formatSettlementAssetRawAmount,
  normalizeSettlementDenomination
} from "../evidence/settlementFamilies.js";
import {
  assertDeepbookDisplayBalances,
  assertPositiveInteger,
  assertValidDeepbookMidPrice,
  assertValidDeepbookQuote,
  deepbookAccountInventorySource,
  deepbookDisplayQuantitySemantics,
  deepbookMidPriceSemantics,
  deepbookUsdcPriceHistoryQuantitySemantics,
  deepbookUsdcPriceHistoryResponseSummary,
  deepbookQuoteQuantitySemantics,
  normalizeManagerAddresses,
  normalizeOptionalManagerAddress,
  parseQuoteDisplayAmount,
  parseRawAmount,
  toDeepbookAccountSummary,
  toDeepbookDisplayQuoteFromRaw
} from "./deepbookReadHelpers.js";
import {
  classifyWalletBalance,
  unavailableUnit,
  unitFromDeepbook,
  unitFromMetadataRecord,
  walletBalanceQuantitySemantics,
  withResolvedUnit,
  withUnavailableUnit
} from "./walletReadHelpers.js";
import {
  deepbookAccountInventoryUserAnswerUse,
  deepbookMidPriceUserAnswerUse,
  deepbookOrderbookUserAnswerUse,
  deepbookUsdcPriceAtTimeUserAnswerUse,
  deepbookUsdcPriceHistoryUserAnswerUse,
  deepbookQuoteUserAnswerUse,
  flowxQuoteUserAnswerUse,
  intentEvidenceUserAnswerUse,
  settlementAssetGroupParityUserAnswerUse,
  walletBalanceUserAnswerUse,
  walletClassificationUserAnswerUse
} from "./readResponseGuidance.js";
import {
  intentEvidenceQuantitySemantics,
  intentEvidenceResponseEvidence,
  intentEvidenceResponseSummary,
  intentEvidenceSettlementAssetCoverageBoundary,
  intentEvidenceSupportedClaims,
  isIntentEvidenceTargetAssetSelectionSource,
  isSupportedIntentEvidenceKind
} from "./intentEvidenceResponseFormatting.js";
import {
  roundDerivedParityPrice,
  settlementAssetGroupParityQuantitySemantics,
  settlementAssetGroupParityResponseSummary,
  settlementAssetGroupParityStatistics
} from "./settlementParityFormatting.js";
import {
  DEEPBOOK_MID_PRICE_DIRECTION,
  DEEPBOOK_MID_PRICE_PRECISION,
  DEEPBOOK_MID_PRICE_TYPE,
  DEEPBOOK_RAW_QUOTE_QUANTITY_KIND,
  DEEPBOOK_USDC_PRICE_HISTORY_UNSUPPORTED_CLAIMS,
  DEFAULT_DEEPBOOK_SIMULATION_SENDER,
  INTENT_EVIDENCE_TARGET_ASSET_SELECTION_SOURCES,
  MAX_DEEPBOOK_ACCOUNT_OPEN_ORDER_IDS,
  MAX_DEEPBOOK_USDC_PRICE_HISTORY_BARS,
  MAX_DEEPBOOK_ORDERBOOK_TICKS,
  MAX_WALLET_BALANCE_SCAN_PAGES,
  NOT_INSPECTED_ASSET_CLASSES,
  ReadServiceCacheError,
  ReadServiceInputError,
  type ClassifiedWalletAsset,
  type DeepBookCoinRegistry,
  type DeepBookFactoryOptions,
  type DeepBookReadClient,
  type DeepbookAccountInventoryInput,
  type DeepbookAccountInventorySummary,
  type DeepbookDisplayQuoteSummary,
  type DeepbookMidPriceSummary,
  type DeepbookOrderbookSummary,
  type DeepbookRawQuoteAmount,
  type DeepbookRawQuoteEvidence,
  type DeepbookRawQuoteReturnValues,
  type DeepbookQuoteSummary,
  type DeepbookUsdcIndexSourceClient,
  type DeepbookUsdcPriceAtTimeInput,
  type DeepbookUsdcPriceAtTimeMatch,
  type DeepbookUsdcPriceAtTimeSummary,
  type DeepbookUsdcPriceAtTimeTarget,
  type DeepbookUsdcPriceHistoryFileReference,
  type DeepbookUsdcPriceHistoryFoundFileReference,
  type DeepbookUsdcPriceHistoryBar,
  type DeepbookUsdcPriceHistoryInput,
  type DeepbookUsdcPriceHistoryPair,
  type DeepbookUsdcPriceHistoryQuantitySemantics,
  type DeepbookUsdcPriceHistoryRange,
  type DeepbookUsdcPriceHistoryResponseSummary,
  type DeepbookUsdcPriceHistorySelector,
  type DeepbookUsdcPriceHistorySource,
  type DeepbookUsdcPriceHistorySummary,
  type DeepbookUsdcPriceHistoryUnsupportedClaim,
  type DeepbookTokenRegistryEntry,
  type IntentEvidenceBlockedReason,
  type IntentEvidenceCandidateConversion,
  type IntentEvidenceInput,
  type IntentEvidenceResponseEvidence,
  type IntentEvidenceSummary,
  type IntentEvidenceSettlementAssetBalance,
  type IntentEvidenceSettlementAssetCoverage,
  type IntentEvidenceSelectedTarget,
  type IntentEvidenceKind,
  type IntentEvidenceTargetAssetSelectionSource,
  type UninspectedAssetClass,
  type QuoteDirection,
  type SettlementAssetGroup,
  type SettlementAssetGroupAsset,
  type SettlementAssetGroupListSummary,
  type SettlementAssetGroupParityAsset,
  type SettlementAssetGroupParityInput,
  type SettlementAssetGroupParitySummary,
  type FlowxQuoteClient,
  type FlowxSwapQuoteSummary,
  type SuiReadCoreClient,
  type SuiReadServiceOptions,
  type WalletAssetClassificationSummary,
  type WalletBalanceInput,
  type WalletBalanceSummary
,
  type DeepbookQuoteFeeMode
} from "./readServiceTypes.js";

export * from "./readServiceTypes.js";
export { listDeepbookTokenRegistry } from "./deepbookRegistry.js";
export {
  FLOWX_CLMM_MAINNET,
  FLOWX_CLMM_PROTOCOL_ID,
  FLOWX_CLMM_UNIT_SOURCE,
  assertFlowxRegistryShape,
  listFlowxPoolRegistry
} from "./flowxRegistry.js";

type WalletBalanceClassificationScan = {
  classifiedAssets: ClassifiedWalletAsset[];
  uninspectedAssetClasses: UninspectedAssetClass[];
  inspectedBalancePages: number;
  inspectedCoinBalanceCount: number;
  blockedReason?: IntentEvidenceBlockedReason | undefined;
};

const DEEPBOOK_USDC_PRICE_HISTORY_INTERVAL_MS = DEEPBOOK_USDC_INDEX_BAR_INTERVAL_MINUTES * 60 * 1000;
const DEFAULT_DEEPBOOK_USDC_PRICE_AT_TIME_MAX_DISTANCE_MINUTES = 360;

const DEEPBOOK_USDC_PRICE_HISTORY_RESPONSE_SUMMARY = {
  ...deepbookUsdcPriceHistoryResponseSummary()
} as const satisfies DeepbookUsdcPriceHistoryResponseSummary;

function deepbookUsdcPriceHistorySelector(input: DeepbookUsdcPriceHistoryInput): DeepbookUsdcPriceHistorySelector {
  const selectors = [
    input.pairId === undefined ? undefined : ({ kind: "pair_id", value: input.pairId.trim().toUpperCase() } as const),
    input.assetSymbol === undefined
      ? undefined
      : ({ kind: "asset_symbol", value: input.assetSymbol.trim().toUpperCase() } as const),
    input.coinType === undefined
      ? undefined
      : ({ kind: "coin_type", value: normalizedHistoryCoinType(input.coinType) } as const)
  ].filter((selector): selector is DeepbookUsdcPriceHistorySelector => selector !== undefined && selector.value.length > 0);

  if (selectors.length !== 1) {
    throw new ReadServiceInputError(
      "input_invalid",
      "Provide exactly one DeepBook USDC history selector: pairId, assetSymbol, or coinType",
      {
        fields: ["pairId", "assetSymbol", "coinType"],
        providedSelectorCount: selectors.length
      }
    );
  }
  return selectors[0]!;
}

function normalizedHistoryCoinType(value: string): string {
  try {
    return normalizeCoinType(value);
  } catch {
    throw new ReadServiceInputError("input_invalid", "coinType must be a valid Sui coin type", {
      field: "coinType",
      value
    });
  }
}

function deepbookUsdcPriceHistoryRange(start: string, end: string): DeepbookUsdcPriceHistoryRange {
  const startDate = parseUtcIsoHistoryDate(start, "start");
  const endDate = parseUtcIsoHistoryDate(end, "end");
  const durationMs = endDate.getTime() - startDate.getTime();
  if (durationMs <= 0) {
    throw new ReadServiceInputError("input_invalid", "end must be after start for DeepBook USDC history", {
      start,
      end
    });
  }
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    timeZone: "UTC",
    barIntervalMinutes: DEEPBOOK_USDC_INDEX_BAR_INTERVAL_MINUTES,
    maxBars: MAX_DEEPBOOK_USDC_PRICE_HISTORY_BARS,
    requestedBarSlots: Math.ceil(durationMs / DEEPBOOK_USDC_PRICE_HISTORY_INTERVAL_MS)
  };
}

function deepbookUsdcPriceAtTimeTarget(input: DeepbookUsdcPriceAtTimeInput): DeepbookUsdcPriceAtTimeTarget {
  const target = parseUtcIsoHistoryDate(input.targetTime, "targetTime");
  const maxDistanceMinutes = input.maxDistanceMinutes ?? DEFAULT_DEEPBOOK_USDC_PRICE_AT_TIME_MAX_DISTANCE_MINUTES;
  if (!Number.isInteger(maxDistanceMinutes) || maxDistanceMinutes <= 0) {
    throw new ReadServiceInputError("input_invalid", "maxDistanceMinutes must be a positive integer", {
      field: "maxDistanceMinutes",
      value: input.maxDistanceMinutes
    });
  }
  const maxSearchMinutes = Math.floor(
    (MAX_DEEPBOOK_USDC_PRICE_HISTORY_BARS * DEEPBOOK_USDC_INDEX_BAR_INTERVAL_MINUTES -
      DEEPBOOK_USDC_INDEX_BAR_INTERVAL_MINUTES) /
      2
  );
  if (maxDistanceMinutes > maxSearchMinutes) {
    throw new ReadServiceInputError("input_invalid", "maxDistanceMinutes exceeds the supported DeepBook USDC search window", {
      field: "maxDistanceMinutes",
      maxDistanceMinutes,
      maxSupportedMinutes: maxSearchMinutes
    });
  }

  const targetMs = target.getTime();
  const start = new Date(targetMs - maxDistanceMinutes * 60 * 1000);
  const end = new Date(targetMs + maxDistanceMinutes * 60 * 1000 + DEEPBOOK_USDC_PRICE_HISTORY_INTERVAL_MS);
  return {
    targetTime: target.toISOString(),
    searchWindow: {
      start: start.toISOString(),
      end: end.toISOString(),
      maxDistanceMinutes
    }
  };
}

function parseUtcIsoHistoryDate(value: string, field: "start" | "end" | "targetTime"): Date {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new ReadServiceInputError("input_invalid", `${field} must be an ISO UTC timestamp`, { field, value });
  }
  const date = new Date(timestamp);
  if (date.toISOString() !== value) {
    throw new ReadServiceInputError("input_invalid", `${field} must be a canonical ISO UTC timestamp`, {
      field,
      value
    });
  }
  return date;
}

function deepbookUsdcPriceHistoryMatchingPairs(
  enabledPairs: DeepbookUsdcIndexPair[],
  selector: DeepbookUsdcPriceHistorySelector
): DeepbookUsdcIndexPair[] {
  switch (selector.kind) {
    case "pair_id":
      return enabledPairs.filter((pair) => pair.id === selector.value);
    case "asset_symbol":
      return enabledPairs.filter((pair) => pair.baseAsset.symbol.toUpperCase() === selector.value);
    case "coin_type":
      return enabledPairs.filter((pair) => normalizeCoinType(pair.baseAsset.coinType) === selector.value);
  }
}

function utcIsoWeeksForRange(start: string, end: string): UtcIsoWeek[] {
  const endMs = Date.parse(end);
  let cursor = new Date(start);
  const weeks: UtcIsoWeek[] = [];
  const seen = new Set<string>();
  while (cursor.getTime() < endMs) {
    const week = utcIsoWeekFromDate(cursor);
    const key = `${week.weekYear}:${week.week}`;
    if (!seen.has(key)) {
      seen.add(key);
      weeks.push(week);
    }
    const nextUtcDay = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1);
    cursor = new Date(Math.min(nextUtcDay, endMs));
  }
  return weeks;
}

function deepbookUsdcPriceHistoryPair(
  pair: DeepbookUsdcIndexPair,
  quoteCoinType: string
): DeepbookUsdcPriceHistoryPair {
  return {
    pairId: pair.id,
    poolId: pair.poolId,
    baseAsset: pair.baseAsset,
    quoteAsset: {
      symbol: "USDC",
      coinType: quoteCoinType,
      decimals: 6
    },
    priceConvention: DEEPBOOK_USDC_INDEX_PRICE_CONVENTION,
    barIntervalMinutes: DEEPBOOK_USDC_INDEX_BAR_INTERVAL_MINUTES
  };
}

function deepbookUsdcPriceHistorySource(input: {
  registrySource: DeepbookUsdcIndexFetchSource;
  weeklyResults: Array<{ week: UtcIsoWeek; result: DeepbookUsdcIndexWeeklyBarsResult }>;
}): DeepbookUsdcPriceHistorySource {
  const requested = input.weeklyResults.map((entry) => weeklyFileReference(entry.week, entry.result.source));
  const found: DeepbookUsdcPriceHistoryFoundFileReference[] = input.weeklyResults
    .filter((entry): entry is { week: UtcIsoWeek; result: Extract<DeepbookUsdcIndexWeeklyBarsResult, { status: "found" }> } =>
      entry.result.status === "found"
    )
    .map((entry) => ({
      ...weeklyFileReference(entry.week, entry.result.source),
      fetchedAt: entry.result.source.fetchedAt
    }));
  const missing = input.weeklyResults
    .filter((entry): entry is { week: UtcIsoWeek; result: Extract<DeepbookUsdcIndexWeeklyBarsResult, { status: "missing_file" }> } =>
      entry.result.status === "missing_file"
    )
    .map((entry) => weeklyFileReference(entry.week, entry.result.source));

  return {
    kind: "external_precomputed_deepbook_usdc_index",
    repositoryUrl: input.registrySource.repositoryUrl,
    baseUrl: input.registrySource.baseUrl,
    sourceRef: input.registrySource.sourceRef,
    registry: {
      path: input.registrySource.path,
      url: input.registrySource.url,
      fetchedAt: input.registrySource.fetchedAt
    },
    weeklyFiles: { requested, found, missing },
    chainRecomputedBySayUrIntent: false
  };
}

type FilledDeepbookUsdcHistoryBar = DeepbookUsdcPriceHistoryBar & {
  status: "filled";
  open: string;
  high: string;
  low: string;
  close: string;
};

function deepbookUsdcPriceAtTimeMatch(input: {
  target: DeepbookUsdcPriceAtTimeTarget;
  pair: DeepbookUsdcPriceHistoryPair;
  bars: DeepbookUsdcPriceHistoryBar[];
}): { bar: FilledDeepbookUsdcHistoryBar; match: DeepbookUsdcPriceAtTimeMatch } | undefined {
  const targetMs = Date.parse(input.target.targetTime);
  const filledBars = input.bars.filter((bar): bar is FilledDeepbookUsdcHistoryBar =>
    bar.status === "filled" && bar.open !== null && bar.high !== null && bar.low !== null && bar.close !== null
  );
  const exact = filledBars.find((bar) => {
    const startMs = Date.parse(bar.start);
    const endMs = Date.parse(bar.end);
    return targetMs >= startMs && targetMs < endMs;
  });
  if (exact !== undefined) {
    return {
      bar: exact,
      match: deepbookUsdcPriceAtTimeMatchFromBar({
        kind: "exact_bucket",
        distanceMinutes: 0,
        pair: input.pair,
        bar: exact
      })
    };
  }

  const candidates = filledBars
    .map((bar) => {
      const startMs = Date.parse(bar.start);
      const endMs = Date.parse(bar.end);
      const before = endMs <= targetMs;
      const after = startMs > targetMs;
      const distanceMinutes = before
        ? (targetMs - endMs) / 60_000
        : after
          ? (startMs - targetMs) / 60_000
          : 0;
      return {
        bar,
        kind: before ? ("nearest_before" as const) : ("nearest_after" as const),
        distanceMinutes
      };
    })
    .filter((candidate) => candidate.distanceMinutes <= input.target.searchWindow.maxDistanceMinutes)
    .sort((left, right) => {
      const byDistance = left.distanceMinutes - right.distanceMinutes;
      if (byDistance !== 0) {
        return byDistance;
      }
      if (left.kind !== right.kind) {
        return left.kind === "nearest_before" ? -1 : 1;
      }
      return Date.parse(left.bar.start) - Date.parse(right.bar.start);
    });

  const best = candidates[0];
  if (best === undefined) {
    return undefined;
  }
  return {
    bar: best.bar,
    match: deepbookUsdcPriceAtTimeMatchFromBar({
      kind: best.kind,
      distanceMinutes: best.distanceMinutes,
      pair: input.pair,
      bar: best.bar
    })
  };
}

function deepbookUsdcPriceAtTimeMatchFromBar(input: {
  kind: DeepbookUsdcPriceAtTimeMatch["kind"];
  distanceMinutes: number;
  pair: DeepbookUsdcPriceHistoryPair;
  bar: FilledDeepbookUsdcHistoryBar;
}): DeepbookUsdcPriceAtTimeMatch {
  return {
    kind: input.kind,
    distanceMinutes: Number(input.distanceMinutes.toFixed(6)),
    representativePrice: {
      field: "matchedBar.close",
      value: input.bar.close,
      quoteAsset: "USDC",
      baseAssetSymbol: input.pair.baseAsset.symbol,
      priceConvention: "USDC_PER_BASE"
    }
  };
}

function weeklyFileReference(week: UtcIsoWeek, source: { path: string; url: string }): DeepbookUsdcPriceHistoryFileReference {
  return {
    week,
    path: source.path,
    url: source.url
  };
}

export class SuiReadService {
  readonly #client: SuiReadCoreClient;
  readonly #network: "mainnet";
  readonly #chainIdentifier: string;
  readonly #coinMetadataCache: CoinMetadataCache;
  readonly #now: () => Date;
  readonly #deepbookFactory: (simulationSender: string, options?: DeepBookFactoryOptions) => DeepBookReadClient;
  readonly #coinMetadataTtlMs: number;
  readonly #deepbookCoins: DeepBookCoinRegistry;
  readonly #flowxQuoteClient: FlowxQuoteClient;
  readonly #deepbookUsdcIndexSource: DeepbookUsdcIndexSourceClient | undefined;

  constructor(options: SuiReadServiceOptions) {
    this.#client = options.client;
    this.#network = options.network;
    this.#chainIdentifier = options.chainIdentifier;
    this.#coinMetadataCache = options.coinMetadataCache;
    this.#now = options.now ?? (() => new Date());
    this.#coinMetadataTtlMs = options.coinMetadataTtlMs ?? COIN_METADATA_CACHE_TTL_MS;
    this.#deepbookCoins = options.deepbookCoins ?? PINNED_DEEPBOOK_COINS;
    this.#deepbookFactory =
      options.deepbookFactory ??
      ((simulationSender, factoryOptions) =>
        createDeepBookReadClient({
          client: options.client as SuiGrpcClient,
          simulationSender,
          network: this.#network,
          ...(factoryOptions?.balanceManagers === undefined
            ? {}
            : { balanceManagers: factoryOptions.balanceManagers })
        }));
    this.#flowxQuoteClient = options.flowxQuoteClient ?? createFlowxQuoteClient();
    this.#deepbookUsdcIndexSource = options.deepbookUsdcIndexSource;
  }

  async quoteFlowxSwap(input: {
    sourceSymbol: string;
    targetSymbol: string;
    amountDisplay: string;
  }): Promise<FlowxSwapQuoteSummary> {
    const pair = resolveFlowxSwapPair({
      sourceSymbol: input.sourceSymbol,
      targetSymbol: input.targetSymbol
    });
    const amountInRaw = parseQuoteDisplayAmount(input.amountDisplay, pair.source.decimals);

    const quote = await this.#flowxQuoteClient.getSwapRoutes({
      tokenInType: pair.source.coinType,
      tokenOutType: pair.target.coinType,
      amountInRaw
    });
    const { pools } = validateFlowxRouteQuote({ pair, requestedAmountInRaw: amountInRaw, quote });

    return {
      status: "ok",
      pair: {
        sourceSymbol: pair.source.symbol,
        targetSymbol: pair.target.symbol,
        sourceCoinType: pair.source.coinType,
        targetCoinType: pair.target.coinType
      },
      amountIn: {
        raw: amountInRaw,
        display: formatRawAmount(amountInRaw, pair.source.decimals),
        decimals: pair.source.decimals
      },
      amountOut: {
        raw: quote.amountOutRaw,
        display: formatRawAmount(quote.amountOutRaw, pair.target.decimals),
        decimals: pair.target.decimals,
        indicative: true
      },
      routeEvidence: {
        kind: "flowx_aggregator_route",
        routeSource: "flowx_quoter_api",
        routeChosenBy: "flowx_router_not_this_server",
        singleHop: true,
        pools,
        protocolConfigPinMatch: true
      },
      fetchedAt: this.#fetchedAt(),
      userAnswerUse: flowxQuoteUserAnswerUse(),
      quantitySemantics: flowxQuoteQuantitySemantics(),
      source: {
        sdk: "@flowx-finance/sdk",
        transport: "https",
        method: "AggregatorQuoter.getRoutes",
        chainVerified: false
      }
    };
  }

  async summarizeWalletAssets(input: WalletBalanceInput): Promise<WalletBalanceSummary> {
    const options: SuiClientTypes.ListBalancesOptions = { owner: input.account };
    if (input.cursor !== undefined) {
      options.cursor = input.cursor;
    }
    const result = await this.#client.core.listBalances(options);
    const balances: WalletBalanceWithUnit[] = [];
    for (const balance of result.balances) {
      balances.push(await this.#withUnit(balance));
    }

    return {
      status: "ok",
      account: input.account,
      fetchedAt: this.#fetchedAt(),
      userAnswerUse: walletBalanceUserAnswerUse(),
      quantitySemantics: walletBalanceQuantitySemantics(),
      source: {
        sdk: "@mysten/sui",
        transport: "grpc",
        method: "client.core.listBalances"
      },
      balances,
      hasNextPage: result.hasNextPage,
      cursor: result.cursor
    };
  }

  async classifyWalletAssets(input: WalletBalanceInput): Promise<WalletAssetClassificationSummary> {
    const summary = await this.summarizeWalletAssets(input);
    return {
      status: "ok",
      account: summary.account,
      fetchedAt: summary.fetchedAt,
      userAnswerUse: walletClassificationUserAnswerUse(),
      quantitySemantics: summary.quantitySemantics,
      source: summary.source,
      classifiedAssets: summary.balances.map((balance) => classifyWalletBalance(balance, this.#deepbookCoins)),
      uninspectedAssetClasses: NOT_INSPECTED_ASSET_CLASSES.map((assetClass) => ({ ...assetClass })),
      hasNextPage: summary.hasNextPage,
      cursor: summary.cursor
    };
  }

  listSettlementAssetGroups(): SettlementAssetGroupListSummary {
    return {
      status: "ok",
      fetchedAt: this.#fetchedAt(),
      assetGroups: [buildUsdSettlementAssetGroup(this.#deepbookCoins)]
    };
  }

  async summarizeSettlementAssetGroupParity(
    input: SettlementAssetGroupParityInput & { simulationSender: string }
  ): Promise<SettlementAssetGroupParitySummary> {
    let denomination: SettlementAssetGroupParitySummary["denomination"];
    try {
      denomination = normalizeSettlementDenomination(input.denomination);
    } catch {
      throw new ReadServiceInputError("input_invalid", "Unsupported settlement denomination", {
        field: "denomination",
        value: input.denomination,
        supportedAliases: buildUsdSettlementAssetGroup(this.#deepbookCoins).aliases
      });
    }

    const assetGroup = buildUsdSettlementAssetGroup(this.#deepbookCoins);
    if (assetGroup.includedAssets.length === 0) {
      throw new ReadServiceInputError("registry_miss", "No pinned USD-denominated settlement assets are available", {
        assetGroupId: assetGroup.id
      });
    }
    const referenceAsset = this.#resolveSettlementAssetGroupSymbol(
      input.referenceAssetSymbol ?? "USDC",
      assetGroup,
      "referenceAssetSymbol"
    );
    const deepbook = this.#deepbookFactory(input.simulationSender);
    const assets = await Promise.all(
      assetGroup.includedAssets.map((asset) => this.#settlementAssetGroupParityAsset(asset, referenceAsset, deepbook))
    );
    const samples = assets.filter(
      (asset): asset is Extract<SettlementAssetGroupParityAsset, { status: "reference_asset" | "measured" }> =>
        asset.status === "reference_asset" || asset.status === "measured"
    );
    if (samples.length === 0) {
      throw new ReadServiceInputError("registry_miss", "No parity samples are available for the settlement asset group", {
        assetGroupId: assetGroup.id,
        referenceAssetSymbol: referenceAsset.symbol
      });
    }
    const statistics = settlementAssetGroupParityStatistics(samples, assets.length - samples.length);

    return {
      status: "ok",
      fetchedAt: this.#fetchedAt(),
      denomination,
      assetGroupId: assetGroup.id,
      userAnswerUse: settlementAssetGroupParityUserAnswerUse(),
      referenceAsset: {
        ...referenceAsset,
        role: "measurement_reference_not_settlement_choice"
      },
      quantitySemantics: settlementAssetGroupParityQuantitySemantics(),
      evidenceSources: {
        settlementAssetGroup: assetGroup.evidenceSources,
        midPrice: {
          sdk: "@mysten/deepbook-v3",
          transport: "grpc",
          simulation: "client.core.simulateTransaction",
          method: "midPrice",
          precision: DEEPBOOK_MID_PRICE_PRECISION
        }
      },
      assets,
      statistics,
      responseSummary: settlementAssetGroupParityResponseSummary({
        assetGroupId: assetGroup.id,
        referenceAssetSymbol: referenceAsset.symbol,
        statistics
      }),
      unsupportedClaims: [
        "settlement_token_selection",
        "fiat_usd_cash_out",
        "payment_execution_readiness",
        "route_recommendation",
        "best_route",
        "transaction_building",
        "signing_readiness",
        "profit_or_pnl",
        "cost_basis"
      ]
    };
  }

  async previewIntentEvidence(input: IntentEvidenceInput): Promise<IntentEvidenceSummary> {
    if (!isSupportedIntentEvidenceKind(input.intentKind)) {
      throw new ReadServiceInputError("input_invalid", "Unsupported intentKind", {
        field: "intentKind",
        value: input.intentKind
      });
    }
    if (input.intentKind === "cover_payment_like_amount" && input.requiredDisplayAmount === undefined) {
      throw new ReadServiceInputError("input_invalid", "requiredDisplayAmount is required for cover_payment_like_amount", {
        field: "requiredDisplayAmount",
        intentKind: input.intentKind
      });
    }
    if (
      input.targetAssetSelectionSource !== undefined &&
      !isIntentEvidenceTargetAssetSelectionSource(input.targetAssetSelectionSource)
    ) {
      throw new ReadServiceInputError("input_invalid", "Unsupported targetAssetSelectionSource", {
        field: "targetAssetSelectionSource",
        value: input.targetAssetSelectionSource,
        supportedValues: [...INTENT_EVIDENCE_TARGET_ASSET_SELECTION_SOURCES]
      });
    }
    if (input.intentKind === "summarize_settlement_asset_group_balance") {
      if (input.requiredDisplayAmount !== undefined) {
        throw new ReadServiceInputError(
          "input_invalid",
          "requiredDisplayAmount is only supported for cover_payment_like_amount",
          {
            field: "requiredDisplayAmount",
            intentKind: input.intentKind
          }
        );
      }
      if (input.targetAssetSymbol !== undefined) {
        throw new ReadServiceInputError(
          "input_invalid",
          "targetAssetSymbol is only supported for cover_payment_like_amount",
          {
            field: "targetAssetSymbol",
            intentKind: input.intentKind
          }
        );
      }
      if (input.targetAssetSelectionSource !== undefined) {
        throw new ReadServiceInputError(
          "input_invalid",
          "targetAssetSelectionSource is only supported for cover_payment_like_amount",
          {
            field: "targetAssetSelectionSource",
            intentKind: input.intentKind
          }
        );
      }
      if (input.acceptedSourceAssetSymbols !== undefined) {
        throw new ReadServiceInputError(
          "input_invalid",
          "acceptedSourceAssetSymbols is only supported for cover_payment_like_amount",
          {
            field: "acceptedSourceAssetSymbols",
            intentKind: input.intentKind
          }
        );
      }
    }
    if (input.intentKind === "cover_payment_like_amount") {
      if (input.targetAssetSymbol !== undefined && input.targetAssetSelectionSource === undefined) {
        throw new ReadServiceInputError(
          "input_invalid",
          "targetAssetSelectionSource is required when targetAssetSymbol is supplied",
          {
            field: "targetAssetSelectionSource",
            requiredWith: "targetAssetSymbol",
            supportedValues: [...INTENT_EVIDENCE_TARGET_ASSET_SELECTION_SOURCES]
          }
        );
      }
      if (input.targetAssetSymbol === undefined && input.targetAssetSelectionSource !== undefined) {
        throw new ReadServiceInputError(
          "input_invalid",
          "targetAssetSymbol is required when targetAssetSelectionSource is supplied",
          {
            field: "targetAssetSymbol",
            requiredWith: "targetAssetSelectionSource"
          }
        );
      }
    }

    let denomination: IntentEvidenceSummary["intent"]["denomination"];
    try {
      denomination = normalizeSettlementDenomination(input.denomination);
    } catch {
      throw new ReadServiceInputError("input_invalid", "Unsupported settlement denomination", {
        field: "denomination",
        value: input.denomination,
        supportedAliases: buildUsdSettlementAssetGroup(this.#deepbookCoins).aliases
      });
    }

    const assetGroup = buildUsdSettlementAssetGroup(this.#deepbookCoins);
    if (assetGroup.includedAssets.length === 0) {
      throw new ReadServiceInputError("registry_miss", "No pinned USD-denominated settlement assets are available", {
        assetGroupId: assetGroup.id
      });
    }

    const targetAsset =
      input.intentKind !== "cover_payment_like_amount" || input.targetAssetSymbol === undefined
        ? undefined
        : this.#resolveSettlementAssetGroupSymbol(input.targetAssetSymbol, assetGroup, "targetAssetSymbol");
    const targetAssetSelectionSource =
      targetAsset === undefined ? undefined : input.targetAssetSelectionSource;
    const acceptedSourceSymbols =
      input.intentKind !== "cover_payment_like_amount" || input.acceptedSourceAssetSymbols === undefined
        ? undefined
        : input.acceptedSourceAssetSymbols.map((symbol, index) =>
            this.#resolveSettlementAssetGroupSymbol(symbol, assetGroup, `acceptedSourceAssetSymbols[${index}]`).symbol
          );
    const acceptedSourceSet =
      acceptedSourceSymbols === undefined ? undefined : new Set(acceptedSourceSymbols);

    const scan = await this.#scanWalletAssetClassificationPages(input.account);
    const balances = this.#intentEvidenceAssetGroupBalances(assetGroup, scan.classifiedAssets);
    const commonDecimals = commonAssetGroupDecimals(assetGroup.includedAssets);
    const aggregate = this.#intentEvidenceAggregate({
      requiredDisplayAmount: input.requiredDisplayAmount,
      balances,
      commonDecimals,
      blockedReason: scan.blockedReason
    });
    const settlementAssetCoverage = this.#intentEvidenceSettlementAssetCoverage(aggregate);
    const requiredDisplayAmount = input.requiredDisplayAmount;
    let selectedTarget: IntentEvidenceSelectedTarget | undefined;
    if (targetAsset !== undefined) {
      if (requiredDisplayAmount === undefined) {
        throw new Error("target settlement evidence requires requiredDisplayAmount");
      }
      if (targetAssetSelectionSource === undefined) {
        throw new Error("target settlement evidence requires user selection provenance");
      }
      if (scan.blockedReason === undefined) {
        selectedTarget = this.#intentEvidenceSelectedTarget({
          targetAsset,
          selectionSource: targetAssetSelectionSource,
          requiredDisplayAmount,
          balances
        });
      }
    }

    const candidateConversions =
      input.intentKind === "cover_payment_like_amount" && scan.blockedReason === undefined
        ? await this.#intentEvidenceCandidateConversions({
            targetAsset,
            balances,
            acceptedSourceSet
          })
        : [];
    const requiredUserChoices = this.#intentEvidenceRequiredUserChoices(
      input.intentKind,
      targetAsset,
      candidateConversions
    );
    const responseEvidence = intentEvidenceResponseEvidence(targetAsset, settlementAssetCoverage, candidateConversions);
    const responseSummary = intentEvidenceResponseSummary({
      intentKind: input.intentKind,
      assetGroupId: assetGroup.id,
      settlementAssetCoverage,
      responseEvidenceMode: responseEvidence.mode,
      requiredUserChoices
    });
    const { excludedAssets: _excludedAssets, ...settlementAssetGroup } = assetGroup;

    return {
      status: "ok",
      account: input.account,
      fetchedAt: this.#fetchedAt(),
      userAnswerUse: intentEvidenceUserAnswerUse(settlementAssetCoverage.status, responseEvidence),
      intent: {
        intentKind: input.intentKind,
        denomination,
        ...(input.requiredDisplayAmount === undefined ? {} : { requiredDisplayAmount: input.requiredDisplayAmount }),
        ...(targetAsset === undefined
          ? {}
          : { targetAssetSymbol: targetAsset.symbol, targetAssetSelectionSource }),
        ...(acceptedSourceSymbols === undefined ? {} : { acceptedSourceAssetSymbols: acceptedSourceSymbols })
      },
      quantitySemantics: intentEvidenceQuantitySemantics(),
      evidenceSources: {
        walletBalances: {
          sdk: "@mysten/sui",
          transport: "grpc",
          method: "client.core.listBalances"
        },
        settlementAssetGroup: assetGroup.evidenceSources,
        quoteEvidence: "pinned_deepbook_sdk_when_target_asset_selected"
      },
      settlementAssetGroup,
      balances,
      aggregate,
      settlementAssetCoverage,
      ...(selectedTarget === undefined ? {} : { selectedTarget }),
      candidateConversions,
      blockedReasons: scan.blockedReason === undefined ? [] : [scan.blockedReason],
      responseEvidence,
      responseSummary,
      requiredUserChoices,
      supportedClaims: intentEvidenceSupportedClaims(settlementAssetCoverage, selectedTarget, candidateConversions),
      unsupportedClaims: [
        "settlement_token_selection",
        "fiat_usd_cash_out",
        "gas_reserve_or_fee_readiness",
        "best_route_or_venue_comparison",
        "route_dependent_payment_support",
        "payment_execution_readiness",
        "transaction_building",
        "signing_readiness",
        "profit_or_pnl",
        "cost_basis"
      ],
      uninspectedAssetClasses: scan.uninspectedAssetClasses,
      inspectedBalancePages: scan.inspectedBalancePages,
      inspectedCoinBalanceCount: scan.inspectedCoinBalanceCount
    };
  }

  async inspectDeepbookOrderbook(input: {
    poolKey: string;
    ticks: number;
    simulationSender: string;
  }): Promise<DeepbookOrderbookSummary> {
    getKnownPool(input.poolKey);
    assertPositiveInteger(input.ticks, "ticks", MAX_DEEPBOOK_ORDERBOOK_TICKS);

    const deepbook = this.#deepbookFactory(input.simulationSender);
    const [midPrice, poolBookParams, level2TicksFromMid] = await Promise.all([
      deepbook.midPrice(input.poolKey),
      deepbook.poolBookParams(input.poolKey),
      deepbook.getLevel2TicksFromMid(input.poolKey, input.ticks)
    ]);
    const checkedMidPrice = assertValidDeepbookMidPrice(input.poolKey, midPrice);

    return {
      status: "ok",
      poolKey: input.poolKey,
      ticks: input.ticks,
      fetchedAt: this.#fetchedAt(),
      userAnswerUse: deepbookOrderbookUserAnswerUse(),
      source: {
        sdk: "@mysten/deepbook-v3",
        transport: "grpc",
        simulation: "client.core.simulateTransaction",
        methods: ["midPrice", "poolBookParams", "getLevel2TicksFromMid"]
      },
      midPrice: checkedMidPrice,
      poolBookParams,
      level2TicksFromMid
    };
  }

  async getDeepbookMidPrice(input: {
    poolKey: string;
    simulationSender: string;
  }): Promise<DeepbookMidPriceSummary> {
    const pool = getKnownPool(input.poolKey);
    const deepbook = this.#deepbookFactory(input.simulationSender);
    const midPrice = assertValidDeepbookMidPrice(input.poolKey, await deepbook.midPrice(input.poolKey));

    return {
      status: "ok",
      poolKey: input.poolKey,
      base: pool.baseCoin,
      quote: pool.quoteCoin,
      userAnswerUse: deepbookMidPriceUserAnswerUse(),
      priceSemantics: deepbookMidPriceSemantics(),
      price: midPrice,
      priceDirection: DEEPBOOK_MID_PRICE_DIRECTION,
      priceType: DEEPBOOK_MID_PRICE_TYPE,
      fetchedAt: this.#fetchedAt(),
      source: {
        sdk: "@mysten/deepbook-v3",
        transport: "grpc",
        simulation: "client.core.simulateTransaction",
        method: "midPrice",
        precision: DEEPBOOK_MID_PRICE_PRECISION
      }
    };
  }

  async getDeepbookUsdcPriceHistory(input: DeepbookUsdcPriceHistoryInput): Promise<DeepbookUsdcPriceHistorySummary> {
    const fetchedAt = this.#fetchedAt();
    const selector = deepbookUsdcPriceHistorySelector(input);
    const range = deepbookUsdcPriceHistoryRange(input.start, input.end);
    const common = {
      fetchedAt,
      requested: { selector, range },
      userAnswerUse: deepbookUsdcPriceHistoryUserAnswerUse(),
      quantitySemantics: deepbookUsdcPriceHistoryQuantitySemantics(),
      responseSummary: DEEPBOOK_USDC_PRICE_HISTORY_RESPONSE_SUMMARY,
      unsupportedClaims: [...DEEPBOOK_USDC_PRICE_HISTORY_UNSUPPORTED_CLAIMS]
    } satisfies {
      fetchedAt: string;
      requested: { selector: DeepbookUsdcPriceHistorySelector; range: DeepbookUsdcPriceHistoryRange };
      userAnswerUse: ReturnType<typeof deepbookUsdcPriceHistoryUserAnswerUse>;
      quantitySemantics: DeepbookUsdcPriceHistoryQuantitySemantics;
      responseSummary: DeepbookUsdcPriceHistoryResponseSummary;
      unsupportedClaims: DeepbookUsdcPriceHistoryUnsupportedClaim[];
    };

    if (range.requestedBarSlots > MAX_DEEPBOOK_USDC_PRICE_HISTORY_BARS) {
      return {
        status: "unsupported_range",
        ...common,
        reason: "requested_range_exceeds_max_bars"
      };
    }

    if (this.#deepbookUsdcIndexSource === undefined) {
      return {
        status: "source_unavailable",
        ...common,
        reason: "index_source_not_configured"
      };
    }

    let registryResult: Awaited<ReturnType<DeepbookUsdcIndexSourceClient["fetchRegistry"]>>;
    try {
      registryResult = await this.#deepbookUsdcIndexSource.fetchRegistry();
    } catch {
      return {
        status: "source_unavailable",
        ...common,
        reason: "registry_unavailable"
      };
    }

    const enabledPairs = registryResult.registry.pairs.filter((pair) => pair.enabled);
    const matchingPairs = deepbookUsdcPriceHistoryMatchingPairs(enabledPairs, selector);
    if (matchingPairs.length !== 1) {
      return {
        status: "unsupported_pair",
        ...common,
        reason:
          matchingPairs.length === 0
            ? "selector_not_in_index_registry"
            : "selector_resolves_to_multiple_enabled_pairs",
        matchingPairIds: matchingPairs.map((pair) => pair.id),
        availablePairIds: enabledPairs.map((pair) => pair.id)
      };
    }

    const pair = matchingPairs[0]!;
    const weeks = utcIsoWeeksForRange(input.start, input.end);
    let weeklyResults: Array<{ week: UtcIsoWeek; result: DeepbookUsdcIndexWeeklyBarsResult }>;
    try {
      weeklyResults = await Promise.all(
        weeks.map(async (week) => ({
          week,
          result: await this.#deepbookUsdcIndexSource!.fetchWeeklyBars(pair.id, week)
        }))
      );
    } catch {
      return {
        status: "source_unavailable",
        ...common,
        reason: "weekly_file_fetch_failed",
        pair: deepbookUsdcPriceHistoryPair(pair, registryResult.registry.quoteAsset.coinType)
      };
    }

    const foundResults = weeklyResults.filter(
      (entry): entry is { week: UtcIsoWeek; result: Extract<DeepbookUsdcIndexWeeklyBarsResult, { status: "found" }> } =>
        entry.result.status === "found"
    );
    const missingResults = weeklyResults.filter(
      (entry): entry is { week: UtcIsoWeek; result: Extract<DeepbookUsdcIndexWeeklyBarsResult, { status: "missing_file" }> } =>
        entry.result.status === "missing_file"
    );
    const source = deepbookUsdcPriceHistorySource({
      registrySource: registryResult.source,
      weeklyResults
    });
    const outputPair = deepbookUsdcPriceHistoryPair(pair, registryResult.registry.quoteAsset.coinType);

    if (foundResults.length === 0) {
      return {
        status: "source_unavailable",
        ...common,
        reason: "weekly_files_missing",
        pair: outputPair,
        source
      };
    }

    const startMs = Date.parse(range.start);
    const endMs = Date.parse(range.end);
    const bars = foundResults
      .flatMap((entry) => entry.result.weeklyBars.bars)
      .filter((bar) => {
        const barStart = Date.parse(bar.start);
        return barStart >= startMs && barStart < endMs;
      })
      .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
    const coverageStatus =
      missingResults.length > 0
        ? "partial_missing_week_files"
        : bars.some((bar) => bar.status === "missing")
          ? "contains_missing_bars"
          : bars.length === 0
            ? "no_bars_in_range"
            : "complete";

    return {
      status: "ok",
      ...common,
      pair: outputPair,
      coverageStatus,
      barCount: bars.length,
      bars,
      source
    };
  }

  async getDeepbookUsdcPriceAtTime(input: DeepbookUsdcPriceAtTimeInput): Promise<DeepbookUsdcPriceAtTimeSummary> {
    const target = deepbookUsdcPriceAtTimeTarget(input);
    const history = await this.getDeepbookUsdcPriceHistory({
      pairId: input.pairId,
      assetSymbol: input.assetSymbol,
      coinType: input.coinType,
      start: target.searchWindow.start,
      end: target.searchWindow.end
    });
    const common = {
      fetchedAt: history.fetchedAt,
      target,
      requested: history.requested,
      quantitySemantics: history.quantitySemantics,
      responseSummary: history.responseSummary,
      unsupportedClaims: history.unsupportedClaims
    };

    if (history.status === "unsupported_pair") {
      return {
        status: "unsupported_pair",
        ...common,
        reason: history.reason,
        matchingPairIds: history.matchingPairIds,
        availablePairIds: history.availablePairIds,
        userAnswerUse: deepbookUsdcPriceAtTimeUserAnswerUse(false)
      };
    }
    if (history.status === "unsupported_range") {
      return {
        status: "unsupported_range",
        ...common,
        reason: history.reason,
        userAnswerUse: deepbookUsdcPriceAtTimeUserAnswerUse(false)
      };
    }
    if (history.status === "source_unavailable") {
      return {
        status: "source_unavailable",
        ...common,
        reason: history.reason,
        pair: history.pair,
        source: history.source,
        userAnswerUse: deepbookUsdcPriceAtTimeUserAnswerUse(false)
      };
    }

    const matched = deepbookUsdcPriceAtTimeMatch({
      target,
      pair: history.pair,
      bars: history.bars
    });
    if (matched === undefined) {
      return {
        status: "no_price_in_search_window",
        ...common,
        pair: history.pair,
        coverageStatus: history.coverageStatus,
        source: history.source,
        userAnswerUse: deepbookUsdcPriceAtTimeUserAnswerUse(false)
      };
    }

    return {
      status: "ok",
      ...common,
      pair: history.pair,
      match: matched.match,
      matchedBar: matched.bar,
      coverageStatus: history.coverageStatus,
      source: history.source,
      userAnswerUse: deepbookUsdcPriceAtTimeUserAnswerUse(true)
    };
  }

  async quoteDeepbookAction(input: {
    poolKey: string;
    direction: QuoteDirection;
    amountRaw: string;
    simulationSender: string;
    feeMode?: DeepbookQuoteFeeMode | undefined;
  }): Promise<DeepbookQuoteSummary> {
    const pool = getKnownPool(input.poolKey);
    const amount = parseRawAmount(input.amountRaw);
    const feeMode = input.feeMode ?? "deep";

    const deepbook = this.#deepbookFactory(input.simulationSender);
    if (feeMode === "input_coin" && (!deepbook.getQuoteQuantityOutInputFeeRaw || !deepbook.getBaseQuantityOutInputFeeRaw)) {
      throw new ReadServiceInputError("quote_unavailable", "Input-fee DeepBook quoting is not supported by this read client", {
        poolKey: input.poolKey
      });
    }
    const rawReturnValues =
      input.direction === "base_to_quote"
        ? feeMode === "input_coin"
          ? await deepbook.getQuoteQuantityOutInputFeeRaw!(input.poolKey, amount)
          : await deepbook.getQuoteQuantityOutRaw(input.poolKey, amount)
        : feeMode === "input_coin"
          ? await deepbook.getBaseQuantityOutInputFeeRaw!(input.poolKey, amount)
          : await deepbook.getBaseQuantityOutRaw(input.poolKey, amount);
    const rawQuote = this.#toDeepbookRawQuoteEvidence({
      poolKey: input.poolKey,
      direction: input.direction,
      amountRaw: input.amountRaw,
      rawReturnValues,
      feeMode
    });
    const quote = assertValidDeepbookQuote(
      input.poolKey,
      input.direction,
      toDeepbookDisplayQuoteFromRaw(rawReturnValues, this.#deepbookQuoteUnits(pool.baseCoin, pool.quoteCoin))
    );

    return {
      status: "ok",
      poolKey: input.poolKey,
      direction: input.direction,
      amountRaw: input.amountRaw,
      fetchedAt: this.#fetchedAt(),
      userAnswerUse: deepbookQuoteUserAnswerUse("raw"),
      quantitySemantics: deepbookQuoteQuantitySemantics("raw_u64"),
      source: {
        sdk: "@mysten/deepbook-v3",
        transport: "grpc",
        simulation: "client.core.simulateTransaction",
        method:
          input.direction === "base_to_quote"
            ? feeMode === "input_coin"
              ? "getQuoteQuantityOutInputFee"
              : "getQuoteQuantityOut"
            : feeMode === "input_coin"
              ? "getBaseQuantityOutInputFee"
              : "getBaseQuantityOut",
        returnValueEncoding: "bcs.u64"
      },
      quote,
      rawQuote
    };
  }

  async quoteDeepbookDisplayAmount(input: {
    poolKey: string;
    direction: QuoteDirection;
    amountDisplay: string;
    simulationSender: string;
    feeMode?: DeepbookQuoteFeeMode | undefined;
  }): Promise<DeepbookDisplayQuoteSummary> {
    const pool = getKnownPool(input.poolKey);
    const sourceSymbol = input.direction === "base_to_quote" ? pool.baseCoin : pool.quoteCoin;
    const sourceCoin = getDeepbookCoinEntryBySymbol(sourceSymbol, this.#deepbookCoins);
    const decimals = decimalsFromScalar(sourceCoin.coin.scalar);
    if (decimals === undefined) {
      throw invalidDeepbookScalar(sourceCoin.symbol, sourceCoin.coin.scalar);
    }
    const amountRaw = parseQuoteDisplayAmount(input.amountDisplay, decimals);
    const rawQuote = await this.quoteDeepbookAction({
      poolKey: input.poolKey,
      direction: input.direction,
      amountRaw,
      simulationSender: input.simulationSender,
      feeMode: input.feeMode
    });

    return {
      status: "ok",
      pool: {
        poolKey: input.poolKey,
        base: pool.baseCoin,
        quote: pool.quoteCoin
      },
      direction: input.direction,
      inputAmount: {
        display: input.amountDisplay,
        raw: amountRaw,
        asset: {
          symbol: sourceCoin.symbol,
          coinType: normalizeCoinType(sourceCoin.coin.type),
          decimals,
          unitSource: DEEPBOOK_SCALAR_UNIT_SOURCE
        }
      },
      fetchedAt: rawQuote.fetchedAt,
      userAnswerUse: deepbookQuoteUserAnswerUse("display"),
      quantitySemantics: deepbookQuoteQuantitySemantics("display_source_amount_converted_to_raw_u64"),
      source: rawQuote.source,
      quote: rawQuote.quote,
      rawQuote: rawQuote.rawQuote
    };
  }

  #toDeepbookRawQuoteEvidence(input: {
    poolKey: string;
    direction: QuoteDirection;
    amountRaw: string;
    rawReturnValues: DeepbookRawQuoteReturnValues;
    feeMode?: DeepbookQuoteFeeMode | undefined;
  }): DeepbookRawQuoteEvidence {
    const pool = getKnownPool(input.poolKey);
    const inputSymbol = input.direction === "base_to_quote" ? pool.baseCoin : pool.quoteCoin;
    const outputSymbol = input.direction === "base_to_quote" ? pool.quoteCoin : pool.baseCoin;
    const baseOut = this.#deepbookRawQuoteAmount(pool.baseCoin, input.rawReturnValues.baseOutRaw);
    const quoteOut = this.#deepbookRawQuoteAmount(pool.quoteCoin, input.rawReturnValues.quoteOutRaw);

    return {
      kind: DEEPBOOK_RAW_QUOTE_QUANTITY_KIND,
      sourceMoveFunction:
        input.direction === "base_to_quote"
          ? input.feeMode === "input_coin"
            ? "pool::get_quote_quantity_out_input_fee"
            : "pool::get_quote_quantity_out"
          : input.feeMode === "input_coin"
            ? "pool::get_base_quantity_out_input_fee"
            : "pool::get_base_quantity_out",
      returnValueSourceMoveFunction:
        input.feeMode === "input_coin" ? "pool::get_quantity_out_input_fee" : "pool::get_quantity_out",
      returnValueOrder: ["base_quantity_out", "quote_quantity_out", "deep_quantity_required"],
      inputAmount: this.#deepbookRawQuoteAmount(inputSymbol, input.amountRaw),
      baseOut,
      quoteOut,
      deepRequired: this.#deepbookRawQuoteAmount("DEEP", input.rawReturnValues.deepRequiredRaw),
      directionalOutput: outputSymbol === pool.baseCoin ? baseOut : quoteOut,
      boundary: {
        outputBeforeSlippagePolicy: true,
        notFor: [
          "final_min_out",
          "transaction_building",
          "signing_data",
          "signing_readiness",
          "price_impact",
          "mid_price_slippage",
          "quote_vs_mid_slippage",
          "effective_price",
          "venue_comparison",
          "best_route",
          "route_recommendation",
          "fiat_usd_cash_out",
          "external_market_price_conversion",
          "external_market_lookup",
          "usd_peg_assumption",
          "bank_cash_out_estimate",
          "profit_or_pnl",
          "cost_basis"
        ]
      }
    };
  }

  #deepbookRawQuoteAmount(symbol: string, raw: string): DeepbookRawQuoteAmount {
    const coin = getDeepbookCoinEntryBySymbol(symbol, this.#deepbookCoins);
    const decimals = decimalsFromScalar(coin.coin.scalar);
    if (decimals === undefined) {
      throw invalidDeepbookScalar(coin.symbol, coin.coin.scalar);
    }
    return {
      raw,
      symbol: coin.symbol,
      coinType: normalizeCoinType(coin.coin.type),
      decimals,
      unitSource: DEEPBOOK_SCALAR_UNIT_SOURCE
    };
  }

  #deepbookQuoteUnits(baseSymbol: string, quoteSymbol: string): {
    baseDecimals: number;
    quoteDecimals: number;
    deepDecimals: number;
  } {
    const baseCoin = getDeepbookCoinEntryBySymbol(baseSymbol, this.#deepbookCoins);
    const quoteCoin = getDeepbookCoinEntryBySymbol(quoteSymbol, this.#deepbookCoins);
    const deepCoin = getDeepbookCoinEntryBySymbol("DEEP", this.#deepbookCoins);
    const baseDecimals = decimalsFromScalar(baseCoin.coin.scalar);
    const quoteDecimals = decimalsFromScalar(quoteCoin.coin.scalar);
    const deepDecimals = decimalsFromScalar(deepCoin.coin.scalar);
    if (baseDecimals === undefined) {
      throw invalidDeepbookScalar(baseCoin.symbol, baseCoin.coin.scalar);
    }
    if (quoteDecimals === undefined) {
      throw invalidDeepbookScalar(quoteCoin.symbol, quoteCoin.coin.scalar);
    }
    if (deepDecimals === undefined) {
      throw invalidDeepbookScalar(deepCoin.symbol, deepCoin.coin.scalar);
    }
    return {
      baseDecimals,
      quoteDecimals,
      deepDecimals
    };
  }

  async summarizeDeepbookAccountInventory(
    input: DeepbookAccountInventoryInput
  ): Promise<DeepbookAccountInventorySummary> {
    const normalizedManagerAddress = normalizeOptionalManagerAddress(input.managerAddress);
    const pool = input.poolKey === undefined ? undefined : getKnownPool(input.poolKey);
    const discoveryClient = this.#deepbookFactory(input.account);
    const managerAddresses = normalizeManagerAddresses(await discoveryClient.getBalanceManagerIds(input.account));
    const requested = {
      ...(input.poolKey === undefined ? {} : { poolKey: input.poolKey }),
      ...(normalizedManagerAddress === undefined ? {} : { managerAddress: normalizedManagerAddress })
    };
    const base = {
      status: "ok" as const,
      account: input.account,
      fetchedAt: this.#fetchedAt(),
      requested,
      managerAddresses,
      quantitySemantics: deepbookDisplayQuantitySemantics(),
      ...(input.poolKey === undefined || pool === undefined
        ? {}
        : {
            pool: {
              poolKey: input.poolKey,
              base: pool.baseCoin,
              quote: pool.quoteCoin
            }
          })
    };

    if (input.poolKey === undefined && normalizedManagerAddress === undefined) {
      return {
        ...base,
        userAnswerUse: deepbookAccountInventoryUserAnswerUse("manager_discovery_only"),
        detailStatus: "manager_discovery_only",
        source: deepbookAccountInventorySource(["getBalanceManagerIds"])
      };
    }
    if (input.poolKey === undefined) {
      return {
        ...base,
        userAnswerUse: deepbookAccountInventoryUserAnswerUse("pool_key_required"),
        detailStatus: "pool_key_required",
        source: deepbookAccountInventorySource(["getBalanceManagerIds"])
      };
    }
    if (normalizedManagerAddress === undefined) {
      return {
        ...base,
        userAnswerUse: deepbookAccountInventoryUserAnswerUse("manager_address_required"),
        detailStatus: "manager_address_required",
        source: deepbookAccountInventorySource(["getBalanceManagerIds"])
      };
    }
    if (!managerAddresses.includes(normalizedManagerAddress)) {
      return {
        ...base,
        userAnswerUse: deepbookAccountInventoryUserAnswerUse("manager_address_not_discovered_for_active_account"),
        detailStatus: "manager_address_not_discovered_for_active_account",
        source: deepbookAccountInventorySource(["getBalanceManagerIds"])
      };
    }

    const detailClient = this.#deepbookFactory(input.account, {
      balanceManagers: {
        [normalizedManagerAddress]: { address: normalizedManagerAddress }
      }
    });
    const accountExists = await detailClient.accountExists(input.poolKey, normalizedManagerAddress);
    if (!accountExists) {
      return {
        ...base,
        userAnswerUse: deepbookAccountInventoryUserAnswerUse("account_not_found"),
        detailStatus: "account_not_found",
        source: deepbookAccountInventorySource(["getBalanceManagerIds", "accountExists"]),
        accountExists
      };
    }

    const [accountSummary, lockedBalances, openOrderIds] = await Promise.all([
      detailClient.account(input.poolKey, normalizedManagerAddress),
      detailClient.lockedBalance(input.poolKey, normalizedManagerAddress),
      detailClient.accountOpenOrders(input.poolKey, normalizedManagerAddress)
    ]);
    const cappedOpenOrderIds = openOrderIds.slice(0, MAX_DEEPBOOK_ACCOUNT_OPEN_ORDER_IDS);

    return {
      ...base,
      userAnswerUse: deepbookAccountInventoryUserAnswerUse("available"),
      detailStatus: "available",
      source: deepbookAccountInventorySource([
        "getBalanceManagerIds",
        "accountExists",
        "account",
        "lockedBalance",
        "accountOpenOrders"
      ]),
      accountExists,
      accountSummary: toDeepbookAccountSummary(accountSummary),
      lockedBalances: assertDeepbookDisplayBalances(lockedBalances, "lockedBalances"),
      openOrderIds: cappedOpenOrderIds,
      openOrderCount: openOrderIds.length,
      openOrderIdsTruncated: openOrderIds.length > cappedOpenOrderIds.length
    };
  }

  #resolveSettlementAssetGroupSymbol(symbol: string, assetGroup: SettlementAssetGroup, field: string): SettlementAssetGroupAsset {
    const canonical = canonicalDeepbookSymbol(symbol, this.#deepbookCoins);
    if (canonical === undefined) {
      throw new ReadServiceInputError("input_invalid", "Settlement asset symbol is not in the pinned DeepBook registry", {
        field,
        value: symbol
      });
    }
    const asset = assetGroup.includedAssets.find((candidate) => candidate.symbol === canonical);
    if (asset === undefined) {
      throw new ReadServiceInputError("input_invalid", "Settlement asset symbol is not in the supported assetGroup", {
        field,
        value: symbol,
        canonicalSymbol: canonical,
        assetGroupId: assetGroup.id
      });
    }
    return asset;
  }

  #intentEvidenceAssetGroupBalances(
    assetGroup: SettlementAssetGroup,
    classifiedAssets: ClassifiedWalletAsset[]
  ): IntentEvidenceSettlementAssetBalance[] {
    return assetGroup.includedAssets.map((asset) => {
      const matchingBalances = classifiedAssets
        .filter((classified) => {
          try {
            return normalizeCoinType(classified.balance.coinType) === asset.coinType;
          } catch {
            return false;
          }
        })
        .map((classified) => classified.balance.balance);
      const currentRawAmount = sumRawAmounts(matchingBalances);
      return {
        ...asset,
        currentRawAmount,
        currentDisplayAmount: formatSettlementAssetRawAmount(currentRawAmount, asset.decimals),
        walletBalanceEvidence: "current_wallet_coin_balance_snapshot"
      };
    });
  }

  #intentEvidenceAggregate(input: {
    requiredDisplayAmount: string | undefined;
    balances: IntentEvidenceSettlementAssetBalance[];
    commonDecimals: number | undefined;
    blockedReason: IntentEvidenceBlockedReason | undefined;
  }): IntentEvidenceSummary["aggregate"] {
    if (input.blockedReason !== undefined) {
      return {
        status: "unavailable_wallet_balance_scan_incomplete",
        ...(input.requiredDisplayAmount === undefined ? {} : { requiredDisplayAmount: input.requiredDisplayAmount }),
        reason: input.blockedReason
      };
    }

    if (input.commonDecimals === undefined) {
      return {
        status: "unavailable_mixed_decimals",
        ...(input.requiredDisplayAmount === undefined ? {} : { requiredDisplayAmount: input.requiredDisplayAmount })
      };
    }
    const currentRawAmount = sumRawAmounts(input.balances.map((balance) => balance.currentRawAmount));
    if (input.requiredDisplayAmount === undefined) {
      return {
        status: "available",
        currentRawAmount,
        currentDisplayAmount: formatSettlementAssetRawAmount(currentRawAmount, input.commonDecimals),
        decimals: input.commonDecimals,
        unitSource: DEEPBOOK_SCALAR_UNIT_SOURCE
      };
    }
    const requiredRawAmount = this.#parseIntentDisplayAmount(
      input.requiredDisplayAmount,
      input.commonDecimals,
      "requiredDisplayAmount"
    );
    const shortfallRawAmount =
      BigInt(currentRawAmount) >= BigInt(requiredRawAmount)
        ? "0"
        : (BigInt(requiredRawAmount) - BigInt(currentRawAmount)).toString();
    return {
      status: "available",
      requiredDisplayAmount: input.requiredDisplayAmount,
      requiredRawAmount,
      currentRawAmount,
      currentDisplayAmount: formatSettlementAssetRawAmount(currentRawAmount, input.commonDecimals),
      shortfallRawAmount,
      shortfallDisplayAmount: formatSettlementAssetRawAmount(shortfallRawAmount, input.commonDecimals),
      decimals: input.commonDecimals,
      unitSource: DEEPBOOK_SCALAR_UNIT_SOURCE
    };
  }

  #intentEvidenceSettlementAssetCoverage(
    aggregate: IntentEvidenceSummary["aggregate"]
  ): IntentEvidenceSettlementAssetCoverage {
    const boundary = intentEvidenceSettlementAssetCoverageBoundary();
    if (aggregate.status === "unavailable_mixed_decimals") {
      return {
        status: "unavailable_mixed_decimals",
        ...(aggregate.requiredDisplayAmount === undefined
          ? {}
          : { requiredDisplayAmount: aggregate.requiredDisplayAmount }),
        reason: "asset_group_assets_do_not_share_verified_decimals",
        boundary
      };
    }
    if (aggregate.status === "unavailable_wallet_balance_scan_incomplete") {
      return {
        status: "unavailable_wallet_balance_scan_incomplete",
        ...(aggregate.requiredDisplayAmount === undefined
          ? {}
          : { requiredDisplayAmount: aggregate.requiredDisplayAmount }),
        reason: aggregate.reason,
        boundary
      };
    }

    if (aggregate.requiredDisplayAmount === undefined) {
      return {
        status: "balance_total_only",
        currentRawAmount: aggregate.currentRawAmount,
        currentDisplayAmount: aggregate.currentDisplayAmount,
        decimals: aggregate.decimals,
        unitSource: aggregate.unitSource,
        boundary
      };
    }

    if (
      aggregate.requiredRawAmount === undefined ||
      aggregate.shortfallRawAmount === undefined ||
      aggregate.shortfallDisplayAmount === undefined
    ) {
      throw new Error("settlement-asset coverage requires complete target amount evidence");
    }

    const shortfallRawAmount = aggregate.shortfallRawAmount;
    return {
      status: BigInt(shortfallRawAmount) === 0n ? "covered_by_settlement_asset_balance" : "shortfall_in_settlement_asset_balance",
      requiredDisplayAmount: aggregate.requiredDisplayAmount,
      requiredRawAmount: aggregate.requiredRawAmount,
      currentRawAmount: aggregate.currentRawAmount,
      currentDisplayAmount: aggregate.currentDisplayAmount,
      shortfallRawAmount,
      shortfallDisplayAmount: aggregate.shortfallDisplayAmount,
      decimals: aggregate.decimals,
      unitSource: aggregate.unitSource,
      boundary
    };
  }

  #intentEvidenceSelectedTarget(input: {
    targetAsset: SettlementAssetGroupAsset;
    selectionSource: IntentEvidenceTargetAssetSelectionSource;
    requiredDisplayAmount: string;
    balances: IntentEvidenceSettlementAssetBalance[];
  }): IntentEvidenceSelectedTarget {
    const targetBalance = input.balances.find((balance) => balance.symbol === input.targetAsset.symbol);
    const currentRawAmount = targetBalance?.currentRawAmount ?? "0";
    const requiredRawAmount = this.#parseIntentDisplayAmount(
      input.requiredDisplayAmount,
      input.targetAsset.decimals,
      "requiredDisplayAmount"
    );
    const shortfallRawAmount =
      BigInt(currentRawAmount) >= BigInt(requiredRawAmount)
        ? "0"
        : (BigInt(requiredRawAmount) - BigInt(currentRawAmount)).toString();
    return {
      ...input.targetAsset,
      selectionSource: input.selectionSource,
      requiredRawAmount,
      currentRawAmount,
      currentDisplayAmount: formatSettlementAssetRawAmount(currentRawAmount, input.targetAsset.decimals),
      shortfallRawAmount,
      shortfallDisplayAmount: formatSettlementAssetRawAmount(shortfallRawAmount, input.targetAsset.decimals)
    };
  }

  async #settlementAssetGroupParityAsset(
    asset: SettlementAssetGroupAsset,
    referenceAsset: SettlementAssetGroupAsset,
    deepbook: DeepBookReadClient
  ): Promise<SettlementAssetGroupParityAsset> {
    if (asset.symbol === referenceAsset.symbol) {
      return {
        ...asset,
        status: "reference_asset",
        parityPrice: 1,
        parityDirection: "reference_asset_per_group_asset",
        reason: "reference_asset_is_measurement_baseline_not_settlement_choice"
      };
    }

    let directPool: { poolKey: string; direction: QuoteDirection };
    try {
      const resolved = resolveDeepbookPoolForSymbols({
        sourceSymbol: asset.symbol,
        targetSymbol: referenceAsset.symbol
      });
      directPool = { poolKey: resolved.poolKey, direction: resolved.direction };
    } catch {
      return {
        ...asset,
        status: "no_direct_deepbook_pool",
        reason: "No direct DeepBook mainnet pool exists between this group asset and the measurement reference asset."
      };
    }

    let poolMidPrice: number;
    try {
      poolMidPrice = assertValidDeepbookMidPrice(directPool.poolKey, await deepbook.midPrice(directPool.poolKey));
    } catch (error) {
      return {
        ...asset,
        status: "mid_price_unavailable",
        poolKey: directPool.poolKey,
        direction: directPool.direction,
        reason: error instanceof Error ? error.message : "DeepBook mid-price lookup failed."
      };
    }

    return {
      ...asset,
      status: "measured",
      parityPrice: roundDerivedParityPrice(directPool.direction === "base_to_quote" ? poolMidPrice : 1 / poolMidPrice),
      parityDirection: "reference_asset_per_group_asset",
      poolKey: directPool.poolKey,
      direction: directPool.direction,
      poolMidPrice,
      poolMidPriceDirection: DEEPBOOK_MID_PRICE_DIRECTION
    };
  }

  async #intentEvidenceCandidateConversions(input: {
    targetAsset: SettlementAssetGroupAsset | undefined;
    balances: IntentEvidenceSettlementAssetBalance[];
    acceptedSourceSet: Set<string> | undefined;
  }): Promise<IntentEvidenceCandidateConversion[]> {
    const candidates: IntentEvidenceCandidateConversion[] = [];
    for (const balance of input.balances) {
      if (balance.currentRawAmount === "0" || balance.symbol === input.targetAsset?.symbol) {
        continue;
      }
      if (input.acceptedSourceSet !== undefined && !input.acceptedSourceSet.has(balance.symbol)) {
        candidates.push({
          sourceSymbol: balance.symbol,
          ...(input.targetAsset === undefined ? {} : { targetSymbol: input.targetAsset.symbol }),
          sourceRawAmount: balance.currentRawAmount,
          sourceDisplayAmount: balance.currentDisplayAmount,
          status: "filtered_by_accepted_source_assets",
          reason: "The source asset was not included in acceptedSourceAssetSymbols."
        });
        continue;
      }
      if (input.targetAsset === undefined) {
        candidates.push({
          sourceSymbol: balance.symbol,
          sourceRawAmount: balance.currentRawAmount,
          sourceDisplayAmount: balance.currentDisplayAmount,
          status: "target_asset_not_selected",
          reason: "No target settlement asset was selected, so conversion quotes are not requested."
        });
        continue;
      }

      let directPool: { poolKey: string; direction: QuoteDirection };
      try {
        const resolved = resolveDeepbookPoolForSymbols({
          sourceSymbol: balance.symbol,
          targetSymbol: input.targetAsset.symbol
        });
        directPool = { poolKey: resolved.poolKey, direction: resolved.direction };
      } catch {
        candidates.push({
          sourceSymbol: balance.symbol,
          targetSymbol: input.targetAsset.symbol,
          sourceRawAmount: balance.currentRawAmount,
          sourceDisplayAmount: balance.currentDisplayAmount,
          status: "no_direct_deepbook_pool",
          reason: "No direct DeepBook mainnet pool exists for this source and target pair."
        });
        continue;
      }

      try {
        const quote = await this.quoteDeepbookAction({
          poolKey: directPool.poolKey,
          direction: directPool.direction,
          amountRaw: balance.currentRawAmount,
          simulationSender: DEFAULT_DEEPBOOK_SIMULATION_SENDER
        });
        candidates.push({
          sourceSymbol: balance.symbol,
          targetSymbol: input.targetAsset.symbol,
          sourceRawAmount: balance.currentRawAmount,
          sourceDisplayAmount: balance.currentDisplayAmount,
          status: "quoted",
          directPool,
          quote,
          boundary: [
            "quote_snapshot_only",
            "not_final_min_out",
            "not_route_recommendation",
            "not_route_dependent_payment_support",
            "not_payment_readiness",
            "not_signing_readiness"
          ]
        });
      } catch (error) {
        candidates.push({
          sourceSymbol: balance.symbol,
          targetSymbol: input.targetAsset.symbol,
          sourceRawAmount: balance.currentRawAmount,
          sourceDisplayAmount: balance.currentDisplayAmount,
          status: "quote_unavailable",
          reason: error instanceof Error ? error.message : "DeepBook quote failed for this candidate.",
          directPool
        });
      }
    }
    return candidates;
  }

  #intentEvidenceRequiredUserChoices(
    intentKind: IntentEvidenceKind,
    targetAsset: SettlementAssetGroupAsset | undefined,
    candidateConversions: IntentEvidenceCandidateConversion[]
  ): string[] {
    if (intentKind === "summarize_settlement_asset_group_balance") {
      return [];
    }
    const choices: string[] = [];
    if (targetAsset === undefined) {
      choices.push(
        "Choose the onchain settlement asset or merchant-accepted USD-denominated asset set before target-specific settlement evidence can be completed."
      );
    }
    if (candidateConversions.some((candidate) => candidate.status === "quoted")) {
      choices.push("Choose which quoted candidate assets, if any, the user wants to convert.");
    }
    return choices;
  }

  #parseIntentDisplayAmount(displayAmount: string, decimals: number, field: string): string {
    try {
      return parseDisplayAmountToRaw(displayAmount, decimals);
    } catch (error) {
      throw new ReadServiceInputError(
        "input_invalid",
        "requiredDisplayAmount must be an unsigned decimal string within verified decimals",
        {
          field,
          value: displayAmount,
          decimals,
          reason: error instanceof Error ? error.message : "unknown"
        }
      );
    }
  }

  #fetchedAt(): string {
    return this.#now().toISOString();
  }

  async #withUnit(balance: SuiClientTypes.Balance): Promise<WalletBalanceWithUnit> {
    let normalizedCoinType: string;
    try {
      normalizedCoinType = normalizeCoinType(balance.coinType);
    } catch {
      return withUnavailableUnit(balance, "coin_type_unresolved");
    }

    const unit = await this.#resolveCoinUnitForNormalizedCoinType(normalizedCoinType);
    return withResolvedUnit(balance, unit);
  }

  async #resolveCoinUnitForNormalizedCoinType(normalizedCoinType: string): Promise<CoinUnit> {
    const now = this.#now();
    let cached: CoinMetadataCacheLookup;
    try {
      cached = await this.#coinMetadataCache.getCoinMetadata({
        coinType: normalizedCoinType,
        chainIdentifier: this.#chainIdentifier,
        now
      });
    } catch (error) {
      throw new ReadServiceCacheError("read", error);
    }
    if (cached.status === "hit") {
      return unitFromMetadataRecord(cached.record, "hit");
    }

    let metadata: SuiClientTypes.GetCoinMetadataResponse;
    try {
      metadata = await this.#client.core.getCoinMetadata({ coinType: normalizedCoinType });
    } catch {
      return unavailableUnit("metadata_lookup_failed");
    }

    if (metadata.coinMetadata !== null) {
      const record = this.#cacheRecordFromMetadata(normalizedCoinType, metadata.coinMetadata, now);
      try {
        await this.#coinMetadataCache.setCoinMetadata(record);
      } catch (error) {
        throw new ReadServiceCacheError("write", error);
      }
      return unitFromMetadataRecord(record, cached.status === "expired" ? "expired_refetched" : "miss");
    }

    try {
      const fallback = deepbookUnitForCoinType(normalizedCoinType, this.#deepbookCoins);
      if (fallback) {
        return unitFromDeepbook(fallback);
      }
    } catch (error) {
      if (error instanceof ReadServiceInputError) {
        return unavailableUnit("no_verified_decimals");
      }
      throw error;
    }
    return unavailableUnit("metadata_not_found");
  }

  async #scanWalletAssetClassificationPages(account: string): Promise<WalletBalanceClassificationScan> {
    const classifiedAssets: ClassifiedWalletAsset[] = [];
    let uninspectedAssetClasses: UninspectedAssetClass[] = NOT_INSPECTED_ASSET_CLASSES.map((assetClass) => ({
      ...assetClass
    }));
    let cursor: string | null | undefined;
    const requestedCursors = new Set<string>();

    for (let pageIndex = 0; pageIndex < MAX_WALLET_BALANCE_SCAN_PAGES; pageIndex += 1) {
      if (cursor !== undefined && cursor !== null) {
        if (requestedCursors.has(cursor)) {
          return {
            classifiedAssets,
            uninspectedAssetClasses,
            inspectedBalancePages: pageIndex,
            inspectedCoinBalanceCount: classifiedAssets.length,
            blockedReason: "wallet_balance_pagination_did_not_advance"
          };
        }
        requestedCursors.add(cursor);
      }

      const page = await this.classifyWalletAssets({ account, ...(cursor === undefined ? {} : { cursor }) });
      classifiedAssets.push(...page.classifiedAssets);
      uninspectedAssetClasses = page.uninspectedAssetClasses;

      if (!page.hasNextPage) {
        return {
          classifiedAssets,
          uninspectedAssetClasses,
          inspectedBalancePages: pageIndex + 1,
          inspectedCoinBalanceCount: classifiedAssets.length
        };
      }
      if (
        typeof page.cursor !== "string" ||
        page.cursor.length === 0 ||
        page.cursor === cursor ||
        requestedCursors.has(page.cursor)
      ) {
        return {
          classifiedAssets,
          uninspectedAssetClasses,
          inspectedBalancePages: pageIndex + 1,
          inspectedCoinBalanceCount: classifiedAssets.length,
          blockedReason: "wallet_balance_pagination_did_not_advance"
        };
      }
      cursor = page.cursor;
    }

    return {
      classifiedAssets,
      uninspectedAssetClasses,
      inspectedBalancePages: MAX_WALLET_BALANCE_SCAN_PAGES,
      inspectedCoinBalanceCount: classifiedAssets.length,
      blockedReason: "wallet_balance_page_limit_exceeded"
    };
  }

  #cacheRecordFromMetadata(
    coinType: string,
    metadata: SuiClientTypes.CoinMetadata,
    now: Date
  ): CoinMetadataCacheRecord {
    const decimals = assertValidDecimals(metadata.decimals);
    return {
      coinType,
      chainIdentifier: this.#chainIdentifier,
      decimals,
      symbol: metadata.symbol,
      name: metadata.name,
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#coinMetadataTtlMs).toISOString()
    };
  }

  listDeepbookTokenRegistry(): DeepbookTokenRegistryEntry[] {
    return listDeepbookTokenRegistry(this.#deepbookCoins);
  }
}

export function createSuiReadService(options: SuiReadServiceOptions): SuiReadService {
  return new SuiReadService(options);
}
