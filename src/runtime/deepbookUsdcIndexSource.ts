import { z } from "zod";

export const DEEPBOOK_USDC_INDEX_REPOSITORY_URL = "https://github.com/stelis-dev/deepbook-usdc-index";
export const DEFAULT_DEEPBOOK_USDC_INDEX_BASE_URL =
  "https://raw.githubusercontent.com/stelis-dev/deepbook-usdc-index/main";
export const DEFAULT_DEEPBOOK_USDC_INDEX_SOURCE_REF = "main";
export const DEEPBOOK_USDC_INDEX_REGISTRY_PATH = "registry/pairs.json";
export const DEEPBOOK_USDC_INDEX_BAR_INTERVAL_MINUTES = 10;
export const DEEPBOOK_USDC_INDEX_PRICE_CONVENTION = "USDC_PER_BASE";
export const DEEPBOOK_USDC_INDEX_NETWORK = "sui:mainnet";
export const DEEPBOOK_USDC_INDEX_CANONICAL_USDC_COIN_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
export const DEFAULT_DEEPBOOK_USDC_INDEX_FETCH_TIMEOUT_MS = 10_000;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PAIR_ID_PATTERN = /^[A-Z0-9]+_USDC$/;
const SUI_OBJECT_ID_PATTERN = /^0x[0-9a-f]{64}$/i;
const NON_NEGATIVE_INTEGER_STRING_PATTERN = /^(0|[1-9][0-9]*)$/;
const DECIMAL_STRING_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export type DeepbookUsdcIndexSourceErrorReason =
  | "invalid_source_url"
  | "source_unavailable"
  | "source_timeout"
  | "source_http_error"
  | "invalid_payload";

export class DeepbookUsdcIndexSourceError extends Error {
  constructor(
    readonly reason: DeepbookUsdcIndexSourceErrorReason,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const isoDateStringSchema = z.string().refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}, "expected an ISO timestamp string");

const coinTypeSchema = z.string().min(1);
const decimalStringSchema = z.string().regex(DECIMAL_STRING_PATTERN);
const nonNegativeIntegerStringSchema = z.string().regex(NON_NEGATIVE_INTEGER_STRING_PATTERN);

export const deepbookUsdcIndexBaseAssetSchema = z.object({
  symbol: z.string().min(1),
  coinType: coinTypeSchema,
  decimals: z.number().int().min(0).max(38)
}).strict();

export const deepbookUsdcIndexPairSchema = z.object({
  id: z.string().regex(PAIR_ID_PATTERN),
  enabled: z.boolean(),
  poolId: z.string().regex(SUI_OBJECT_ID_PATTERN),
  baseAsset: deepbookUsdcIndexBaseAssetSchema,
  quoteAsset: z.literal("USDC"),
  priceConvention: z.literal(DEEPBOOK_USDC_INDEX_PRICE_CONVENTION),
  collection: z.object({
    barIntervalMinutes: z.literal(DEEPBOOK_USDC_INDEX_BAR_INTERVAL_MINUTES),
    rollingRetentionYears: z.number().int().positive().optional()
  }).strict()
}).strict();

export const deepbookUsdcIndexRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  network: z.literal(DEEPBOOK_USDC_INDEX_NETWORK),
  quoteAsset: z.object({
    symbol: z.literal("USDC"),
    coinType: z.literal(DEEPBOOK_USDC_INDEX_CANONICAL_USDC_COIN_TYPE),
    decimals: z.literal(6),
    disclaimer: z.string().min(1)
  }).strict(),
  eventSources: z.object({
    orderInfoPackageIds: z.array(z.string().regex(SUI_OBJECT_ID_PATTERN)).min(1),
    orderFilledEventTypes: z.array(z.string().min(1)).min(1)
  }).strict(),
  pairs: z.array(deepbookUsdcIndexPairSchema).min(1)
}).strict();

const deepbookUsdcIndexWeekSchema = z.object({
  weekYear: z.number().int().min(1970).max(9999),
  week: z.number().int().min(1).max(53),
  startsAt: isoDateStringSchema,
  endsAt: isoDateStringSchema,
  timeZone: z.literal("UTC")
}).strict().superRefine((week, context) => {
  if (Date.parse(week.endsAt) <= Date.parse(week.startsAt)) {
    context.addIssue({
      code: "custom",
      message: "week endsAt must be after startsAt",
      path: ["endsAt"]
    });
  }
});

const deepbookUsdcIndexBarBaseSchema = z.object({
  start: isoDateStringSchema,
  end: isoDateStringSchema,
  status: z.enum(["filled", "empty", "missing"]),
  eventCount: z.number().int().min(0),
  open: decimalStringSchema.nullable(),
  high: decimalStringSchema.nullable(),
  low: decimalStringSchema.nullable(),
  close: decimalStringSchema.nullable(),
  baseVolumeRaw: nonNegativeIntegerStringSchema,
  quoteVolumeRaw: nonNegativeIntegerStringSchema,
  raw: z.string().min(1).nullable()
}).strict().superRefine((bar, context) => {
  if (Date.parse(bar.end) <= Date.parse(bar.start)) {
    context.addIssue({
      code: "custom",
      message: "bar end must be after start",
      path: ["end"]
    });
  }

  if (bar.status === "filled") {
    if (bar.eventCount <= 0) {
      context.addIssue({ code: "custom", message: "filled bars must have events", path: ["eventCount"] });
    }
    for (const field of ["open", "high", "low", "close"] as const) {
      if (bar[field] === null) {
        context.addIssue({ code: "custom", message: "filled bars must include OHLC values", path: [field] });
      }
    }
    if (bar.raw === null) {
      context.addIssue({ code: "custom", message: "filled bars must reference a raw shard", path: ["raw"] });
    }
    return;
  }

  if (bar.eventCount !== 0) {
    context.addIssue({ code: "custom", message: `${bar.status} bars must have zero events`, path: ["eventCount"] });
  }
  for (const field of ["open", "high", "low", "close"] as const) {
    if (bar[field] !== null) {
      context.addIssue({ code: "custom", message: `${bar.status} bars must not include OHLC values`, path: [field] });
    }
  }
  if (bar.baseVolumeRaw !== "0") {
    context.addIssue({ code: "custom", message: `${bar.status} bars must have zero base volume`, path: ["baseVolumeRaw"] });
  }
  if (bar.quoteVolumeRaw !== "0") {
    context.addIssue({ code: "custom", message: `${bar.status} bars must have zero quote volume`, path: ["quoteVolumeRaw"] });
  }
  if (bar.raw !== null) {
    context.addIssue({ code: "custom", message: `${bar.status} bars must not reference a raw shard`, path: ["raw"] });
  }
});

export const deepbookUsdcIndexWeeklyBarsSchema = z.object({
  schemaVersion: z.literal(1),
  pairId: z.string().regex(PAIR_ID_PATTERN),
  week: deepbookUsdcIndexWeekSchema,
  barIntervalMinutes: z.literal(DEEPBOOK_USDC_INDEX_BAR_INTERVAL_MINUTES),
  priceConvention: z.literal(DEEPBOOK_USDC_INDEX_PRICE_CONVENTION),
  disclaimer: z.string().min(1),
  bars: z.array(deepbookUsdcIndexBarBaseSchema)
}).strict().superRefine((payload, context) => {
  for (const [index, bar] of payload.bars.entries()) {
    const start = Date.parse(bar.start);
    const end = Date.parse(bar.end);
    const intervalMs = DEEPBOOK_USDC_INDEX_BAR_INTERVAL_MINUTES * 60 * 1000;
    if (end - start !== intervalMs) {
      context.addIssue({
        code: "custom",
        message: "bar length must match the configured interval",
        path: ["bars", index, "end"]
      });
    }
    if (start < Date.parse(payload.week.startsAt) || end > Date.parse(payload.week.endsAt)) {
      context.addIssue({
        code: "custom",
        message: "bar must stay inside the declared UTC ISO week",
        path: ["bars", index, "start"]
      });
    }
  }
});

export type DeepbookUsdcIndexRegistry = z.infer<typeof deepbookUsdcIndexRegistrySchema>;
export type DeepbookUsdcIndexPair = z.infer<typeof deepbookUsdcIndexPairSchema>;
export type DeepbookUsdcIndexWeeklyBars = z.infer<typeof deepbookUsdcIndexWeeklyBarsSchema>;
export type DeepbookUsdcIndexBar = DeepbookUsdcIndexWeeklyBars["bars"][number];

export type UtcIsoWeek = {
  weekYear: number;
  week: number;
};

export type DeepbookUsdcIndexSourceConfig = {
  repositoryUrl: typeof DEEPBOOK_USDC_INDEX_REPOSITORY_URL;
  baseUrl: string;
  sourceRef: string;
  registryPath: typeof DEEPBOOK_USDC_INDEX_REGISTRY_PATH;
};

export type DeepbookUsdcIndexFetchSource = {
  repositoryUrl: string;
  baseUrl: string;
  sourceRef: string;
  path: string;
  url: string;
  fetchedAt: string;
};

export type DeepbookUsdcIndexWeeklyBarsResult =
  | {
      status: "found";
      source: DeepbookUsdcIndexFetchSource;
      weeklyBars: DeepbookUsdcIndexWeeklyBars;
    }
  | {
      status: "missing_file";
      source: Omit<DeepbookUsdcIndexFetchSource, "fetchedAt">;
      httpStatus: 404;
    };

export type DeepbookUsdcIndexSourceOptions = {
  baseUrl?: string | undefined;
  sourceRef?: string | undefined;
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
  now?: (() => Date) | undefined;
};

export class DeepbookUsdcIndexSource {
  readonly config: DeepbookUsdcIndexSourceConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: DeepbookUsdcIndexSourceOptions = {}) {
    const baseUrl = normalizeDeepbookUsdcIndexBaseUrl(options.baseUrl ?? DEFAULT_DEEPBOOK_USDC_INDEX_BASE_URL);
    this.config = {
      repositoryUrl: DEEPBOOK_USDC_INDEX_REPOSITORY_URL,
      baseUrl,
      sourceRef: options.sourceRef ?? DEFAULT_DEEPBOOK_USDC_INDEX_SOURCE_REF,
      registryPath: DEEPBOOK_USDC_INDEX_REGISTRY_PATH
    };
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_DEEPBOOK_USDC_INDEX_FETCH_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  registryUrl(): string {
    return this.urlForPath(DEEPBOOK_USDC_INDEX_REGISTRY_PATH);
  }

  weeklyBarsUrl(pairId: string, week: UtcIsoWeek): string {
    return this.urlForPath(deepbookUsdcIndexWeeklyBarsPath(pairId, week));
  }

  async fetchRegistry(): Promise<{ source: DeepbookUsdcIndexFetchSource; registry: DeepbookUsdcIndexRegistry }> {
    const response = await this.fetchJson(DEEPBOOK_USDC_INDEX_REGISTRY_PATH);
    if (response.status === 404) {
      throw new DeepbookUsdcIndexSourceError("source_http_error", "DeepBook USDC index registry was not found", {
        path: DEEPBOOK_USDC_INDEX_REGISTRY_PATH,
        httpStatus: 404
      });
    }
    const registry = parseIndexPayload(deepbookUsdcIndexRegistrySchema, response.json, response.source.path);
    return { source: response.source, registry };
  }

  async fetchWeeklyBars(pairId: string, week: UtcIsoWeek): Promise<DeepbookUsdcIndexWeeklyBarsResult> {
    const path = deepbookUsdcIndexWeeklyBarsPath(pairId, week);
    const response = await this.fetchJson(path);
    if (response.status === 404) {
      return {
        status: "missing_file",
        source: this.sourceWithoutFetchTimestamp(path),
        httpStatus: 404
      };
    }
    const weeklyBars = parseIndexPayload(deepbookUsdcIndexWeeklyBarsSchema, response.json, response.source.path);
    if (weeklyBars.pairId !== pairId) {
      throw new DeepbookUsdcIndexSourceError("invalid_payload", "DeepBook USDC weekly bars pair id mismatch", {
        path,
        expectedPairId: pairId,
        actualPairId: weeklyBars.pairId
      });
    }
    if (weeklyBars.week.weekYear !== week.weekYear || weeklyBars.week.week !== week.week) {
      throw new DeepbookUsdcIndexSourceError("invalid_payload", "DeepBook USDC weekly bars week mismatch", {
        path,
        expectedWeek: week,
        actualWeek: { weekYear: weeklyBars.week.weekYear, week: weeklyBars.week.week }
      });
    }
    return { status: "found", source: response.source, weeklyBars };
  }

  private async fetchJson(path: string): Promise<
    | { status: 200; source: DeepbookUsdcIndexFetchSource; json: unknown }
    | { status: 404 }
  > {
    const url = this.urlForPath(path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "say-ur-intent"
        }
      });
    } catch (error) {
      throw sourceFetchError(error, path, url);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 404) {
      return { status: 404 };
    }
    if (!response.ok) {
      throw new DeepbookUsdcIndexSourceError("source_http_error", "DeepBook USDC index source returned an error", {
        path,
        url,
        httpStatus: response.status
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new DeepbookUsdcIndexSourceError("invalid_payload", "DeepBook USDC index source returned invalid JSON", {
        path,
        url,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return {
      status: 200,
      source: {
        ...this.sourceWithoutFetchTimestamp(path),
        fetchedAt: this.now().toISOString()
      },
      json
    };
  }

  private sourceWithoutFetchTimestamp(path: string): Omit<DeepbookUsdcIndexFetchSource, "fetchedAt"> {
    return {
      repositoryUrl: this.config.repositoryUrl,
      baseUrl: this.config.baseUrl,
      sourceRef: this.config.sourceRef,
      path,
      url: this.urlForPath(path)
    };
  }

  private urlForPath(path: string): string {
    return new URL(path, `${this.config.baseUrl}/`).toString();
  }
}

export function normalizeDeepbookUsdcIndexBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DeepbookUsdcIndexSourceError("invalid_source_url", "DeepBook USDC index base URL must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new DeepbookUsdcIndexSourceError("invalid_source_url", "DeepBook USDC index base URL must use https");
  }
  if (!parsed.hostname) {
    throw new DeepbookUsdcIndexSourceError("invalid_source_url", "DeepBook USDC index base URL must include a host");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new DeepbookUsdcIndexSourceError(
      "invalid_source_url",
      "DeepBook USDC index base URL must not include credentials, query, or fragment"
    );
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

export function deepbookUsdcIndexWeeklyBarsPath(pairId: string, week: UtcIsoWeek): string {
  if (!PAIR_ID_PATTERN.test(pairId)) {
    throw new DeepbookUsdcIndexSourceError("invalid_payload", "DeepBook USDC index pair id has an invalid format", {
      pairId
    });
  }
  if (!Number.isInteger(week.weekYear) || week.weekYear < 1970 || week.weekYear > 9999) {
    throw new DeepbookUsdcIndexSourceError("invalid_payload", "DeepBook USDC index week year is invalid", { week });
  }
  if (!Number.isInteger(week.week) || week.week < 1 || week.week > 53) {
    throw new DeepbookUsdcIndexSourceError("invalid_payload", "DeepBook USDC index week number is invalid", { week });
  }
  return `data/${pairId}/bars/${week.weekYear}/W${week.week.toString().padStart(2, "0")}.json`;
}

export function utcIsoWeekFromDate(date: Date): UtcIsoWeek {
  if (!Number.isFinite(date.getTime())) {
    throw new DeepbookUsdcIndexSourceError("invalid_payload", "DeepBook USDC index date is invalid");
  }
  const utcMidnight = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcMidnight.getUTCDay() || 7;
  utcMidnight.setUTCDate(utcMidnight.getUTCDate() + 4 - day);
  const weekYear = utcMidnight.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil(((utcMidnight.getTime() - yearStart.getTime()) / ONE_DAY_MS + 1) / 7);
  return { weekYear, week };
}

function parseIndexPayload<T>(schema: z.ZodType<T>, json: unknown, path: string): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new DeepbookUsdcIndexSourceError("invalid_payload", "DeepBook USDC index payload failed schema validation", {
      path,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }
  return parsed.data;
}

function sourceFetchError(error: unknown, path: string, url: string): DeepbookUsdcIndexSourceError {
  const message = error instanceof Error ? error.message : String(error);
  if (isAbortError(error)) {
    return new DeepbookUsdcIndexSourceError("source_timeout", "DeepBook USDC index source timed out", {
      path,
      url,
      message
    });
  }
  return new DeepbookUsdcIndexSourceError("source_unavailable", "DeepBook USDC index source could not be read", {
    path,
    url,
    message
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}
