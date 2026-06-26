import { parseSuiAddress } from "../suiAddress.js";
import type {
  ExternalActivityCoverageResult,
  ExternalActivityTransactionRecord
} from "./activityStore.js";
import { requestedAccountEffectsForTransaction } from "./transactionActivityAccountEffects.js";
import type { SuiTransactionActivityFact } from "./transactionActivityTypes.js";

export const ACCOUNT_ASSET_TIMELINE_BUCKET_MINUTES = [10, 30, 60, 1440] as const;

export type AccountAssetTimelineBucketMinutes = typeof ACCOUNT_ASSET_TIMELINE_BUCKET_MINUTES[number];

export type AccountAssetTimelineStatus =
  | "ok"
  | "partial_coverage"
  | "scan_needed"
  | "account_not_known";

export type AccountAssetTimelineBalanceStatus = "unavailable_no_balance_anchor";

export type AccountAssetTimelineLimitation =
  | "no_balance_anchor"
  | "account_not_known"
  | "no_stored_activity_scans"
  | "no_complete_affected_account_scan"
  | "sent_only_scan_not_full_account_coverage"
  | "scan_window_incomplete"
  | "scan_window_unbounded"
  | "scan_records_truncated"
  | "source_transactions_truncated"
  | "transaction_timestamp_unavailable"
  | "transaction_details_unavailable"
  | "provider_balance_changes_truncated"
  | "no_observed_account_balance_changes";

export type AccountAssetTimelineInput = {
  account: string;
  from: string;
  to: string;
  bucketMinutes: AccountAssetTimelineBucketMinutes;
  coverage: ExternalActivityCoverageResult;
  transactions: ExternalActivityTransactionRecord[];
  transactionsTruncated?: boolean | undefined;
};

export type AccountAssetTimelineResult = {
  account: string;
  requestedRange: {
    from: string;
    to: string;
  };
  bucket: {
    minutes: AccountAssetTimelineBucketMinutes;
    alignment: "utc_epoch";
  };
  status: AccountAssetTimelineStatus;
  balanceStatus: AccountAssetTimelineBalanceStatus;
  coverage: ExternalActivityCoverageResult;
  sourceTransactionCount: number;
  analyzedTransactionCount: number;
  skippedTransactionCount: number;
  netFlowBars: AccountAssetTimelineNetFlowBar[];
  balanceBars: [];
  quantitySemantics: {
    netFlowBars: "observed_account_scoped_raw_token_balance_changes";
    balanceBars: "unavailable_without_balance_anchor";
  };
  limitations: AccountAssetTimelineLimitation[];
};

export type AccountAssetTimelineNetFlowBar = {
  bucketStart: string;
  bucketEnd: string;
  coinType: string;
  increaseRaw: string;
  decreaseRaw: string;
  netRaw: string;
  transactionCount: number;
};

type NetFlowAccumulator = {
  bucketStartMs: number;
  bucketEndMs: number;
  coinType: string;
  increaseRaw: bigint;
  decreaseRaw: bigint;
  netRaw: bigint;
  digests: Set<string>;
};

export function buildAccountAssetTimeline(input: AccountAssetTimelineInput): AccountAssetTimelineResult {
  const account = parseSuiAddress(input.account);
  if (account === undefined) {
    throw new Error("Account asset timeline account must be a valid Sui address");
  }
  const fromMs = parseRequiredUtc(input.from, "from");
  const toMs = parseRequiredUtc(input.to, "to");
  if (fromMs >= toMs) {
    throw new Error("Account asset timeline from must be before to");
  }
  assertSupportedBucketMinutes(input.bucketMinutes);

  const limitations = new Set<AccountAssetTimelineLimitation>(["no_balance_anchor"]);
  if (!input.coverage.accountKnown) {
    limitations.add("account_not_known");
  }
  for (const limitation of input.coverage.limitations) {
    limitations.add(limitation);
  }
  if (input.transactionsTruncated === true) {
    limitations.add("source_transactions_truncated");
  }

  const bucketMs = input.bucketMinutes * 60 * 1000;
  const bars = new Map<string, NetFlowAccumulator>();
  let analyzedTransactionCount = 0;
  let skippedTransactionCount = 0;

  for (const transaction of input.transactions) {
    if (transaction.account !== account) {
      skippedTransactionCount += 1;
      continue;
    }
    if (transaction.timestamp === undefined) {
      skippedTransactionCount += 1;
      limitations.add("transaction_timestamp_unavailable");
      continue;
    }
    const timestampMs = Date.parse(transaction.timestamp);
    if (!Number.isFinite(timestampMs)) {
      skippedTransactionCount += 1;
      limitations.add("transaction_timestamp_unavailable");
      continue;
    }
    if (timestampMs < fromMs || timestampMs >= toMs) {
      skippedTransactionCount += 1;
      continue;
    }

    const effects = requestedAccountEffectsForTransaction(transactionRecordToActivityFact(transaction), account);
    if (effects.balanceChangeCompleteness === "unavailable") {
      limitations.add("transaction_details_unavailable");
    }
    if (effects.balanceChangeCompleteness === "truncated") {
      limitations.add("provider_balance_changes_truncated");
    }
    analyzedTransactionCount += 1;

    const bucketStartMs = Math.floor(timestampMs / bucketMs) * bucketMs;
    const bucketEndMs = bucketStartMs + bucketMs;
    for (const change of effects.balanceChanges) {
      const amount = BigInt(change.amountRaw);
      const key = `${bucketStartMs}\n${change.coinType}`;
      const entry = bars.get(key) ?? {
        bucketStartMs,
        bucketEndMs,
        coinType: change.coinType,
        increaseRaw: 0n,
        decreaseRaw: 0n,
        netRaw: 0n,
        digests: new Set<string>()
      };
      entry.netRaw += amount;
      if (amount > 0n) {
        entry.increaseRaw += amount;
      } else if (amount < 0n) {
        entry.decreaseRaw += -amount;
      }
      entry.digests.add(transaction.digest);
      bars.set(key, entry);
    }
  }

  const netFlowBars = [...bars.values()].map(netFlowBarFromAccumulator).sort(compareNetFlowBars);
  if (netFlowBars.length === 0) {
    limitations.add("no_observed_account_balance_changes");
  }

  return {
    account,
    requestedRange: {
      from: input.from,
      to: input.to
    },
    bucket: {
      minutes: input.bucketMinutes,
      alignment: "utc_epoch"
    },
    status: statusForCoverage(input.coverage),
    balanceStatus: "unavailable_no_balance_anchor",
    coverage: input.coverage,
    sourceTransactionCount: input.transactions.length,
    analyzedTransactionCount,
    skippedTransactionCount,
    netFlowBars,
    balanceBars: [],
    quantitySemantics: {
      netFlowBars: "observed_account_scoped_raw_token_balance_changes",
      balanceBars: "unavailable_without_balance_anchor"
    },
    limitations: [...limitations].sort()
  };
}

function transactionRecordToActivityFact(record: ExternalActivityTransactionRecord): SuiTransactionActivityFact {
  return {
    digest: record.digest,
    checkpoint: record.checkpoint,
    timestamp: record.timestamp,
    status: record.status,
    details: record.details
  };
}

function netFlowBarFromAccumulator(value: NetFlowAccumulator): AccountAssetTimelineNetFlowBar {
  return {
    bucketStart: new Date(value.bucketStartMs).toISOString(),
    bucketEnd: new Date(value.bucketEndMs).toISOString(),
    coinType: value.coinType,
    increaseRaw: value.increaseRaw.toString(),
    decreaseRaw: value.decreaseRaw.toString(),
    netRaw: value.netRaw.toString(),
    transactionCount: value.digests.size
  };
}

function statusForCoverage(coverage: ExternalActivityCoverageResult): AccountAssetTimelineStatus {
  if (!coverage.accountKnown) {
    return "account_not_known";
  }
  if (coverage.coverageStatus === "no_stored_scans") {
    return "scan_needed";
  }
  if (coverage.coverageStatus === "partial") {
    return "partial_coverage";
  }
  return "ok";
}

function parseRequiredUtc(value: string, field: "from" | "to"): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Account asset timeline ${field} must be an ISO 8601 UTC timestamp`);
  }
  return parsed.getTime();
}

function assertSupportedBucketMinutes(value: number): asserts value is AccountAssetTimelineBucketMinutes {
  if (!ACCOUNT_ASSET_TIMELINE_BUCKET_MINUTES.includes(value as AccountAssetTimelineBucketMinutes)) {
    throw new Error("Unsupported account asset timeline bucket size");
  }
}

function compareNetFlowBars(a: AccountAssetTimelineNetFlowBar, b: AccountAssetTimelineNetFlowBar): number {
  const bucketComparison = a.bucketStart.localeCompare(b.bucketStart);
  if (bucketComparison !== 0) {
    return bucketComparison;
  }
  return a.coinType.localeCompare(b.coinType);
}
