import type { ExecutionPollingStatus } from "./status.js";
import {
  EXECUTION_POLLING_INTERVAL_SECONDS,
  getExecutionPollingStatus,
  isWaitStoppingExecutionStatus
} from "./status.js";
import type { ReviewSession } from "../action/types.js";
import { SessionStoreError, type SessionStore } from "./sessionStore.js";
import {
  isTerminalWalletIdentityStatus,
  WALLET_IDENTITY_POLLING_INTERVAL_SECONDS,
  type WalletIdentitySession,
  type WalletIdentityStatus
} from "./walletIdentity.js";

export const DEFAULT_WAIT_TIMEOUT_MS = 45_000;
export const MAX_WAIT_TIMEOUT_MS = 55_000;

export type WaitOutcome = "status_reached" | "timed_out";
export type WalletStatusCategory = "terminal" | "non_terminal";
export type WaitSessionMissingReason = "missing" | "session_removed_during_wait";
export type WaitAbortReason = "host_abort";

export class WaitRequestAbortedError extends Error {
  constructor(readonly reason: WaitAbortReason = "host_abort") {
    super("Wait request aborted");
  }
}

export type WalletIdentityWaitResult = {
  waitOutcome: WaitOutcome;
  session: WalletIdentitySession;
  statusCategory: WalletStatusCategory;
};

export type ExecutionWaitResult = {
  waitOutcome: WaitOutcome;
  session: ReviewSession;
  status: ExecutionPollingStatus;
};

type WaitOptions = {
  timeoutMs?: number | undefined;
  signal?: AbortSignal;
  now?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readReviewSession?: (
    reviewSessionId: string,
    now?: Date
  ) => Promise<ReviewSession | undefined>;
};

export async function waitForWalletIdentitySession(
  sessions: SessionStore,
  walletSessionId: string,
  options: WaitOptions = {}
): Promise<WalletIdentityWaitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const sleep = options.sleep ?? sleepMs;
  const startedAt = Date.now();

  assertNotAborted(options.signal);
  let session = await getRequiredWalletIdentitySession(sessions, walletSessionId, options.now, "missing");
  if (isTerminalWalletIdentityStatus(session.status)) {
    return walletWaitResult("status_reached", session);
  }

  while (Date.now() - startedAt < timeoutMs) {
    assertNotAborted(options.signal);
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    await sleep(Math.min(remainingMs, WALLET_IDENTITY_POLLING_INTERVAL_SECONDS * 1000), options.signal);
    session = await getRequiredWalletIdentitySession(
      sessions,
      walletSessionId,
      options.now,
      "session_removed_during_wait"
    );
    if (isTerminalWalletIdentityStatus(session.status)) {
      return walletWaitResult("status_reached", session);
    }
  }

  return walletWaitResult("timed_out", session);
}

export async function waitForExecutionResult(
  sessions: SessionStore,
  reviewSessionId: string,
  options: WaitOptions = {}
): Promise<ExecutionWaitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const sleep = options.sleep ?? sleepMs;
  const startedAt = Date.now();

  assertNotAborted(options.signal);
  let session = await getRequiredReviewSession(sessions, reviewSessionId, options.now, "missing", options.readReviewSession);
  let status = getExecutionPollingStatus(session);
  if (isWaitStoppingExecutionStatus(status)) {
    return { waitOutcome: "status_reached", session, status };
  }

  while (Date.now() - startedAt < timeoutMs) {
    assertNotAborted(options.signal);
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    await sleep(Math.min(remainingMs, EXECUTION_POLLING_INTERVAL_SECONDS * 1000), options.signal);
    session = await getRequiredReviewSession(
      sessions,
      reviewSessionId,
      options.now,
      "session_removed_during_wait",
      options.readReviewSession
    );
    status = getExecutionPollingStatus(session);
    if (isWaitStoppingExecutionStatus(status)) {
      return { waitOutcome: "status_reached", session, status };
    }
  }

  return { waitOutcome: "timed_out", session, status };
}

export function walletStatusCategory(status: WalletIdentityStatus): WalletStatusCategory {
  return isTerminalWalletIdentityStatus(status) ? "terminal" : "non_terminal";
}

function walletWaitResult(waitOutcome: WaitOutcome, session: WalletIdentitySession): WalletIdentityWaitResult {
  return {
    waitOutcome,
    session,
    statusCategory: walletStatusCategory(session.status)
  };
}

async function getRequiredWalletIdentitySession(
  sessions: SessionStore,
  walletSessionId: string,
  now: (() => Date) | undefined,
  reason: WaitSessionMissingReason
): Promise<WalletIdentitySession> {
  const session = await sessions.getWalletIdentitySession(walletSessionId, now?.());
  if (!session) {
    throw new SessionStoreError("session_not_found", `Wallet identity session not found: ${walletSessionId}`, {
      reason
    });
  }
  return session;
}

async function getRequiredReviewSession(
  sessions: SessionStore,
  reviewSessionId: string,
  now: (() => Date) | undefined,
  reason: WaitSessionMissingReason,
  readReviewSession?: (reviewSessionId: string, now?: Date) => Promise<ReviewSession | undefined>
): Promise<ReviewSession> {
  const at = now?.();
  const session = await (readReviewSession
    ? readReviewSession(reviewSessionId, at)
    : sessions.getReviewSession(reviewSessionId, at));
  if (!session) {
    throw new SessionStoreError("session_not_found", `Review session not found: ${reviewSessionId}`, { reason });
  }
  return session;
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new WaitRequestAbortedError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new WaitRequestAbortedError());
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new WaitRequestAbortedError();
  }
}
