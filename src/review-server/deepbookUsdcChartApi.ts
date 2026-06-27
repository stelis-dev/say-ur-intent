import {
  DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_INTERVAL,
  DEEPBOOK_OFFICIAL_INDEXER_INTERVALS,
  DeepbookOfficialIndexerSource,
  DeepbookOfficialIndexerSourceError,
  parseDeepbookOfficialIndexerInterval,
  selectDeepbookOfficialIndexerCanonicalUsdcPools,
  type DeepbookOfficialIndexerCandle,
  type DeepbookOfficialIndexerFetchSource,
  type DeepbookOfficialIndexerInterval,
  type DeepbookOfficialIndexerSourceClient
} from "../core/read/deepbookOfficialIndexerSource.js";
import {
  deepbookUsdcPriceHistoryPairFromOfficialPool,
  deepbookUsdcPriceHistoryQuantitySemantics,
  deepbookUsdcPriceHistoryResponseSummary
} from "../core/read/deepbookReadHelpers.js";
import {
  DEEPBOOK_USDC_PRICE_HISTORY_UNSUPPORTED_CLAIMS,
  type DeepbookUsdcPriceHistoryPair,
  type DeepbookUsdcPriceHistoryQuantitySemantics,
  type DeepbookUsdcPriceHistoryResponseSummary,
  type DeepbookUsdcPriceHistoryUnsupportedClaim
} from "../core/read/readServiceTypes.js";

export const DEEPBOOK_USDC_CHART_DEFAULT_LIMIT = 500;
export const DEEPBOOK_USDC_CHART_MAX_CANDLES = 10_000;
export const DEEPBOOK_USDC_CHART_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEEPBOOK_USDC_CHART_CANDLE_CACHE_SIZE = 256;

const ALLOWED_CANDLE_QUERY_FIELDS = new Set(["poolName", "interval", "startTimeMs", "endTimeMs", "limit"]);

export type DeepbookUsdcChartApiOptions = {
  source?: DeepbookOfficialIndexerSourceClient | undefined;
  now?: (() => Date) | undefined;
  cacheTtlMs?: number | undefined;
  maxCandleCacheEntries?: number | undefined;
};

export type DeepbookUsdcChartApiRouteResult = {
  httpStatus: number;
  body: DeepbookUsdcChartPoolsResponse | DeepbookUsdcChartCandlesResponse;
};

export type DeepbookUsdcChartCommonFields = {
  responseSummary: DeepbookUsdcPriceHistoryResponseSummary;
  quantitySemantics: DeepbookUsdcPriceHistoryQuantitySemantics;
  unsupportedClaims: DeepbookUsdcPriceHistoryUnsupportedClaim[];
};

export type DeepbookUsdcChartSourceUnavailableReason =
  | "source_unavailable"
  | "source_timeout"
  | "source_http_error"
  | "official_indexer_invalid_payload";

export type DeepbookUsdcChartPoolsResponse =
  | ({
      status: "ok";
      poolCount: number;
      pools: DeepbookUsdcPriceHistoryPair[];
      intervals: typeof DEEPBOOK_OFFICIAL_INDEXER_INTERVALS;
      defaultInterval: typeof DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_INTERVAL;
      source: DeepbookOfficialIndexerFetchSource;
    } & DeepbookUsdcChartCommonFields)
  | ({
      status: "source_unavailable";
      reason: DeepbookUsdcChartSourceUnavailableReason;
    } & DeepbookUsdcChartCommonFields)
  | ({
      status: "unsupported_input";
      reason: "unsupported_query_field";
      field: string;
    } & DeepbookUsdcChartCommonFields);

export type DeepbookUsdcChartCandlesQuery = {
  poolName: string;
  interval: DeepbookOfficialIndexerInterval;
  startTimeMs?: number | undefined;
  endTimeMs?: number | undefined;
  limit: number;
};

export type DeepbookUsdcChartCandlesResponse =
  | ({
      status: "ok";
      query: DeepbookUsdcChartCandlesQuery;
      pair: DeepbookUsdcPriceHistoryPair;
      candleCount: number;
      candles: DeepbookOfficialIndexerCandle[];
      source: DeepbookOfficialIndexerFetchSource;
    } & DeepbookUsdcChartCommonFields)
  | ({
      status: "empty_result";
      query: DeepbookUsdcChartCandlesQuery;
      pair: DeepbookUsdcPriceHistoryPair;
      candleCount: 0;
      candles: [];
      source: DeepbookOfficialIndexerFetchSource;
    } & DeepbookUsdcChartCommonFields)
  | ({
      status: "unsupported_input";
      reason:
        | "missing_pool_name"
        | "unsupported_interval"
        | "invalid_timestamp"
        | "invalid_timestamp_window"
        | "invalid_limit"
        | "unsupported_query_field"
        | "duplicate_query_field";
      field?: string | undefined;
      query?: Partial<DeepbookUsdcChartCandlesQuery> | undefined;
    } & DeepbookUsdcChartCommonFields)
  | ({
      status: "over_limit";
      reason: "limit_exceeds_chart_cap";
      maxCandles: typeof DEEPBOOK_USDC_CHART_MAX_CANDLES;
      requestedLimit: number;
      query?: Partial<DeepbookUsdcChartCandlesQuery> | undefined;
    } & DeepbookUsdcChartCommonFields)
  | ({
      status: "unsupported_pool";
      reason: "pool_not_in_official_usdc_pools";
      query: DeepbookUsdcChartCandlesQuery;
      availablePoolNames: string[];
      source: DeepbookOfficialIndexerFetchSource;
    } & DeepbookUsdcChartCommonFields)
  | ({
      status: "source_unavailable";
      reason: DeepbookUsdcChartSourceUnavailableReason;
      query?: DeepbookUsdcChartCandlesQuery | undefined;
      pair?: DeepbookUsdcPriceHistoryPair | undefined;
      source?: DeepbookOfficialIndexerFetchSource | undefined;
    } & DeepbookUsdcChartCommonFields);

type CacheEntry<T> = {
  expiresAtMs: number;
  value: T;
};

export function createDeepbookUsdcChartApi(options: DeepbookUsdcChartApiOptions = {}) {
  const source = options.source ?? new DeepbookOfficialIndexerSource();
  const now = options.now ?? (() => new Date());
  const cacheTtlMs = options.cacheTtlMs ?? DEEPBOOK_USDC_CHART_CACHE_TTL_MS;
  const maxCandleCacheEntries = options.maxCandleCacheEntries ?? DEEPBOOK_USDC_CHART_CANDLE_CACHE_SIZE;
  let poolCache: CacheEntry<Awaited<ReturnType<DeepbookOfficialIndexerSourceClient["fetchPools"]>>> | undefined;
  const candleCache = new Map<string, CacheEntry<Awaited<ReturnType<DeepbookOfficialIndexerSourceClient["fetchCandles"]>>>>();

  async function getPools(searchParams: URLSearchParams = new URLSearchParams()): Promise<DeepbookUsdcChartApiRouteResult> {
    const unsupportedField = firstUnsupportedField(searchParams, new Set());
    if (unsupportedField) {
      return routeResult(400, {
        status: "unsupported_input",
        reason: "unsupported_query_field",
        field: unsupportedField,
        ...chartCommonFields()
      });
    }

    let poolResult: Awaited<ReturnType<DeepbookOfficialIndexerSourceClient["fetchPools"]>>;
    try {
      poolResult = await fetchPoolsCached();
    } catch (error) {
      return routeResult(502, {
        status: "source_unavailable",
        reason: chartSourceUnavailableReason(error),
        ...chartCommonFields()
      });
    }
    const pools = selectDeepbookOfficialIndexerCanonicalUsdcPools(poolResult.pools).map(
      deepbookUsdcPriceHistoryPairFromOfficialPool
    );
    return routeResult(200, {
      status: "ok",
      poolCount: pools.length,
      pools,
      intervals: DEEPBOOK_OFFICIAL_INDEXER_INTERVALS,
      defaultInterval: DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_INTERVAL,
      source: poolResult.source,
      ...chartCommonFields()
    });
  }

  async function getCandles(searchParams: URLSearchParams): Promise<DeepbookUsdcChartApiRouteResult> {
    const parsed = parseCandlesQuery(searchParams);
    if (parsed.status !== "ok") {
      return routeResult(parsed.httpStatus, parsed.body);
    }

    let poolResult: Awaited<ReturnType<DeepbookOfficialIndexerSourceClient["fetchPools"]>>;
    try {
      poolResult = await fetchPoolsCached();
    } catch (error) {
      return routeResult(502, {
        status: "source_unavailable",
        reason: chartSourceUnavailableReason(error),
        query: parsed.query,
        ...chartCommonFields()
      });
    }

    const pools = selectDeepbookOfficialIndexerCanonicalUsdcPools(poolResult.pools);
    const pool = pools.find((candidate) => candidate.pool_name === parsed.query.poolName);
    if (pool === undefined) {
      return routeResult(400, {
        status: "unsupported_pool",
        reason: "pool_not_in_official_usdc_pools",
        query: parsed.query,
        availablePoolNames: pools.map((candidate) => candidate.pool_name),
        source: poolResult.source,
        ...chartCommonFields()
      });
    }

    const pair = deepbookUsdcPriceHistoryPairFromOfficialPool(pool);
    let candleResult: Awaited<ReturnType<DeepbookOfficialIndexerSourceClient["fetchCandles"]>>;
    try {
      candleResult = await fetchCandlesCached(parsed.query);
    } catch (error) {
      return routeResult(502, {
        status: "source_unavailable",
        reason: chartSourceUnavailableReason(error),
        query: parsed.query,
        pair,
        source: poolResult.source,
        ...chartCommonFields()
      });
    }

    if (candleResult.candles.length === 0) {
      return routeResult(200, {
        status: "empty_result",
        query: parsed.query,
        pair,
        candleCount: 0,
        candles: [],
        source: candleResult.source,
        ...chartCommonFields()
      });
    }

    return routeResult(200, {
      status: "ok",
      query: parsed.query,
      pair,
      candleCount: candleResult.candles.length,
      candles: candleResult.candles,
      source: candleResult.source,
      ...chartCommonFields()
    });
  }

  async function fetchPoolsCached(): Promise<Awaited<ReturnType<DeepbookOfficialIndexerSourceClient["fetchPools"]>>> {
    const currentTime = now().getTime();
    if (poolCache !== undefined && poolCache.expiresAtMs > currentTime) {
      return poolCache.value;
    }
    const value = await source.fetchPools();
    poolCache = { expiresAtMs: currentTime + cacheTtlMs, value };
    return value;
  }

  async function fetchCandlesCached(
    query: DeepbookUsdcChartCandlesQuery
  ): Promise<Awaited<ReturnType<DeepbookOfficialIndexerSourceClient["fetchCandles"]>>> {
    const key = JSON.stringify(query);
    const currentTime = now().getTime();
    const cached = candleCache.get(key);
    if (cached !== undefined && cached.expiresAtMs > currentTime) {
      candleCache.delete(key);
      candleCache.set(key, cached);
      return cached.value;
    }
    const value = await source.fetchCandles(query);
    candleCache.set(key, { expiresAtMs: currentTime + cacheTtlMs, value });
    while (candleCache.size > maxCandleCacheEntries) {
      const oldestKey = candleCache.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      candleCache.delete(oldestKey);
    }
    return value;
  }

  return { getPools, getCandles };
}

function parseCandlesQuery(searchParams: URLSearchParams):
  | { status: "ok"; query: DeepbookUsdcChartCandlesQuery }
  | {
      status: "error";
      httpStatus: number;
      body: DeepbookUsdcChartCandlesResponse;
    } {
  const unsupportedField = firstUnsupportedField(searchParams, ALLOWED_CANDLE_QUERY_FIELDS);
  if (unsupportedField) {
    return chartQueryError(400, {
      status: "unsupported_input",
      reason: "unsupported_query_field",
      field: unsupportedField,
      ...chartCommonFields()
    });
  }
  const duplicateField = firstDuplicateField(searchParams);
  if (duplicateField) {
    return chartQueryError(400, {
      status: "unsupported_input",
      reason: "duplicate_query_field",
      field: duplicateField,
      ...chartCommonFields()
    });
  }

  const poolName = searchParams.get("poolName");
  if (poolName === null || poolName.trim() === "") {
    return chartQueryError(400, {
      status: "unsupported_input",
      reason: "missing_pool_name",
      field: "poolName",
      ...chartCommonFields()
    });
  }

  let interval: DeepbookOfficialIndexerInterval;
  const intervalText = searchParams.get("interval") ?? DEFAULT_DEEPBOOK_OFFICIAL_INDEXER_INTERVAL;
  try {
    interval = parseDeepbookOfficialIndexerInterval(intervalText);
  } catch (error) {
    if (error instanceof DeepbookOfficialIndexerSourceError) {
      return chartQueryError(400, {
        status: "unsupported_input",
        reason: "unsupported_interval",
        field: "interval",
        ...chartCommonFields()
      });
    }
    throw error;
  }

  const startTimeMs = parseOptionalTimestamp(searchParams.get("startTimeMs"), "startTimeMs");
  if (startTimeMs.status === "error") {
    return chartQueryError(400, startTimeMs.body);
  }
  const endTimeMs = parseOptionalTimestamp(searchParams.get("endTimeMs"), "endTimeMs");
  if (endTimeMs.status === "error") {
    return chartQueryError(400, endTimeMs.body);
  }
  if (
    startTimeMs.value !== undefined &&
    endTimeMs.value !== undefined &&
    startTimeMs.value >= endTimeMs.value
  ) {
    return chartQueryError(400, {
      status: "unsupported_input",
      reason: "invalid_timestamp_window",
      query: { poolName, interval, startTimeMs: startTimeMs.value, endTimeMs: endTimeMs.value },
      ...chartCommonFields()
    });
  }

  const limit = parseLimit(searchParams.get("limit"));
  if (limit.status === "error") {
    return chartQueryError(limit.httpStatus, limit.body);
  }

  return {
    status: "ok",
    query: {
      poolName,
      interval,
      ...(startTimeMs.value !== undefined ? { startTimeMs: startTimeMs.value } : {}),
      ...(endTimeMs.value !== undefined ? { endTimeMs: endTimeMs.value } : {}),
      limit: limit.value
    }
  };
}

function parseOptionalTimestamp(
  value: string | null,
  field: "startTimeMs" | "endTimeMs"
):
  | { status: "ok"; value: number | undefined }
  | { status: "error"; body: DeepbookUsdcChartCandlesResponse } {
  if (value === null || value === "") {
    return { status: "ok", value: undefined };
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    return {
      status: "error",
      body: {
        status: "unsupported_input",
        reason: "invalid_timestamp",
        field,
        ...chartCommonFields()
      }
    };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return {
      status: "error",
      body: {
        status: "unsupported_input",
        reason: "invalid_timestamp",
        field,
        ...chartCommonFields()
      }
    };
  }
  return { status: "ok", value: parsed };
}

function parseLimit(value: string | null):
  | { status: "ok"; value: number }
  | { status: "error"; httpStatus: number; body: DeepbookUsdcChartCandlesResponse } {
  if (value === null || value === "") {
    return { status: "ok", value: DEEPBOOK_USDC_CHART_DEFAULT_LIMIT };
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    return {
      status: "error",
      httpStatus: 400,
      body: {
        status: "unsupported_input",
        reason: "invalid_limit",
        field: "limit",
        ...chartCommonFields()
      }
    };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return {
      status: "error",
      httpStatus: 400,
      body: {
        status: "unsupported_input",
        reason: "invalid_limit",
        field: "limit",
        ...chartCommonFields()
      }
    };
  }
  if (parsed > DEEPBOOK_USDC_CHART_MAX_CANDLES) {
    return {
      status: "error",
      httpStatus: 400,
      body: {
        status: "over_limit",
        reason: "limit_exceeds_chart_cap",
        maxCandles: DEEPBOOK_USDC_CHART_MAX_CANDLES,
        requestedLimit: parsed,
        ...chartCommonFields()
      }
    };
  }
  return { status: "ok", value: parsed };
}

function firstUnsupportedField(searchParams: URLSearchParams, allowed: Set<string>): string | undefined {
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      return key;
    }
  }
  return undefined;
}

function firstDuplicateField(searchParams: URLSearchParams): string | undefined {
  const seen = new Set<string>();
  for (const key of searchParams.keys()) {
    if (seen.has(key)) {
      return key;
    }
    seen.add(key);
  }
  return undefined;
}

function chartSourceUnavailableReason(error: unknown): DeepbookUsdcChartSourceUnavailableReason {
  if (error instanceof DeepbookOfficialIndexerSourceError) {
    switch (error.reason) {
      case "invalid_payload":
        return "official_indexer_invalid_payload";
      case "source_timeout":
        return "source_timeout";
      case "source_http_error":
        return "source_http_error";
      case "invalid_source_url":
      case "source_unavailable":
        return "source_unavailable";
    }
  }
  return "source_unavailable";
}

function chartCommonFields(): DeepbookUsdcChartCommonFields {
  return {
    responseSummary: deepbookUsdcPriceHistoryResponseSummary(),
    quantitySemantics: deepbookUsdcPriceHistoryQuantitySemantics(),
    unsupportedClaims: [...DEEPBOOK_USDC_PRICE_HISTORY_UNSUPPORTED_CLAIMS]
  };
}

function routeResult(
  httpStatus: number,
  body: DeepbookUsdcChartPoolsResponse | DeepbookUsdcChartCandlesResponse
): DeepbookUsdcChartApiRouteResult {
  return { httpStatus, body };
}

function chartQueryError(
  httpStatus: number,
  body: DeepbookUsdcChartCandlesResponse
): { status: "error"; httpStatus: number; body: DeepbookUsdcChartCandlesResponse } {
  return { status: "error", httpStatus, body };
}
