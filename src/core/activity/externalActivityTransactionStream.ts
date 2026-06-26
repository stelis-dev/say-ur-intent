import type {
  ExternalActivityTransactionRecord,
  ExternalActivityTransactionStreamResult,
  ReviewActivityAccountSource
} from "./activityStore.js";

export type ExternalActivityTransactionStreamScope = {
  account: string;
  accountId?: number | undefined;
  accountSource: ReviewActivityAccountSource;
};

export function transactionTimestampInHalfOpenRange(
  transaction: Pick<ExternalActivityTransactionRecord, "timestamp">,
  from: string,
  to: string
): boolean {
  return transaction.timestamp !== undefined && transaction.timestamp >= from && transaction.timestamp < to;
}

export function canonicalExternalActivityTransactions(
  rows: ExternalActivityTransactionRecord[]
): ExternalActivityTransactionRecord[] {
  const byDigest = new Map<string, ExternalActivityTransactionRecord>();
  for (const row of rows) {
    const existing = byDigest.get(row.digest);
    if (existing === undefined || compareCanonicalTransactionPreference(row, existing) < 0) {
      byDigest.set(row.digest, row);
    }
  }
  return [...byDigest.values()].sort(compareExternalActivityTransactionsDescending);
}

export function buildExternalActivityTransactionStreamResult(input: {
  scope: ExternalActivityTransactionStreamScope;
  from: string;
  to: string;
  transactions: ExternalActivityTransactionRecord[];
  truncated: boolean;
  transactionCount: number;
}): ExternalActivityTransactionStreamResult {
  return {
    dataScope: {
      account: input.scope.account,
      from: input.from,
      to: input.to,
      recordCount: input.transactionCount
    },
    accountSource: input.scope.accountSource,
    accountKnown: input.scope.accountId !== undefined,
    truncated: input.truncated,
    transactionCount: input.transactionCount,
    transactions: input.transactions
  };
}

function compareCanonicalTransactionPreference(
  a: ExternalActivityTransactionRecord,
  b: ExternalActivityTransactionRecord
): number {
  const detailComparison = Number(b.details !== undefined) - Number(a.details !== undefined);
  if (detailComparison !== 0) {
    return detailComparison;
  }
  const relationshipComparison = relationshipPreference(b.relationship) - relationshipPreference(a.relationship);
  if (relationshipComparison !== 0) {
    return relationshipComparison;
  }
  return compareExternalActivityTransactionsDescending(a, b);
}

function relationshipPreference(relationship: ExternalActivityTransactionRecord["relationship"]): number {
  return relationship === "affected" ? 1 : 0;
}

export function compareExternalActivityTransactionsDescending(
  a: ExternalActivityTransactionRecord,
  b: ExternalActivityTransactionRecord
): number {
  const checkpointComparison = compareOptionalIntegerStringsDesc(a.checkpoint, b.checkpoint);
  if (checkpointComparison !== 0) {
    return checkpointComparison;
  }
  const timestampComparison = compareOptionalStringsDesc(a.timestamp, b.timestamp);
  if (timestampComparison !== 0) {
    return timestampComparison;
  }
  return b.digest.localeCompare(a.digest);
}

function compareOptionalStringsDesc(a: string | undefined, b: string | undefined): number {
  if (a === undefined && b === undefined) {
    return 0;
  }
  if (a === undefined) {
    return 1;
  }
  if (b === undefined) {
    return -1;
  }
  return b.localeCompare(a);
}

function compareOptionalIntegerStringsDesc(a: string | undefined, b: string | undefined): number {
  if (a === undefined && b === undefined) {
    return 0;
  }
  if (a === undefined) {
    return 1;
  }
  if (b === undefined) {
    return -1;
  }
  const delta = BigInt(b) - BigInt(a);
  if (delta < 0n) return -1;
  if (delta > 0n) return 1;
  return 0;
}
