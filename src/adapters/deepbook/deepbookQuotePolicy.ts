import type { RefreshReason } from "../../core/action/types.js";
import { parseDeepbookRawU64 } from "../../core/read/deepbookReadHelpers.js";
import type { DeepbookRawQuoteEvidence, QuoteDirection } from "../../core/read/readServiceTypes.js";

export const DEEPBOOK_REVIEW_QUOTE_STALE_AFTER_MS = 30_000;
// Same-machine pipelines capture `now` before the network quote fetch, so the
// fetch timestamp can land a few hundred milliseconds "in the future". Treat
// skew within this tolerance as a fresh quote (age 0) and record the skew;
// anything beyond it is a real clock-integrity violation and refuses.
export const DEEPBOOK_QUOTE_FUTURE_SKEW_TOLERANCE_MS = 5_000;
export const DEEPBOOK_MAX_SLIPPAGE_BPS = 1000;
export const DEEPBOOK_MIN_SLIPPAGE_BPS = 1;
const BPS_DENOMINATOR = 10_000n;

export type DeepbookSwapQuotePolicyInput = {
  rawQuote: DeepbookRawQuoteEvidence;
  fetchedAt: string;
  maxSlippageBps: number;
  now: Date;
  staleAfterMs?: number;
  feeMode?: "deep" | "input_coin" | undefined;
};

export type DeepbookSwapQuotePolicyOk = {
  status: "ok";
  direction: QuoteDirection;
  quoteFresh: true;
  fetchedAt: string;
  quoteAgeMs: number;
  staleAfterMs: number;
  clockSkewMs?: number | undefined;
  feeMode: "deep" | "input_coin";
  maxSlippageBps: number;
  sourceAmountRaw: string;
  expectedOutRaw: string;
  minOutRaw: string;
  deepAmountRaw: string;
};

export type DeepbookSwapQuotePolicyRefreshRequired = {
  status: "refresh_required";
  refreshReason: RefreshReason;
  reason: "quote_stale" | "quote_timestamp_in_future" | "zero_expected_output" | "zero_min_out";
  direction: QuoteDirection;
  fetchedAt: string;
  quoteAgeMs: number;
  staleAfterMs: number;
  clockSkewMs?: number | undefined;
};

export type DeepbookSwapQuotePolicyResult =
  | DeepbookSwapQuotePolicyOk
  | DeepbookSwapQuotePolicyRefreshRequired;

export function deriveDeepbookSwapQuotePolicy(
  input: DeepbookSwapQuotePolicyInput
): DeepbookSwapQuotePolicyResult {
  assertSlippageBps(input.maxSlippageBps);
  const staleAfterMs = input.staleAfterMs ?? DEEPBOOK_REVIEW_QUOTE_STALE_AFTER_MS;
  if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1) {
    throw new Error("staleAfterMs must be a positive integer");
  }

  const fetchedAtMs = parseIsoUtcTimestampMs(input.fetchedAt, "fetchedAt");
  const nowMs = parseValidDateMs(input.now, "now");
  const rawQuoteAgeMs = nowMs - fetchedAtMs;
  const direction = directionFromRawQuote(input.rawQuote);
  if (rawQuoteAgeMs < -DEEPBOOK_QUOTE_FUTURE_SKEW_TOLERANCE_MS) {
    return {
      status: "refresh_required",
      refreshReason: "quote_stale",
      reason: "quote_timestamp_in_future",
      direction,
      fetchedAt: input.fetchedAt,
      quoteAgeMs: 0,
      staleAfterMs,
      clockSkewMs: -rawQuoteAgeMs
    };
  }
  const clockSkewMs = rawQuoteAgeMs < 0 ? -rawQuoteAgeMs : undefined;
  const quoteAgeMs = rawQuoteAgeMs < 0 ? 0 : rawQuoteAgeMs;
  if (quoteAgeMs > staleAfterMs) {
    return {
      status: "refresh_required",
      refreshReason: "quote_stale",
      reason: "quote_stale",
      direction,
      fetchedAt: input.fetchedAt,
      quoteAgeMs,
      staleAfterMs
    };
  }

  const expectedOut = parseUnsignedRaw(input.rawQuote.directionalOutput.raw, "directionalOutput.raw");
  if (expectedOut === 0n) {
    return unavailableQuote(input, direction, quoteAgeMs, staleAfterMs, "zero_expected_output");
  }
  const minOut =
    (expectedOut * (BPS_DENOMINATOR - BigInt(input.maxSlippageBps))) / BPS_DENOMINATOR;
  if (minOut === 0n) {
    return unavailableQuote(input, direction, quoteAgeMs, staleAfterMs, "zero_min_out");
  }

  return {
    status: "ok",
    direction,
    quoteFresh: true,
    fetchedAt: input.fetchedAt,
    quoteAgeMs,
    staleAfterMs,
    ...(clockSkewMs !== undefined ? { clockSkewMs } : {}),
    feeMode: input.feeMode ?? "deep",
    maxSlippageBps: input.maxSlippageBps,
    sourceAmountRaw: parsePositiveRaw(input.rawQuote.inputAmount.raw, "inputAmount.raw").toString(),
    expectedOutRaw: expectedOut.toString(),
    minOutRaw: minOut.toString(),
    deepAmountRaw: parseUnsignedRaw(input.rawQuote.deepRequired.raw, "deepRequired.raw").toString()
  };
}

function assertSlippageBps(value: number): void {
  if (!Number.isInteger(value) || value < DEEPBOOK_MIN_SLIPPAGE_BPS || value > DEEPBOOK_MAX_SLIPPAGE_BPS) {
    throw new Error(`maxSlippageBps must be an integer from ${DEEPBOOK_MIN_SLIPPAGE_BPS} to ${DEEPBOOK_MAX_SLIPPAGE_BPS}`);
  }
}

function parseIsoUtcTimestampMs(value: string, field: string): number {
  const parsed = new Date(value);
  const timestampMs = parsed.getTime();
  if (!Number.isFinite(timestampMs) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be an ISO 8601 UTC timestamp`);
  }
  return timestampMs;
}

function parseValidDateMs(value: Date, field: string): number {
  if (!(value instanceof Date)) {
    throw new Error(`${field} must be a valid Date`);
  }
  const timestampMs = value.getTime();
  if (!Number.isFinite(timestampMs)) {
    throw new Error(`${field} must be a valid Date`);
  }
  return timestampMs;
}

function directionFromRawQuote(rawQuote: DeepbookRawQuoteEvidence): QuoteDirection {
  return rawQuote.sourceMoveFunction.startsWith("pool::get_quote_quantity_out") ? "base_to_quote" : "quote_to_base";
}

function unavailableQuote(
  input: DeepbookSwapQuotePolicyInput,
  direction: QuoteDirection,
  quoteAgeMs: number,
  staleAfterMs: number,
  reason: "zero_expected_output" | "zero_min_out"
): DeepbookSwapQuotePolicyRefreshRequired {
  return {
    status: "refresh_required",
    refreshReason: "quote_unavailable",
    reason,
    direction,
    fetchedAt: input.fetchedAt,
    quoteAgeMs,
    staleAfterMs
  };
}

function parsePositiveRaw(value: string, field: string): bigint {
  return parseDeepbookRawU64(value, field, { positive: true });
}

function parseUnsignedRaw(value: string, field: string): bigint {
  return parseDeepbookRawU64(value, field);
}
