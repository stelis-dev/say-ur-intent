import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { validateSupportedAdapterLifecycle } from "../src/adapters/adapterLifecycleValidators.js";
import type { ActionPlan, ExecutionResult, ReviewSession, ReviewState } from "../src/core/action/types.js";
import type { SuiChainReceiptVerificationResult } from "../src/core/action/suiChainReceiptVerifier.js";
import { SqliteActivityStore } from "../src/core/activity/sqliteActivityStore.js";
import {
  CHAIN_RECEIPT_LOOKUP_MAX_AGE_MS,
  finalizePendingExecutionResultFromChain,
  getReviewSessionWithLazyChainReceiptFinalization,
  type ChainReceiptVerifier
} from "../src/core/session/chainReceiptFinalization.js";
import { LocalSessionStore, SessionStoreError, type SessionStore } from "../src/core/session/sessionStore.js";
import { chainReceiptDigest, chainReceiptFixture } from "./fixtures/chainReceipt.js";

const walletAccount = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const pendingRecordedAtMs = Date.parse("2026-06-26T00:00:00.000Z");
const sqlitePlan: ActionPlan = {
  id: "plan_1",
  actionKind: "swap",
  adapterId: "deepbook-swap",
  protocol: "DeepBookV3",
  title: "Review swap",
  summary: "Review a swap",
  assetFlowPreview: {
    outgoing: [{ symbol: "SUI", amount: "1", amountKind: "display_intent" }],
    expectedIncoming: [{ symbol: "USDC", amount: "unknown", amountKind: "display_intent", approx: true }]
  },
  adapterData: {},
  createdAt: "2026-06-26T00:00:00.000Z"
};

function reviewStateWithCommitment(transactionMaterialCommitment = chainReceiptDigest): NonNullable<ReviewSession["reviewState"]> {
  return {
    reviewSessionId: "review_1",
    planId: "plan_1",
    account: walletAccount,
    status: "ready_for_wallet_review",
    checks: [],
    updatedAt: "2026-06-26T00:00:00.000Z",
    walletReviewAdapterContract: {
      transactionMaterialCommitment
    }
  } as unknown as NonNullable<ReviewSession["reviewState"]>;
}

function pendingSession(
  overrides: Partial<ReviewSession> = {},
  executionResult: Partial<Extract<ExecutionResult, { status: "signed_pending_result" }>> = {}
): ReviewSession {
  const base = {
    id: "review_1",
    tokenHash: "hash",
    status: "signed_pending_result",
    plans: [],
    account: walletAccount,
    reviewState: reviewStateWithCommitment(),
    executionResult: {
      reviewSessionId: "review_1",
      planId: "plan_1",
      status: "signed_pending_result",
      txDigest: chainReceiptDigest,
      recordedAt: "2026-06-26T00:00:00.000Z",
      ...executionResult
    },
    createdAt: "2026-06-26T00:00:00.000Z",
    expiresAt: "2026-06-26T00:30:00.000Z",
    lastActivityAt: "2026-06-26T00:00:00.000Z",
    ...overrides
  };
  return base as unknown as ReviewSession;
}

function testSessionStore(initial: ReviewSession, options: {
  recordError?: SessionStoreError | undefined;
  currentAfterError?: ReviewSession | undefined;
} = {}) {
  let current: ReviewSession | undefined = initial;
  const recorded: ExecutionResult[] = [];
  const store = {
    async getReviewSession(id: string) {
      if (options.currentAfterError) {
        return options.currentAfterError.id === id ? options.currentAfterError : undefined;
      }
      return current?.id === id ? current : undefined;
    },
    async recordChainExecutionResult(id: string, result: ExecutionResult, now = new Date()) {
      if (options.recordError) {
        throw options.recordError;
      }
      recorded.push(result);
      if (!current || current.id !== id) {
        throw new Error("unexpected session id");
      }
      current = {
        ...current,
        status: result.status,
        executionResult: result,
        lastActivityAt: now.toISOString()
      };
      return current;
    }
  } as unknown as SessionStore;
  return { store, recorded };
}

function localSessionStoreFor(activityStore: SqliteActivityStore): LocalSessionStore {
  return new LocalSessionStore({
    activityStore,
    sessions: activityStore.createSessionRecordStore(),
    artifacts: activityStore.createPrivateReviewArtifactStore(),
    walletIdentityStore: activityStore.createWalletIdentityRecordStore(),
    settingsStore: activityStore.createSettingsRecordStore(),
    logger: { error() {} },
    validateAdapterLifecycle: validateSupportedAdapterLifecycle
  });
}

function sqliteReadyReviewState(reviewSessionId: string): ReviewState {
  return {
    planId: sqlitePlan.id,
    reviewSessionId,
    account: walletAccount,
    status: "ready_for_wallet_review",
    checks: [],
    updatedAt: "2026-06-26T00:00:04.000Z"
  };
}

async function createSignedPendingSqliteSession(
  sessions: LocalSessionStore,
  activityStore: SqliteActivityStore
): Promise<string> {
  await activityStore.setActiveAccount(walletAccount, "wallet_identity", new Date("2026-06-26T00:00:00.000Z"));
  const { session } = await sessions.createReviewSession([sqlitePlan], new Date("2026-06-26T00:00:01.000Z"));
  await sessions.recordReviewPageOpened(session.id, new Date("2026-06-26T00:00:02.000Z"));
  await sessions.recordWalletConnected(session.id, walletAccount, new Date("2026-06-26T00:00:03.000Z"));
  await sessions.recordReviewState(session.id, sqliteReadyReviewState(session.id), new Date("2026-06-26T00:00:04.000Z"));
  attachReviewedCommitment(activityStore, session.id);
  await sessions.recordExecutionResult(session.id, {
    reviewSessionId: session.id,
    planId: sqlitePlan.id,
    status: "signed_pending_result",
    txDigest: chainReceiptDigest,
    recordedAt: "2026-06-26T00:00:05.000Z"
  }, new Date("2026-06-26T00:00:05.000Z"));
  return session.id;
}

function attachReviewedCommitment(activityStore: SqliteActivityStore, sessionId: string): void {
  const sessions = activityStore.createSessionRecordStore();
  const session = sessions.get(sessionId);
  if (!session?.reviewState) {
    throw new Error("test setup expected a review state");
  }
  const committed = sessions.commitReviewSessionTransition(sessionId, session, {
    ...session,
    reviewState: {
      ...session.reviewState,
      walletReviewAdapterContract: {
        transactionMaterialCommitment: chainReceiptDigest
      }
    } as unknown as NonNullable<ReviewSession["reviewState"]>
  });
  if (!committed) {
    throw new Error("test setup failed to attach reviewed commitment");
  }
}

async function waitForLength(values: unknown[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (values.length >= expected) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${expected} verifier calls`);
}

describe("lazy chain receipt finalization", () => {
  it("does not mutate pending sessions when no verifier is configured", async () => {
    const session = pendingSession();
    const { store, recorded } = testSessionStore(session);

    await expect(
      finalizePendingExecutionResultFromChain({ sessions: store }, session)
    ).resolves.toBe(session);
    expect(recorded).toHaveLength(0);
  });

  it("records verified successful chain receipts as success", async () => {
    const session = pendingSession();
    const { store, recorded } = testSessionStore(session);
    const receipt = chainReceiptFixture();
    const verifier = vi.fn<ChainReceiptVerifier>().mockResolvedValue({
      status: "verified_success",
      receipt
    });

    const finalized = await finalizePendingExecutionResultFromChain({
      sessions: store,
      chainReceiptVerifier: verifier
    }, session, new Date("2026-06-26T00:00:05.000Z"));

    expect(verifier).toHaveBeenCalledWith({
      txDigest: chainReceiptDigest,
      reviewedTransactionDigest: chainReceiptDigest,
      account: walletAccount,
      now: new Date("2026-06-26T00:00:05.000Z")
    });
    expect(recorded).toEqual([
      expect.objectContaining({
        status: "success",
        txDigest: chainReceiptDigest,
        chainReceipt: receipt
      })
    ]);
    expect(finalized.status).toBe("success");
  });

  it("records verified failed effects as chain execution failure with receipt", async () => {
    const session = pendingSession();
    const { store, recorded } = testSessionStore(session);
    const receipt = chainReceiptFixture({ effectsStatus: { success: false, errorMessage: "Move abort" } });
    const verifier = vi.fn<ChainReceiptVerifier>().mockResolvedValue({
      status: "verified_failure",
      failureReason: "chain_execution_failed",
      message: "failed effects",
      receipt
    });

    await finalizePendingExecutionResultFromChain({ sessions: store, chainReceiptVerifier: verifier }, session);

    expect(recorded).toEqual([
      expect.objectContaining({
        status: "failure",
        failureReason: "chain_execution_failed",
        txDigest: chainReceiptDigest,
        chainReceipt: receipt
      })
    ]);
  });

  it("records verifier failures as receipt verification failure", async () => {
    const session = pendingSession();
    const { store, recorded } = testSessionStore(session);
    const verifier = vi.fn<ChainReceiptVerifier>().mockResolvedValue({
      status: "verification_failed",
      failureReason: "receipt_verification_failed",
      message: "sender mismatch"
    });

    await finalizePendingExecutionResultFromChain({ sessions: store, chainReceiptVerifier: verifier }, session);

    expect(recorded).toEqual([
      expect.objectContaining({
        status: "failure",
        failureReason: "receipt_verification_failed",
        txDigest: chainReceiptDigest
      })
    ]);
  });

  it("keeps not-found pending before the receipt lookup max age", async () => {
    const session = pendingSession();
    const { store, recorded } = testSessionStore(session);
    const verifier = vi.fn<ChainReceiptVerifier>().mockResolvedValue({
      status: "not_found",
      failureReason: "chain_receipt_unavailable",
      message: "not indexed"
    });

    const result = await finalizePendingExecutionResultFromChain({
      sessions: store,
      chainReceiptVerifier: verifier
    }, session, new Date(pendingRecordedAtMs + CHAIN_RECEIPT_LOOKUP_MAX_AGE_MS - 1));

    expect(result).toBe(session);
    expect(recorded).toHaveLength(0);
  });

  it("records receipt availability failure after the lookup max age", async () => {
    const session = pendingSession();
    const { store, recorded } = testSessionStore(session);
    const verifier = vi.fn<ChainReceiptVerifier>().mockResolvedValue({
      status: "not_found",
      failureReason: "chain_receipt_unavailable",
      message: "not indexed"
    });

    await finalizePendingExecutionResultFromChain({
      sessions: store,
      chainReceiptVerifier: verifier
    }, session, new Date(pendingRecordedAtMs + CHAIN_RECEIPT_LOOKUP_MAX_AGE_MS));

    expect(recorded).toEqual([
      expect.objectContaining({
        status: "failure",
        failureReason: "chain_receipt_unavailable",
        txDigest: chainReceiptDigest
      })
    ]);
  });

  it("fails closed when pending session lacks a reviewed commitment", async () => {
    const session = pendingSession({
      reviewState: {
        reviewSessionId: "review_1",
        planId: "plan_1",
        account: walletAccount,
        status: "ready_for_wallet_review",
        checks: [],
        updatedAt: "2026-06-26T00:00:00.000Z"
      } as unknown as NonNullable<ReviewSession["reviewState"]>
    });
    const { store, recorded } = testSessionStore(session);
    const verifier = vi.fn<ChainReceiptVerifier>();

    await finalizePendingExecutionResultFromChain({ sessions: store, chainReceiptVerifier: verifier }, session);

    expect(verifier).not.toHaveBeenCalled();
    expect(recorded).toEqual([
      expect.objectContaining({
        status: "failure",
        failureReason: "receipt_verification_failed",
        txDigest: chainReceiptDigest
      })
    ]);
  });

  it("returns the already-final state when another process finalizes first", async () => {
    const session = pendingSession();
    const finalized = pendingSession({
      status: "success",
      executionResult: {
        reviewSessionId: "review_1",
        planId: "plan_1",
        status: "success",
        txDigest: chainReceiptDigest,
        chainReceipt: chainReceiptFixture(),
        recordedAt: "2026-06-26T00:00:01.000Z"
      }
    });
    const { store } = testSessionStore(session, {
      recordError: new SessionStoreError("execution_result_finalized", "already finalized"),
      currentAfterError: finalized
    });
    const verifier = vi.fn<ChainReceiptVerifier>().mockResolvedValue({
      status: "verified_success",
      receipt: chainReceiptFixture()
    });

    await expect(
      finalizePendingExecutionResultFromChain({ sessions: store, chainReceiptVerifier: verifier }, session)
    ).resolves.toBe(finalized);
  });

  it("uses lazy finalization from review-session reads", async () => {
    const session = pendingSession();
    const { store } = testSessionStore(session);
    const verifier = vi.fn<ChainReceiptVerifier>().mockResolvedValue({
      status: "verified_success",
      receipt: chainReceiptFixture()
    });

    await expect(
      getReviewSessionWithLazyChainReceiptFinalization({
        sessions: store,
        chainReceiptVerifier: verifier
      }, session.id)
    ).resolves.toMatchObject({
      status: "success",
      executionResult: { status: "success" }
    });
  });

  it("finalizes a shared SQLite pending receipt once when two processes race", async () => {
    const dir = mkdtempSync(join(tmpdir(), "say-ur-intent-chain-receipt-finalization-"));
    const databasePath = join(dir, "say-ur-intent.sqlite");
    const firstActivityStore = new SqliteActivityStore({ databasePath, validateAdapterLifecycle: validateSupportedAdapterLifecycle });
    const secondActivityStore = new SqliteActivityStore({ databasePath, validateAdapterLifecycle: validateSupportedAdapterLifecycle });
    const observerDb = new Database(databasePath);

    try {
      const firstSessions = localSessionStoreFor(firstActivityStore);
      const secondSessions = localSessionStoreFor(secondActivityStore);
      const sessionId = await createSignedPendingSqliteSession(firstSessions, firstActivityStore);
      const pendingReadAt = new Date("2026-06-26T00:00:05.500Z");
      const firstPending = await firstSessions.getReviewSession(sessionId, pendingReadAt);
      const secondPending = await secondSessions.getReviewSession(sessionId, pendingReadAt);
      if (!firstPending || !secondPending) {
        throw new Error("test setup expected both stores to read the pending session");
      }
      expect(firstPending.status).toBe("signed_pending_result");
      expect(secondPending.status).toBe("signed_pending_result");

      const verifierResolvers: Array<(result: SuiChainReceiptVerificationResult) => void> = [];
      const verifier = vi.fn<ChainReceiptVerifier>().mockImplementation(
        () => new Promise((resolve) => {
          verifierResolvers.push(resolve);
        })
      );
      const now = new Date("2026-06-26T00:00:06.000Z");

      const firstFinalization = finalizePendingExecutionResultFromChain({
        sessions: firstSessions,
        chainReceiptVerifier: verifier
      }, firstPending, now);
      const secondFinalization = finalizePendingExecutionResultFromChain({
        sessions: secondSessions,
        chainReceiptVerifier: verifier
      }, secondPending, now);

      await waitForLength(verifierResolvers, 2);
      verifierResolvers.forEach((resolve) => {
        resolve({
          status: "verified_success",
          receipt: chainReceiptFixture()
        });
      });

      const [firstFinal, secondFinal] = await Promise.all([firstFinalization, secondFinalization]);
      expect(firstFinal.status).toBe("success");
      expect(secondFinal.status).toBe("success");
      expect(firstFinal.executionResult).toMatchObject({ status: "success", txDigest: chainReceiptDigest });
      expect(secondFinal.executionResult).toMatchObject({ status: "success", txDigest: chainReceiptDigest });

      const verifierCallCountAfterRace = verifier.mock.calls.length;
      const finalRead = await getReviewSessionWithLazyChainReceiptFinalization({
        sessions: firstSessions,
        chainReceiptVerifier: verifier
      }, sessionId, new Date("2026-06-26T00:00:07.000Z"));
      expect(finalRead?.status).toBe("success");
      expect(verifier).toHaveBeenCalledTimes(verifierCallCountAfterRace);

      const liveRow = observerDb
        .prepare("SELECT status, execution_result_json FROM live_review_sessions WHERE id = ?")
        .get(sessionId) as { status: string; execution_result_json: string } | undefined;
      expect(liveRow?.status).toBe("success");
      expect(JSON.parse(liveRow?.execution_result_json ?? "{}")).toMatchObject({
        status: "success",
        txDigest: chainReceiptDigest
      });
      const executionRows = observerDb
        .prepare("SELECT status, tx_digest FROM review_executions WHERE review_session_id = ?")
        .all(sessionId);
      expect(executionRows).toEqual([{ status: "success", tx_digest: chainReceiptDigest }]);
      const transitionRow = observerDb
        .prepare(
          "SELECT COUNT(*) AS count FROM review_status_transitions WHERE review_session_id = ? AND event = 'result_recorded' AND to_status = 'success'"
        )
        .get(sessionId) as { count: number };
      expect(transitionRow.count).toBe(1);
    } finally {
      observerDb.close();
      firstActivityStore.close();
      secondActivityStore.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
