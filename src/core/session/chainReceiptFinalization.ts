import type { ExecutionResult, ReviewSession } from "../action/types.js";
import type {
  SuiChainReceiptVerificationResult,
  VerifySuiChainReceiptInput
} from "../action/suiChainReceiptVerifier.js";
import { SessionStoreError, type SessionStore } from "./sessionStore.js";

export const CHAIN_RECEIPT_LOOKUP_MAX_AGE_MS = 10 * 60 * 1000;

export type ChainReceiptVerifier = (
  input: VerifySuiChainReceiptInput
) => Promise<SuiChainReceiptVerificationResult>;

export type LazyChainReceiptFinalizationOptions = {
  sessions: SessionStore;
  chainReceiptVerifier?: ChainReceiptVerifier | undefined;
};

export async function getReviewSessionWithLazyChainReceiptFinalization(
  options: LazyChainReceiptFinalizationOptions,
  reviewSessionId: string,
  now = new Date()
): Promise<ReviewSession | undefined> {
  const session = await options.sessions.getReviewSession(reviewSessionId, now);
  if (!session) {
    return undefined;
  }
  return finalizePendingExecutionResultFromChain(options, session, now);
}

export async function finalizePendingExecutionResultFromChain(
  options: LazyChainReceiptFinalizationOptions,
  session: ReviewSession,
  now = new Date()
): Promise<ReviewSession> {
  const pending = session.executionResult;
  if (
    !options.chainReceiptVerifier ||
    session.status !== "signed_pending_result" ||
    pending?.status !== "signed_pending_result"
  ) {
    return session;
  }

  const verificationInput = verificationInputForPendingSession(session, pending, now);
  if (!verificationInput.ok) {
    return recordChainFinalResult(options.sessions, session, {
      reviewSessionId: session.id,
      planId: pending.planId,
      status: "failure",
      txDigest: pending.txDigest,
      failureReason: "receipt_verification_failed",
      recordedAt: now.toISOString()
    }, now);
  }

  const result = await options.chainReceiptVerifier(verificationInput.input);
  switch (result.status) {
    case "verified_success":
      return recordChainFinalResult(options.sessions, session, {
        reviewSessionId: session.id,
        planId: pending.planId,
        status: "success",
        txDigest: pending.txDigest,
        chainReceipt: result.receipt,
        recordedAt: now.toISOString()
      }, now);
    case "verified_failure":
      return recordChainFinalResult(options.sessions, session, {
        reviewSessionId: session.id,
        planId: pending.planId,
        status: "failure",
        txDigest: pending.txDigest,
        failureReason: result.failureReason,
        chainReceipt: result.receipt,
        recordedAt: now.toISOString()
      }, now);
    case "verification_failed":
      return recordChainFinalResult(options.sessions, session, {
        reviewSessionId: session.id,
        planId: pending.planId,
        status: "failure",
        txDigest: pending.txDigest,
        failureReason: result.failureReason,
        recordedAt: now.toISOString()
      }, now);
    case "not_found":
      if (!pendingLookupWindowElapsed(pending.recordedAt, now)) {
        return session;
      }
      return recordChainFinalResult(options.sessions, session, {
        reviewSessionId: session.id,
        planId: pending.planId,
        status: "failure",
        txDigest: pending.txDigest,
        failureReason: result.failureReason,
        recordedAt: now.toISOString()
      }, now);
    default:
      return assertNever(result);
  }
}

function verificationInputForPendingSession(
  session: ReviewSession,
  pending: Extract<ExecutionResult, { status: "signed_pending_result" }>,
  now: Date
):
  | { ok: true; input: VerifySuiChainReceiptInput }
  | { ok: false } {
  const reviewedTransactionDigest = session.reviewState?.walletReviewAdapterContract?.transactionMaterialCommitment;
  const account = session.account;
  if (
    !reviewedTransactionDigest ||
    !account ||
    session.reviewState?.account !== account
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      txDigest: pending.txDigest,
      reviewedTransactionDigest,
      account,
      now
    }
  };
}

function pendingLookupWindowElapsed(recordedAt: string, now: Date): boolean {
  const recordedAtMs = Date.parse(recordedAt);
  if (!Number.isFinite(recordedAtMs)) {
    return true;
  }
  return now.getTime() - recordedAtMs >= CHAIN_RECEIPT_LOOKUP_MAX_AGE_MS;
}

async function recordChainFinalResult(
  sessions: SessionStore,
  previousSession: ReviewSession,
  result: ExecutionResult,
  now: Date
): Promise<ReviewSession> {
  try {
    return await sessions.recordChainExecutionResult(previousSession.id, result, now);
  } catch (error) {
    if (
      error instanceof SessionStoreError &&
      (
        error.code === "execution_result_finalized" ||
        error.code === "signed_pending_result_conflict" ||
        error.code === "invalid_session_transition"
      )
    ) {
      const current = await sessions.getReviewSession(previousSession.id, now);
      if (current) {
        return current;
      }
    }
    throw error;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled chain receipt verification result: ${String(value)}`);
}
