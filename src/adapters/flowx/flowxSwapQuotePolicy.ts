import type { RefreshReason } from "../../core/action/types.js";
import { parseDeepbookRawU64 } from "../../core/read/deepbookReadHelpers.js";

export const FLOWX_REVIEW_QUOTE_STALE_AFTER_MS = 30_000;
// Same-machine pipelines capture `now` before the network quote fetch, so the
// fetch timestamp can land slightly "in the future". Treat skew within this
// tolerance as a fresh quote; beyond it is a clock-integrity violation.
export const FLOWX_QUOTE_FUTURE_SKEW_TOLERANCE_MS = 5_000;
export const FLOWX_MAX_SLIPPAGE_BPS = 1000;
export const FLOWX_MIN_SLIPPAGE_BPS = 1;
const BPS_DENOMINATOR = 10_000n;
// The FlowX universal router expresses slippage on a 1e6 denominator; one
// basis point is 100 router units.
export const FLOWX_ROUTER_SLIPPAGE_UNITS_PER_BPS = 100;

export type FlowxSwapQuotePolicyInput = {
  amountInRaw: string;
  amountOutRaw: string;
  swapXToY: boolean;
  fetchedAt: string;
  maxSlippageBps: number;
  now: Date;
  staleAfterMs?: number;
};

export type FlowxSwapQuotePolicyOk = {
  status: "ok";
  swapXToY: boolean;
  quoteFresh: true;
  fetchedAt: string;
  quoteAgeMs: number;
  staleAfterMs: number;
  clockSkewMs?: number | undefined;
  maxSlippageBps: number;
  /** Slippage expressed on the router's 1e6 denominator (bps x 100). */
  routerSlippageUnits: number;
  /** Build deadline: quote fetchedAt + staleAfterMs, as a ms epoch. */
  deadlineMsEpoch: number;
  sourceAmountRaw: string;
  expectedOutRaw: string;
  minOutRaw: string;
};

export type FlowxSwapQuotePolicyRefreshRequired = {
  status: "refresh_required";
  refreshReason: RefreshReason;
  reason: "quote_stale" | "quote_timestamp_in_future" | "zero_expected_output" | "zero_min_out";
  swapXToY: boolean;
  fetchedAt: string;
  quoteAgeMs: number;
  staleAfterMs: number;
  clockSkewMs?: number | undefined;
};

export type FlowxSwapQuotePolicyResult = FlowxSwapQuotePolicyOk | FlowxSwapQuotePolicyRefreshRequired;

export function deriveFlowxSwapQuotePolicy(input: FlowxSwapQuotePolicyInput): FlowxSwapQuotePolicyResult {
  assertSlippageBps(input.maxSlippageBps);
  const staleAfterMs = input.staleAfterMs ?? FLOWX_REVIEW_QUOTE_STALE_AFTER_MS;
  if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1) {
    throw new Error("staleAfterMs must be a positive integer");
  }

  const fetchedAtMs = parseIsoUtcTimestampMs(input.fetchedAt, "fetchedAt");
  const nowMs = parseValidDateMs(input.now, "now");
  const rawQuoteAgeMs = nowMs - fetchedAtMs;
  if (rawQuoteAgeMs < -FLOWX_QUOTE_FUTURE_SKEW_TOLERANCE_MS) {
    return {
      status: "refresh_required",
      refreshReason: "quote_stale",
      reason: "quote_timestamp_in_future",
      swapXToY: input.swapXToY,
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
      swapXToY: input.swapXToY,
      fetchedAt: input.fetchedAt,
      quoteAgeMs,
      staleAfterMs
    };
  }

  const expectedOut = parseDeepbookRawU64(input.amountOutRaw, "amountOutRaw");
  if (expectedOut === 0n) {
    return unavailableQuote(input, quoteAgeMs, staleAfterMs, "zero_expected_output");
  }
  const minOut = (expectedOut * (BPS_DENOMINATOR - BigInt(input.maxSlippageBps))) / BPS_DENOMINATOR;
  if (minOut === 0n) {
    return unavailableQuote(input, quoteAgeMs, staleAfterMs, "zero_min_out");
  }

  return {
    status: "ok",
    swapXToY: input.swapXToY,
    quoteFresh: true,
    fetchedAt: input.fetchedAt,
    quoteAgeMs,
    staleAfterMs,
    ...(clockSkewMs !== undefined ? { clockSkewMs } : {}),
    maxSlippageBps: input.maxSlippageBps,
    routerSlippageUnits: input.maxSlippageBps * FLOWX_ROUTER_SLIPPAGE_UNITS_PER_BPS,
    deadlineMsEpoch: fetchedAtMs + staleAfterMs,
    sourceAmountRaw: parseDeepbookRawU64(input.amountInRaw, "amountInRaw", { positive: true }).toString(),
    expectedOutRaw: expectedOut.toString(),
    minOutRaw: minOut.toString()
  };
}

function assertSlippageBps(value: number): void {
  if (!Number.isInteger(value) || value < FLOWX_MIN_SLIPPAGE_BPS || value > FLOWX_MAX_SLIPPAGE_BPS) {
    throw new Error(`maxSlippageBps must be an integer from ${FLOWX_MIN_SLIPPAGE_BPS} to ${FLOWX_MAX_SLIPPAGE_BPS}`);
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

function unavailableQuote(
  input: FlowxSwapQuotePolicyInput,
  quoteAgeMs: number,
  staleAfterMs: number,
  reason: "zero_expected_output" | "zero_min_out"
): FlowxSwapQuotePolicyRefreshRequired {
  return {
    status: "refresh_required",
    refreshReason: "quote_unavailable",
    reason,
    swapXToY: input.swapXToY,
    fetchedAt: input.fetchedAt,
    quoteAgeMs,
    staleAfterMs
  };
}
