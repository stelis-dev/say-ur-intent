import type {
  ActionPlan,
  ExecutionResult,
  InternalSessionStatus,
  ReviewSession,
  ToolErrorKind,
  ReviewState
} from "../action/types.js";
import type { ExternalActivityTransactionDetail } from "./transactionActivityDetails.js";

export type AccountSource = "wallet_identity" | "review_execution";
export type ActiveAccountSource = "wallet_identity" | "cleared";
export type ReviewTransitionEvent =
  | "created"
  | "opened"
  | "wallet_connected"
  | "state_computed"
  | "result_recorded"
  | "expired";

export const REVIEW_ACTIVITY_LOW_SAMPLE_THRESHOLD = 5;
export const REVIEW_ACTIVITY_LIST_DEFAULT_LIMIT = 20;
export const REVIEW_ACTIVITY_LIST_MAX_LIMIT = 100;
export const REVIEW_ACTIVITY_DETAIL_MAX_ITEMS = 100;
export const EXTERNAL_ACTIVITY_SCAN_DEFAULT_LIMIT = 100;
export const EXTERNAL_ACTIVITY_SCAN_MAX_LIMIT = 100;
export const EXTERNAL_ACTIVITY_COVERAGE_SCAN_MAX_RECORDS = 100;

export type AccountRecord = {
  id: number;
  address: string;
  firstSeenAt: string;
  lastUsedAt: string;
  firstSource: AccountSource;
  lastSource: AccountSource;
};

export type ActiveAccountWallet = {
  name?: string | undefined;
  id?: string | undefined;
};

export type ActiveAccountRecord = {
  accountId: number;
  address: string;
  source: Exclude<ActiveAccountSource, "cleared">;
  setAt: string;
  walletName?: string;
  walletId?: string;
};

export type ExternalActivityRelationship = "affected" | "sent";
export type ExternalActivityScanKind = "digest_lookup" | "account_scan" | "function_scan";
export type ExternalActivityTransactionStatus = "success" | "failure" | "unknown";
export type ExternalActivityIncompleteReason =
  | "limit_reached"
  | "ordering_unverified"
  | "cursor_invalid"
  | "provider_error";

export type ExternalActivityScanInput = {
  scanId: string;
  kind: ExternalActivityScanKind;
  account: string;
  relationship: ExternalActivityRelationship;
  inputDigest?: string | undefined;
  fromCheckpoint?: string | undefined;
  toCheckpoint?: string | undefined;
  fromTimestamp?: string | undefined;
  toTimestamp?: string | undefined;
  limit: number;
  requestCursor?: string | undefined;
  responseCursor?: string | undefined;
  endpointHost: string;
  chainIdentifier: string;
  fetchedAt: string;
  hasMore: boolean;
  windowComplete: boolean | null;
  incompleteReason?: ExternalActivityIncompleteReason | undefined;
  skippedCount?: number | undefined;
  transactions: ExternalActivityTransactionInput[];
};

export type ExternalActivityTransactionInput = {
  digest: string;
  relationship: ExternalActivityRelationship;
  checkpoint?: string | undefined;
  timestamp?: string | undefined;
  status: ExternalActivityTransactionStatus;
  knownSenderAccountId?: number | undefined;
  details?: ExternalActivityTransactionDetail | undefined;
};

export type ExternalActivityScanRecord = {
  scanId: string;
  kind: ExternalActivityScanKind;
  accountId: number;
  account: string;
  relationship: ExternalActivityRelationship;
  inputDigest?: string | undefined;
  fromCheckpoint?: string | undefined;
  toCheckpoint?: string | undefined;
  fromTimestamp?: string | undefined;
  toTimestamp?: string | undefined;
  limit: number;
  requestCursor?: string | undefined;
  responseCursor?: string | undefined;
  endpointHost: string;
  chainIdentifier: string;
  fetchedAt: string;
  storedCount: number;
  skippedCount: number;
  hasMore: boolean;
  windowComplete: boolean | null;
  incompleteReason?: ExternalActivityIncompleteReason | undefined;
};

export type ExternalActivityTransactionRecord = {
  accountId: number;
  account: string;
  digest: string;
  relationship: ExternalActivityRelationship;
  checkpoint?: string | undefined;
  timestamp?: string | undefined;
  status: ExternalActivityTransactionStatus;
  knownSenderAccountId?: number | undefined;
  firstScanId: string;
  lastScanId: string;
  firstFetchedAt: string;
  lastFetchedAt: string;
  lastScanIncompleteReason?: ExternalActivityIncompleteReason | undefined;
  details?: ExternalActivityTransactionDetail | undefined;
};

export type ExternalActivitySummaryFilter = {
  account?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
};

export type ExternalActivityCoverageFilter = {
  account?: string | undefined;
  from: string;
  to: string;
};

export type ExternalActivityTransactionStreamFilter = {
  account?: string | undefined;
  from: string;
  to: string;
  limit?: number | undefined;
};

export type ExternalActivityCoverageStatus =
  | "complete"
  | "partial"
  | "no_stored_scans";

export type ExternalActivityCoverageLimitation =
  | "no_stored_activity_scans"
  | "no_complete_affected_account_scan"
  | "sent_only_scan_not_full_account_coverage"
  | "scan_window_incomplete"
  | "scan_window_unbounded"
  | "scan_records_truncated";

export type ExternalActivityCoverageResult = {
  dataScope: ReviewActivityDataScope;
  accountSource: ReviewActivityAccountSource;
  accountKnown: boolean;
  requestedRange: {
    from: string;
    to: string;
  };
  coverageStatus: ExternalActivityCoverageStatus;
  scanCount: number;
  returnedScanCount: number;
  scansTruncated: boolean;
  storedTransactionCount: number;
  storedTransactionRange?: {
    earliestTimestamp?: string | undefined;
    latestTimestamp?: string | undefined;
    earliestCheckpoint?: string | undefined;
    latestCheckpoint?: string | undefined;
  } | undefined;
  coverageEvidence: {
    completeAffectedAccountScanIds: string[];
    incompleteScanIds: string[];
    sentOnlyScanIds: string[];
  };
  limitations: ExternalActivityCoverageLimitation[];
  scans: ExternalActivityScanRecord[];
};

export type ExternalActivitySummaryResult = {
  dataScope: ReviewActivityDataScope;
  accountSource: ReviewActivityAccountSource;
  lowSampleWarning: boolean;
  lowSampleThreshold: number;
  truncated: boolean;
  summary: {
    transactionCount: number;
    statusCounts: Record<ExternalActivityTransactionStatus, number>;
    relationshipCounts: Record<ExternalActivityRelationship, number>;
    earliestTimestamp?: string | undefined;
    latestTimestamp?: string | undefined;
  };
  transactions: ExternalActivityTransactionRecord[];
};

export type ExternalActivityTransactionStreamResult = {
  dataScope: ReviewActivityDataScope;
  accountSource: ReviewActivityAccountSource;
  accountKnown: boolean;
  truncated: boolean;
  transactionCount: number;
  transactions: ExternalActivityTransactionRecord[];
};

export type ReviewActivityAccountSource = "active_account_context" | "explicit_filter";

export type ReviewActivityDataScope = {
  account: string;
  from?: string | undefined;
  to?: string | undefined;
  recordCount: number;
};

export type ReviewActivityTruncation = {
  activities: boolean;
  snapshots: boolean;
  transitions: boolean;
};

export type ReviewActivityFilter = {
  account?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

export type ReviewActivityListFilter = ReviewActivityFilter & {
  status?: InternalSessionStatus | undefined;
  limit?: number | undefined;
};

export type ReviewActivityRow = {
  reviewSessionId: string;
  planId: string;
  actionKind: string;
  adapterId: string;
  protocol: string;
  currentStatus: InternalSessionStatus;
  account: string;
  createdAt: string;
  updatedAt: string;
  executionStatus?: string | undefined;
  txDigest?: string | undefined;
  snapshotCount: number;
  transitionCount: number;
};

export type ReviewActivityListResult = {
  dataScope: ReviewActivityDataScope;
  accountSource: ReviewActivityAccountSource;
  lowSampleWarning: boolean;
  lowSampleThreshold: number;
  truncated: ReviewActivityTruncation;
  activities: ReviewActivityRow[];
};

export type ReviewFunnelSummary = {
  total: number;
  opened: number;
  walletConnected: number;
  stateComputed: number;
  currentStatusCounts: Record<InternalSessionStatus, number>;
  everReachedReviewStateCounts: Record<"ready_for_wallet_review" | "blocked" | "refresh_required", number>;
  signedPending: number;
  success: number;
  failure: number;
  expiredBeforeResult: number;
  avgCreatedToSignedSeconds: number | null;
  avgOpenedToSignedSeconds: number | null;
};

export type ReviewFunnelSummaryResult = {
  dataScope: ReviewActivityDataScope;
  accountSource: ReviewActivityAccountSource;
  lowSampleWarning: boolean;
  lowSampleThreshold: number;
  truncated: ReviewActivityTruncation;
  summary: ReviewFunnelSummary;
};

export type ReviewSessionDetailInput = {
  reviewSessionId: string;
  account?: string | undefined;
};

export type ReviewSessionDetailResult = {
  dataScope: ReviewActivityDataScope;
  accountSource: ReviewActivityAccountSource;
  lowSampleWarning: boolean;
  lowSampleThreshold: number;
  session: {
    reviewSessionId: string;
    planId: string;
    actionKind: string;
    adapterId: string;
    protocol: string;
    currentStatus: InternalSessionStatus;
    account: string;
    createdAt: string;
    updatedAt: string;
  };
  planJson: ActionPlan;
  intentJson?: unknown | undefined;
  stateSnapshots: Array<{
    id: number;
    planId: string;
    account: string;
    status: string;
    blockedReason?: string | undefined;
    refreshReason?: string | undefined;
    stateJson: ReviewState;
    updatedAt: string;
    recordedAt: string;
  }>;
  transitions: Array<{
    id: number;
    event: ReviewTransitionEvent;
    fromStatus?: string | undefined;
    toStatus: string;
    isNoOp: boolean;
    account?: string | undefined;
    reason?: string | undefined;
    transitionedAt: string;
  }>;
  execution?: (ReviewExecutionRecord & { resultJson: ExecutionResult }) | undefined;
  truncated: ReviewActivityTruncation;
};

export class ActivityStoreReadError extends Error {
  constructor(
    readonly kind: Extract<ToolErrorKind, "input_invalid" | "active_account_not_set" | "session_not_found" | "internal_error">,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export type ReviewExecutionInput = {
  reviewSessionId: string;
  planId: string;
  account: string;
  fromStatus?: string | undefined;
  status: string;
  txDigest?: string | undefined;
  explorerUrl?: string | undefined;
  failureReason?: string | undefined;
  result: ExecutionResult;
  recordedAt: string;
};

export type ReviewExecutionRecord = {
  reviewSessionId: string;
  planId: string;
  accountId: number;
  account: string;
  status: string;
  txDigest?: string | undefined;
  explorerUrl?: string | undefined;
  failureReason?: string | undefined;
  recordedAt: string;
  updatedAt: string;
};

export type ReviewSessionEvidenceInput = {
  reviewSessionId: string;
  plan: ActionPlan;
  currentStatus: InternalSessionStatus;
  createdAt: string;
};

export type ReviewTransitionInput = {
  reviewSessionId: string;
  event: ReviewTransitionEvent;
  fromStatus?: string | undefined;
  toStatus: string;
  account?: string | undefined;
  reason?: string | undefined;
  transitionedAt: string;
};

export type ReviewStateSnapshotInput = {
  reviewSessionId: string;
  fromStatus?: string | undefined;
  state: ReviewState;
  recordedAt: string;
};

export type LiveReviewSessionMutation = {
  expected?: ReviewSession | undefined;
  next: ReviewSession;
  privateArtifactsJson?: string | null | undefined;
  deleteTransactionMaterials?: boolean | undefined;
};

export interface ActivityStore {
  upsertAccount(address: string, source: AccountSource, now?: Date): Promise<AccountRecord>;
  getKnownAccount(address: string): Promise<AccountRecord | undefined>;
  setActiveAccount(address: string, source: Exclude<ActiveAccountSource, "cleared">, now?: Date, wallet?: ActiveAccountWallet): Promise<ActiveAccountRecord>;
  getActiveAccount(): Promise<ActiveAccountRecord | undefined>;
  clearActiveAccount(now?: Date): Promise<void>;
  recordReviewSession(input: ReviewSessionEvidenceInput): Promise<void>;
  recordReviewSessionWithLiveSession?(input: ReviewSessionEvidenceInput, live: LiveReviewSessionMutation): Promise<boolean>;
  recordReviewTransition(input: ReviewTransitionInput): Promise<void>;
  recordReviewTransitionWithLiveSession?(input: ReviewTransitionInput, live: LiveReviewSessionMutation): Promise<boolean>;
  recordReviewStateSnapshot(input: ReviewStateSnapshotInput): Promise<void>;
  recordReviewStateSnapshotWithLiveSession?(input: ReviewStateSnapshotInput, live: LiveReviewSessionMutation): Promise<boolean>;
  recordReviewExecution(input: ReviewExecutionInput): Promise<ReviewExecutionRecord>;
  recordReviewExecutionWithLiveSession?(input: ReviewExecutionInput, live: LiveReviewSessionMutation): Promise<ReviewExecutionRecord | undefined>;
  getReviewExecution(reviewSessionId: string): Promise<ReviewExecutionRecord | undefined>;
  listReviewActivity(filter: ReviewActivityListFilter): Promise<ReviewActivityListResult>;
  summarizeReviewFunnel(filter: ReviewActivityFilter): Promise<ReviewFunnelSummaryResult>;
  getReviewSessionDetail(input: ReviewSessionDetailInput): Promise<ReviewSessionDetailResult>;
  recordExternalActivityScan(input: ExternalActivityScanInput): Promise<ExternalActivityScanRecord>;
  getExternalActivityCoverage(filter: ExternalActivityCoverageFilter): Promise<ExternalActivityCoverageResult>;
  listExternalActivityEffectTransactions(filter: ExternalActivityTransactionStreamFilter): Promise<ExternalActivityTransactionStreamResult>;
  summarizeExternalActivity(filter: ExternalActivitySummaryFilter): Promise<ExternalActivitySummaryResult>;
}
