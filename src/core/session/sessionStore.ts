import { isDeepStrictEqual } from "node:util";
import type {
  ActionPlan,
  ExecutionResult,
  InternalSessionStatus,
  ReviewSession,
  ReviewState
} from "../action/types.js";
import type { ActivityStore } from "../activity/activityStore.js";
import { executionResultSchema } from "../action/schemas.js";
import type { AdapterLifecycleValidator } from "../action/adapterLifecycleValidation.js";
import { parseLifecycleValidatedReviewState } from "../action/reviewStateValidation.js";
import type { EventLogRecord, EventLogSink } from "../eventlog/sink.js";
import { hashEventValue, NullEventLogSink } from "../eventlog/sink.js";
import {
  LocalTransactionMaterialStoreError,
  verifyLocalTransactionMaterialArtifacts,
  type LocalTransactionMaterialStore
} from "./transactionMaterialStore.js";
import {
  verifyTransactionObjectOwnershipEvidence
} from "../action/transactionObjectOwnershipEvidence.js";
import {
  verifySwapQuotePolicyEvidence
} from "../action/swapQuotePolicyEvidence.js";
import {
  publicHumanReadableReviewFromEvidence
} from "../action/humanReadableReviewEvidence.js";
import {
  publicTransactionSimulationSummaryFromEvidence,
  verifyReviewTimeSimulationEvidence
} from "../action/reviewTimeSimulationEvidence.js";
import {
  verifySupportedHumanReadableReviewEvidence
} from "../action/humanReadableReviewProjectionVerifier.js";
import {
  InMemoryPrivateReviewArtifactStore,
  type PrivateReviewArtifacts
} from "./privateReviewArtifacts.js";
import { isFinalSessionStatus } from "./status.js";
import { parseSuiAddress } from "../suiAddress.js";
import {
  cloneLocalSession,
  createLocalSessionBase,
  DEFAULT_SESSION_TTL_MS,
  isLocalSessionExpired,
  tokenMatchesHash
} from "./localSession.js";
import {
  isTerminalWalletIdentityStatus,
  walletIdentityResultInputSchema,
  walletIdentitySessionSchema,
  type WalletIdentityResultInput,
  type WalletIdentitySession,
  type WalletIdentityStatus
} from "./walletIdentity.js";
import type { SettingsSession } from "./settingsSession.js";
import { SessionStoreError } from "./sessionErrors.js";
import { SettingsSessionManager } from "./settingsSessions.js";
import {
  transitionWalletIdentity,
  WalletIdentitySessionManager
} from "./walletIdentitySessions.js";

export { transitionWalletIdentity };

type PrivateDerivedReviewFieldBinding = {
  field: "humanReadableReview" | "simulation";
  getPublicState: (state: ReviewState) => unknown | undefined;
  getPrivateEvidence: (artifacts: PrivateReviewArtifacts) => unknown | undefined;
  projectPrivateEvidence: (evidence: unknown) => unknown;
};

const PRIVATE_DERIVED_REVIEW_FIELD_BINDINGS: readonly PrivateDerivedReviewFieldBinding[] = [
  {
    field: "humanReadableReview",
    getPublicState: (state) => state.humanReadableReview,
    getPrivateEvidence: (artifacts) => artifacts.humanReadableReview,
    projectPrivateEvidence: (evidence) =>
      publicHumanReadableReviewFromEvidence(evidence as NonNullable<PrivateReviewArtifacts["humanReadableReview"]>)
  },
  {
    field: "simulation",
    getPublicState: (state) => state.simulation,
    getPrivateEvidence: (artifacts) => artifacts.reviewTimeSimulation,
    projectPrivateEvidence: (evidence) =>
      publicTransactionSimulationSummaryFromEvidence(
        evidence as NonNullable<PrivateReviewArtifacts["reviewTimeSimulation"]>
      )
  }
];

export type CreatedReviewSession = {
  session: ReviewSession;
  token: string;
};

export type CreatedWalletIdentitySession = {
  session: WalletIdentitySession;
  token: string;
};

export type WalletHandoffMaterial = {
  transactionBytesBase64: string;
  transactionMaterialCommitment: string;
  planId: string;
  account: string;
};

export type CreatedSettingsSession = {
  session: SettingsSession;
  token: string;
};

export interface SessionStore {
  createReviewSession(plans: ActionPlan[], now?: Date): Promise<CreatedReviewSession>;
  getReviewSession(id: string, now?: Date): Promise<ReviewSession | undefined>;
  listReviewSessions(now?: Date): Promise<ReviewSession[]>;
  validateReviewToken(id: string, token: string, now?: Date): Promise<boolean>;
  recordReviewPageOpened(id: string, now?: Date): Promise<ReviewSession>;
  recordWalletConnected(id: string, account: string, now?: Date): Promise<ReviewSession>;
  recordReviewState(id: string, state: ReviewState, now?: Date): Promise<ReviewSession>;
  recordReviewStateWithArtifacts(
    id: string,
    state: ReviewState,
    privateArtifacts: PrivateReviewArtifacts | undefined,
    now?: Date
  ): Promise<ReviewSession>;
  getReviewSessionPrivateArtifacts(
    id: string,
    now?: Date
  ): Promise<PrivateReviewArtifacts | undefined>;
  recordExecutionResult(id: string, result: ExecutionResult, now?: Date): Promise<ReviewSession>;
  createWalletIdentitySession(now?: Date): Promise<CreatedWalletIdentitySession>;
  getWalletIdentitySession(id: string, now?: Date): Promise<WalletIdentitySession | undefined>;
  listWalletIdentitySessions(now?: Date): Promise<WalletIdentitySession[]>;
  validateWalletIdentityToken(id: string, token: string, now?: Date): Promise<boolean>;
  recordWalletIdentityOpened(id: string, now?: Date): Promise<WalletIdentitySession>;
  recordWalletIdentityConnecting(id: string, now?: Date): Promise<WalletIdentitySession>;
  recordWalletIdentityResult(
    id: string,
    result: WalletIdentityResultInput,
    now?: Date
  ): Promise<WalletIdentitySession>;
  prepareWalletHandoff(
    id: string,
    planId: string,
    account: string,
    now?: Date
  ): Promise<WalletHandoffMaterial>;
  cancelWalletHandoff(id: string, now?: Date): Promise<ReviewSession>;
  createSettingsSession(now?: Date): Promise<CreatedSettingsSession>;
  getSettingsSession(id: string, now?: Date): Promise<SettingsSession | undefined>;
  validateSettingsToken(id: string, token: string, now?: Date): Promise<boolean>;
  invalidateAllLocalSessions(reason: string, now?: Date): Promise<void>;
}

export type InMemorySessionStoreOptions = {
  ttlMs?: number;
  eventLog?: EventLogSink;
  activityStore: ActivityStore;
  transactionMaterialStore?: Pick<
    LocalTransactionMaterialStore,
    "deleteReviewSessionTransactionMaterials" | "getTransactionMaterial"
  >;
  logger: {
    error(message: string, meta?: Record<string, unknown>): void;
  };
  validateAdapterLifecycle: AdapterLifecycleValidator;
};

export { SessionStoreError } from "./sessionErrors.js";
export type { SessionStoreErrorCode } from "./sessionErrors.js";

const REVIEW_STATE_RECOMPUTE_STATUSES = new Set<InternalSessionStatus>([
  "wallet_connected",
  "ready_for_wallet_review",
  "refresh_required",
  "blocked"
]);

function canRetainPrivateReviewArtifacts(status: InternalSessionStatus): boolean {
  return status !== "signed_pending_result" && !isFinalSessionStatus(status);
}

const ALLOWED_TRANSITIONS: Record<InternalSessionStatus, InternalSessionStatus[]> = {
  proposed: ["awaiting_wallet", "expired"],
  awaiting_wallet: ["wallet_connected", "expired"],
  wallet_connected: ["ready_for_wallet_review", "refresh_required", "blocked", "expired"],
  ready_for_wallet_review: ["signed_pending_result", "refresh_required", "blocked", "expired"],
  refresh_required: ["ready_for_wallet_review", "blocked", "expired"],
  blocked: ["refresh_required", "expired"],
  signed_pending_result: ["success", "failure", "expired"],
  success: [],
  failure: [],
  expired: []
};

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, ReviewSession>();
  private readonly privateReviewArtifacts = new InMemoryPrivateReviewArtifactStore();
  private readonly walletIdentity: WalletIdentitySessionManager;
  private readonly settings: SettingsSessionManager;
  private readonly ttlMs: number;
  private readonly eventLog: EventLogSink;
  private readonly activityStore: ActivityStore;
  private readonly transactionMaterialStore: Pick<
    LocalTransactionMaterialStore,
    "deleteReviewSessionTransactionMaterials" | "getTransactionMaterial"
  > | undefined;
  private readonly logger: InMemorySessionStoreOptions["logger"];
  private readonly validateAdapterLifecycle: InMemorySessionStoreOptions["validateAdapterLifecycle"];

  constructor(options: InMemorySessionStoreOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.walletIdentity = new WalletIdentitySessionManager({
      ttlMs: this.ttlMs,
      appendEventLog: (record) => this.appendEventLog(record),
      setActiveAccount: async (account, now, wallet) => {
        await this.activityStore.setActiveAccount(account, "wallet_identity", now, wallet);
      }
    });
    this.settings = new SettingsSessionManager({
      ttlMs: this.ttlMs,
      appendEventLog: (record) => this.appendEventLog(record)
    });
    this.eventLog = options.eventLog ?? new NullEventLogSink();
    this.activityStore = options.activityStore;
    this.transactionMaterialStore = options.transactionMaterialStore;
    this.logger = options.logger;
    this.validateAdapterLifecycle = options.validateAdapterLifecycle;
  }

  async createReviewSession(plans: ActionPlan[], now = new Date()): Promise<CreatedReviewSession> {
    if (plans.length !== 1) {
      throw new SessionStoreError("input_invalid", "Exactly one action plan is required per review session");
    }

    const { base, token } = createLocalSessionBase(now, this.ttlMs);
    const session: ReviewSession = {
      ...base,
      status: "proposed",
      plans
    };

    await this.activityStore.recordReviewSession({
      reviewSessionId: session.id,
      plan: plans[0]!,
      currentStatus: session.status,
      createdAt: session.createdAt
    });
    this.sessions.set(session.id, session);
    await this.appendEventLog({
      type: "session.created",
      sessionId: session.id,
      at: now.toISOString()
    });

    return { session: cloneLocalSession(session), token };
  }

  async getReviewSession(id: string, now = new Date()): Promise<ReviewSession | undefined> {
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }

    if (isLocalSessionExpired(session, now) && !isFinalSessionStatus(session.status)) {
      return cloneLocalSession(await this.expireReviewSession(id, session, now));
    }

    return cloneLocalSession(await this.sanitizePrivateDerivedReviewState(id, session, now));
  }

  async listReviewSessions(now = new Date()): Promise<ReviewSession[]> {
    const sessions: ReviewSession[] = [];
    for (const id of this.sessions.keys()) {
      const session = await this.getReviewSession(id, now);
      if (session) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  async validateReviewToken(id: string, token: string, _now = new Date()): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    // Review sessions expose expired/final lifecycle states through read APIs after token validation.
    // Mutable methods own expiry transitions and return lifecycle-specific errors.
    return tokenMatchesHash(session.tokenHash, token);
  }

  async recordReviewPageOpened(id: string, now = new Date()): Promise<ReviewSession> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new SessionStoreError("session_not_found", `Review session not found: ${id}`);
    }

    if (isLocalSessionExpired(session, now) && !isFinalSessionStatus(session.status)) {
      return cloneLocalSession(await this.expireReviewSession(id, session, now));
    }

    if (session.status === "success" || session.status === "failure" || session.status === "expired") {
      return cloneLocalSession(session);
    }

    const nextSession = cloneLocalSession(session);
    if (nextSession.status === "proposed") {
      transition(nextSession, "awaiting_wallet");
    }
    nextSession.lastActivityAt = now.toISOString();
    await this.activityStore.recordReviewTransition({
      reviewSessionId: id,
      event: "opened",
      fromStatus: session.status,
      toStatus: nextSession.status,
      transitionedAt: now.toISOString()
    });
    this.sessions.set(id, nextSession);
    await this.appendEventLog({
      type: "review.opened",
      sessionId: id,
      status: nextSession.status,
      at: now.toISOString()
    });
    return cloneLocalSession(nextSession);
  }

  async recordWalletConnected(id: string, account: string, now = new Date()): Promise<ReviewSession> {
    const session = await this.requireMutableSession(id, now);
    const normalizedAccount = parseSuiAddress(account);
    if (!normalizedAccount) {
      throw new SessionStoreError("input_invalid", "Invalid wallet account address");
    }
    const activeAccount = await this.activityStore.getActiveAccount();
    if (!activeAccount) {
      throw new SessionStoreError(
        "active_account_not_set",
        "Review account binding requires an active wallet identity account"
      );
    }
    if (activeAccount.address !== normalizedAccount) {
      throw new SessionStoreError(
        "invalid_session_transition",
        `Review account does not match active wallet identity account: ${id}`
      );
    }
    const nextSession = cloneLocalSession(session);
    if (session.account && session.account !== normalizedAccount) {
      throw new SessionStoreError(
        "invalid_session_transition",
        `Review session already bound to a different account: ${id}`
      );
    }
    if (nextSession.status === "awaiting_wallet") {
      transition(nextSession, "wallet_connected");
    } else if (!REVIEW_STATE_RECOMPUTE_STATUSES.has(nextSession.status)) {
      throw new SessionStoreError(
        "invalid_session_transition",
        `Invalid session transition: ${nextSession.status} -> wallet_connected`
      );
    }
    nextSession.account = normalizedAccount;
    nextSession.lastActivityAt = now.toISOString();
    await this.activityStore.recordReviewTransition({
      reviewSessionId: id,
      event: "wallet_connected",
      fromStatus: session.status,
      toStatus: nextSession.status,
      account: normalizedAccount,
      transitionedAt: now.toISOString()
    });
    this.sessions.set(id, nextSession);
    await this.appendEventLog({
      type: "wallet.connected",
      sessionId: id,
      walletAddressHash: hashEventValue(normalizedAccount),
      at: now.toISOString()
    });
    return cloneLocalSession(nextSession);
  }

  async recordReviewState(id: string, state: ReviewState, now = new Date()): Promise<ReviewSession> {
    return this.recordReviewStateInternal(id, state, undefined, now);
  }

  async recordReviewStateWithArtifacts(
    id: string,
    state: ReviewState,
    privateArtifacts: PrivateReviewArtifacts | undefined,
    now = new Date()
  ): Promise<ReviewSession> {
    const pendingSession = this.sessions.get(id);
    if (pendingSession?.pendingHandoffDigest) {
      if (await this.pendingHandoffMaterialAvailable(id, now)) {
        throw new SessionStoreError(
          "invalid_session_transition",
          "Signing is in progress for this review session; record the wallet result or cancel signing before recomputing"
        );
      }
      // The handed-off material expired without a recorded result; release the
      // lock so the session can recompute instead of being stuck.
      await this.clearPendingHandoff(id, "material_expired", now);
    }
    return this.recordReviewStateInternal(id, state, privateArtifacts, now);
  }

  async getReviewSessionPrivateArtifacts(
    id: string,
    now = new Date()
  ): Promise<PrivateReviewArtifacts | undefined> {
    const session = await this.getReviewSession(id, now);
    if (!session) {
      return undefined;
    }
    if (!canRetainPrivateReviewArtifacts(session.status)) {
      this.deleteReviewSessionTransactionMaterials(id);
      return undefined;
    }
    const artifacts = this.privateReviewArtifacts.get(id);
    if (!artifacts) {
      return undefined;
    }
    if (!session.reviewState) {
      this.deleteReviewSessionTransactionMaterials(id);
      return undefined;
    }
    try {
      return await this.parseReviewSessionPrivateArtifacts(id, session.reviewState, artifacts, now);
    } catch (error) {
      this.logger.error("private review artifact verification failed", {
        reviewSessionId: id,
        error: error instanceof Error ? error.message : String(error)
      });
      this.deleteReviewSessionTransactionMaterials(id);
      return undefined;
    }
  }

  private async recordReviewStateInternal(
    id: string,
    state: ReviewState,
    privateArtifacts: PrivateReviewArtifacts | undefined,
    now: Date
  ): Promise<ReviewSession> {
    const session = await this.requireMutableSession(id, now);
    assertSameSessionId(id, state.reviewSessionId, "Review state");
    assertPlanInSession(session, state.planId);
    const parsedState = parseReviewState(state, this.validateAdapterLifecycle);
    if (!session.account) {
      throw new SessionStoreError(
        "invalid_session_transition",
        `Review state requires a wallet-connected account: ${id}`
      );
    }
    if (session.account !== parsedState.account) {
      throw new SessionStoreError(
        "invalid_session_transition",
        `Review state account does not match the review session account: ${id}`
      );
    }
    await this.assertReviewSessionPrivateArtifacts(id, parsedState, privateArtifacts, now);
    const nextSession = cloneLocalSession(session);
    transition(nextSession, parsedState.status);
    nextSession.account = session.account;
    nextSession.reviewState = parsedState;
    nextSession.lastActivityAt = now.toISOString();
    try {
      await this.activityStore.recordReviewStateSnapshot({
        reviewSessionId: id,
        fromStatus: session.status,
        state: parsedState,
        recordedAt: now.toISOString()
      });
      this.sessions.set(id, nextSession);
      await this.appendEventLog({
        type: "state.computed",
        sessionId: id,
        planId: parsedState.planId,
        walletAddressHash: hashEventValue(parsedState.account),
        status: parsedState.status,
        at: now.toISOString()
      });
      this.replaceReviewSessionPrivateArtifacts(id, privateArtifacts);
      return cloneLocalSession(nextSession);
    } catch (error) {
      if (privateArtifacts) {
        this.deleteReviewSessionTransactionMaterials(id);
      }
      throw error;
    }
  }

  async recordExecutionResult(
    id: string,
    result: ExecutionResult,
    now = new Date()
  ): Promise<ReviewSession> {
    const session = await this.requireMutableSession(id, now);
    assertSameSessionId(id, result.reviewSessionId, "Execution result");
    assertPlanInSession(session, result.planId);
    const parsedResult = parseExecutionResult(result, session.executionResult);
    if (session.executionResult?.status === "success" || session.executionResult?.status === "failure") {
      this.deleteReviewSessionTransactionMaterials(id);
      throw new SessionStoreError(
        "execution_result_finalized",
        `Execution result already finalized: ${id}`
      );
    }
    if (
      session.executionResult?.status === "signed_pending_result" &&
      parsedResult.status === "signed_pending_result"
    ) {
      if (
        session.executionResult.planId !== parsedResult.planId ||
        session.executionResult.txDigest !== parsedResult.txDigest
      ) {
        this.deleteReviewSessionTransactionMaterials(id);
        throw new SessionStoreError(
          "signed_pending_result_conflict",
          `Signed pending result already recorded: ${id}`
        );
      }
      this.deleteReviewSessionTransactionMaterials(id);
      return cloneLocalSession(session);
    }
    if (
      session.executionResult?.status === "signed_pending_result" &&
      parsedResult.status !== "signed_pending_result" &&
      session.executionResult.txDigest !== parsedResult.txDigest
    ) {
      this.deleteReviewSessionTransactionMaterials(id);
      throw new SessionStoreError(
        "signed_pending_result_conflict",
        `Execution result digest does not match signed pending result: ${id}`
      );
    }
    const nextSession = cloneLocalSession(session);
    transition(nextSession, parsedResult.status);
    const reviewAccount = session.account;
    if (!reviewAccount || session.reviewState?.account !== reviewAccount) {
      throw new SessionStoreError(
        "invalid_session_transition",
        `Execution result requires account-bound review state: ${id}`
      );
    }
    nextSession.account = reviewAccount;
    nextSession.executionResult = parsedResult;
    // The outstanding handoff is settled by this recorded result.
    delete nextSession.pendingHandoffDigest;
    nextSession.lastActivityAt = now.toISOString();
    try {
      await this.activityStore.recordReviewExecution({
        reviewSessionId: parsedResult.reviewSessionId,
        planId: parsedResult.planId,
        account: reviewAccount,
        fromStatus: session.status,
        status: parsedResult.status,
        txDigest: parsedResult.txDigest,
        explorerUrl: parsedResult.explorerUrl,
        failureReason: "failureReason" in parsedResult ? parsedResult.failureReason : undefined,
        result: parsedResult,
        recordedAt: parsedResult.recordedAt
      });
      this.sessions.set(id, nextSession);
      this.deleteReviewSessionTransactionMaterials(id);
      const event = {
        type: "result.recorded",
        sessionId: id,
        planId: parsedResult.planId,
        status: parsedResult.status,
        at: now.toISOString()
      } as const;
      await this.appendEventLog(parsedResult.txDigest ? { ...event, txDigest: parsedResult.txDigest } : event);
      return cloneLocalSession(nextSession);
    } catch (error) {
      this.deleteReviewSessionTransactionMaterials(id);
      throw error;
    }
  }

  private async requireMutableSession(id: string, now: Date): Promise<ReviewSession> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new SessionStoreError("session_not_found", `Review session not found: ${id}`);
    }
    if (isLocalSessionExpired(session, now) && !isFinalSessionStatus(session.status)) {
      await this.expireReviewSession(id, session, now);
      throw new SessionStoreError("session_expired", `Review session expired: ${id}`);
    }
    if (session.status === "expired") {
      throw new SessionStoreError("session_expired", `Review session expired: ${id}`);
    }
    return session;
  }

  async createWalletIdentitySession(now = new Date()): Promise<CreatedWalletIdentitySession> {
    return this.walletIdentity.create(now);
  }

  async getWalletIdentitySession(
    id: string,
    now = new Date()
  ): Promise<WalletIdentitySession | undefined> {
    return this.walletIdentity.get(id, now);
  }

  async listWalletIdentitySessions(now = new Date()): Promise<WalletIdentitySession[]> {
    return this.walletIdentity.list(now);
  }

  async validateWalletIdentityToken(id: string, token: string, _now = new Date()): Promise<boolean> {
    return this.walletIdentity.validateToken(id, token);
  }

  async recordWalletIdentityOpened(id: string, now = new Date()): Promise<WalletIdentitySession> {
    return this.walletIdentity.recordOpened(id, now);
  }

  async recordWalletIdentityConnecting(id: string, now = new Date()): Promise<WalletIdentitySession> {
    return this.walletIdentity.recordConnecting(id, now);
  }

  async recordWalletIdentityResult(
    id: string,
    result: WalletIdentityResultInput,
    now = new Date()
  ): Promise<WalletIdentitySession> {
    return this.walletIdentity.recordResult(id, result, now);
  }

  async createSettingsSession(now = new Date()): Promise<CreatedSettingsSession> {
    return this.settings.create(now);
  }

  async getSettingsSession(id: string, now = new Date()): Promise<SettingsSession | undefined> {
    return this.settings.get(id, now);
  }

  async validateSettingsToken(id: string, token: string, now = new Date()): Promise<boolean> {
    return this.settings.validateToken(id, token, now);
  }

  async prepareWalletHandoff(
    id: string,
    planId: string,
    account: string,
    now = new Date()
  ): Promise<WalletHandoffMaterial> {
    const session = await this.requireMutableSession(id, now);
    assertPlanInSession(session, planId);
    try {
      return await this.gateWalletHandoff(id, session, planId, account, now);
    } catch (error) {
      if (error instanceof SessionStoreError) {
        await this.appendEventLog({
          type: "handoff.refused",
          sessionId: id,
          planId,
          reason: error.code,
          at: now.toISOString()
        });
      }
      throw error;
    }
  }

  private async pendingHandoffMaterialAvailable(id: string, now: Date): Promise<boolean> {
    if (!this.transactionMaterialStore) {
      return false;
    }
    const artifacts = await this.getReviewSessionPrivateArtifacts(id, now);
    const handle = artifacts?.transactionMaterial;
    if (!handle) {
      return false;
    }
    return this.transactionMaterialStore.getTransactionMaterial(handle, now) !== undefined;
  }

  private async clearPendingHandoff(id: string, reason: string, now: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (!session || session.pendingHandoffDigest === undefined) {
      return;
    }
    delete session.pendingHandoffDigest;
    this.sessions.set(id, session);
    await this.appendEventLog({
      type: "handoff.cancelled",
      sessionId: id,
      reason,
      at: now.toISOString()
    });
  }

  async cancelWalletHandoff(id: string, now = new Date()): Promise<ReviewSession> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new SessionStoreError("session_not_found", `Review session not found: ${id}`);
    }
    await this.clearPendingHandoff(id, "user_cancelled", now);
    return cloneLocalSession(this.sessions.get(id)!);
  }

  private async gateWalletHandoff(
    id: string,
    session: ReviewSession,
    planId: string,
    account: string,
    now: Date
  ): Promise<WalletHandoffMaterial> {
    const state = session.reviewState;
    if (!state || state.status !== "ready_for_wallet_review" || state.planId !== planId) {
      throw new SessionStoreError(
        "invalid_session_transition",
        "Wallet handoff requires a ready_for_wallet_review state for this plan"
      );
    }
    const normalizedAccount = parseSuiAddress(account);
    if (!normalizedAccount || state.account !== normalizedAccount) {
      throw new SessionStoreError("input_invalid", "Wallet handoff account does not match the reviewed account");
    }
    const contract = state.walletReviewAdapterContract;
    if (!contract) {
      throw new SessionStoreError("handoff_unavailable", "Wallet handoff requires an emitted wallet review contract");
    }
    const artifacts = await this.getReviewSessionPrivateArtifacts(id, now);
    const handle = artifacts?.transactionMaterial;
    const digest = artifacts?.transactionMaterialDigest;
    if (!handle || !digest || !this.transactionMaterialStore) {
      throw new SessionStoreError("handoff_unavailable", "Wallet handoff transaction material is unavailable");
    }
    // Bind at handoff: recompute the digest of the exact stored bytes and require
    // it to equal the commitment the user reviewed before any bytes leave the store.
    try {
      await verifyLocalTransactionMaterialArtifacts({
        materialStore: this.transactionMaterialStore,
        transactionMaterial: handle,
        transactionMaterialDigest: digest,
        now
      });
    } catch (error) {
      if (error instanceof LocalTransactionMaterialStoreError) {
        throw new SessionStoreError("handoff_unavailable", `Wallet handoff refused: ${error.message}`);
      }
      throw error;
    }
    if (digest.transactionDigest !== contract.transactionMaterialCommitment) {
      throw new SessionStoreError(
        "handoff_commitment_mismatch",
        "Wallet handoff refused: stored transaction digest does not match the reviewed contract commitment"
      );
    }
    const material = this.transactionMaterialStore.getTransactionMaterial(handle, now);
    if (!material) {
      throw new SessionStoreError("handoff_unavailable", "Wallet handoff transaction material is unavailable");
    }
    // One-transaction lock: while a handoff is outstanding, state recomputes
    // are refused so a second, different transaction cannot be signed from
    // the same session. Cleared on result recording, cancel, or material expiry.
    session.pendingHandoffDigest = contract.transactionMaterialCommitment;
    this.sessions.set(id, session);
    await this.appendEventLog({
      type: "handoff.prepared",
      sessionId: id,
      planId,
      at: now.toISOString()
    });
    return {
      transactionBytesBase64: Buffer.from(material.transactionBytes).toString("base64"),
      transactionMaterialCommitment: contract.transactionMaterialCommitment,
      planId,
      account: normalizedAccount
    };
  }

  async invalidateAllLocalSessions(reason: string, now = new Date()): Promise<void> {
    for (const id of this.sessions.keys()) {
      this.deleteReviewSessionTransactionMaterials(id);
    }
    this.sessions.clear();
    this.walletIdentity.clear();
    this.settings.clear();
    await this.appendEventLog({
      type: "local_sessions.invalidated",
      sessionId: "all",
      reason,
      at: now.toISOString()
    });
  }

  private async appendEventLog(record: EventLogRecord): Promise<void> {
    try {
      await this.eventLog.append(record);
    } catch (error) {
      // Event logs are optional audit/debug sinks. SQLite and in-memory session state remain authoritative.
      this.logger.error("event log append failed", {
        eventType: record.type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private deleteReviewSessionTransactionMaterials(reviewSessionId: string): void {
    try {
      this.transactionMaterialStore?.deleteReviewSessionTransactionMaterials(reviewSessionId);
    } catch (error) {
      this.logger.error("transaction material cleanup failed", {
        reviewSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    this.privateReviewArtifacts.delete(reviewSessionId);
  }

  private async expireReviewSession(
    id: string,
    session: ReviewSession,
    now: Date
  ): Promise<ReviewSession> {
    const nextSession = cloneLocalSession(session);
    transition(nextSession, "expired");
    try {
      await this.activityStore.recordReviewTransition({
        reviewSessionId: id,
        event: "expired",
        fromStatus: session.status,
        toStatus: nextSession.status,
        transitionedAt: now.toISOString()
      });
    } finally {
      this.deleteReviewSessionTransactionMaterials(id);
    }
    this.sessions.set(id, nextSession);
    return nextSession;
  }

  private async sanitizePrivateDerivedReviewState(
    id: string,
    session: ReviewSession,
    now: Date
  ): Promise<ReviewSession> {
    if (
      !canRetainPrivateReviewArtifacts(session.status) ||
      (!session.reviewState?.humanReadableReview && !session.reviewState?.simulation)
    ) {
      return session;
    }
    const artifacts = this.privateReviewArtifacts.get(id);
    if (!artifacts) {
      return await this.markPrivateDerivedReviewStateRefreshRequired(id, session, now);
    }
    try {
      await this.parseReviewSessionPrivateArtifacts(id, session.reviewState, artifacts, now);
      return session;
    } catch (error) {
      this.logger.error("private-derived review state refresh required", {
        reviewSessionId: id,
        error: error instanceof Error ? error.message : String(error)
      });
      return await this.markPrivateDerivedReviewStateRefreshRequired(id, session, now);
    }
  }

  private async markPrivateDerivedReviewStateRefreshRequired(
    id: string,
    session: ReviewSession,
    now: Date
  ): Promise<ReviewSession> {
    this.deleteReviewSessionTransactionMaterials(id);
    const nextSession = cloneLocalSession(session);
    transition(nextSession, "refresh_required");
    if (nextSession.reviewState) {
      nextSession.reviewState = {
        planId: nextSession.reviewState.planId,
        reviewSessionId: id,
        account: nextSession.reviewState.account,
        status: "refresh_required",
        refreshReason: "quote_stale",
        checks: [{
          id: "private_review_artifacts_refresh_required",
          label: "Review evidence refresh",
          status: "fail",
          message: "Private review evidence expired or no longer matches stored material; recompute the account-bound review before using human-readable review facts.",
          source: "adapter"
        }],
        updatedAt: now.toISOString()
      };
    }
    nextSession.lastActivityAt = now.toISOString();
    this.sessions.set(id, nextSession);
    await this.activityStore.recordReviewTransition({
      reviewSessionId: id,
      event: "state_computed",
      fromStatus: session.status,
      toStatus: nextSession.status,
      reason: "private_review_artifacts_refresh_required",
      transitionedAt: now.toISOString()
    });
    if (nextSession.reviewState) {
      await this.activityStore.recordReviewStateSnapshot({
        reviewSessionId: id,
        fromStatus: session.status,
        state: nextSession.reviewState,
        recordedAt: now.toISOString()
      });
    }
    await this.appendEventLog({
      type: "state.computed",
      sessionId: id,
      status: nextSession.status,
      reason: "private_review_artifacts_refresh_required",
      at: now.toISOString(),
      ...(nextSession.reviewState?.planId ? { planId: nextSession.reviewState.planId } : {}),
      ...(nextSession.reviewState?.account
        ? { walletAddressHash: hashEventValue(nextSession.reviewState.account) }
        : {})
    });
    return nextSession;
  }

  private replaceReviewSessionPrivateArtifacts(
    reviewSessionId: string,
    privateArtifacts: PrivateReviewArtifacts | undefined
  ): void {
    if (!privateArtifacts?.transactionMaterial || !privateArtifacts.transactionMaterialDigest) {
      this.deleteReviewSessionTransactionMaterials(reviewSessionId);
      return;
    }
    this.privateReviewArtifacts.set(reviewSessionId, privateArtifacts);
  }

  private async assertReviewSessionPrivateArtifacts(
    reviewSessionId: string,
    state: ReviewState,
    privateArtifacts: PrivateReviewArtifacts | undefined,
    now: Date
  ): Promise<void> {
    if (!privateArtifacts) {
      if (state.humanReadableReview || state.simulation) {
        this.deleteReviewSessionTransactionMaterials(reviewSessionId);
        throw new SessionStoreError(
          "session_mismatch",
          `Review private-derived state requires matching private evidence: ${reviewSessionId}`
        );
      }
      return;
    }
    try {
      await this.parseReviewSessionPrivateArtifacts(reviewSessionId, state, privateArtifacts, now);
    } catch (error) {
      this.logger.error("private review artifact rejected", {
        reviewSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.deleteReviewSessionTransactionMaterials(reviewSessionId);
      throw new SessionStoreError(
        "session_mismatch",
        `Review private artifacts do not match the stored review state: ${reviewSessionId}`
      );
    }
  }

  private async parseReviewSessionPrivateArtifacts(
    reviewSessionId: string,
    state: ReviewState,
    privateArtifacts: PrivateReviewArtifacts,
    now: Date
  ): Promise<PrivateReviewArtifacts> {
    const { transactionMaterial, transactionMaterialDigest } = privateArtifacts;
    if (
      !transactionMaterial ||
      !transactionMaterialDigest ||
      !this.transactionMaterialStore
    ) {
      throw new Error("missing private artifact material, digest, or material store");
    }
    const parsed = await verifyLocalTransactionMaterialArtifacts({
      materialStore: this.transactionMaterialStore,
      transactionMaterial,
      transactionMaterialDigest,
      now
    });
    if (
      parsed.transactionMaterial.reviewSessionId !== reviewSessionId ||
      parsed.transactionMaterial.planId !== state.planId ||
      parsed.transactionMaterial.account !== state.account
    ) {
      throw new Error("private artifacts do not match review state identity");
    }
    const transactionObjectOwnership = privateArtifacts.transactionObjectOwnership
      ? verifyTransactionObjectOwnershipEvidence({
          transactionMaterial: parsed.transactionMaterial,
          transactionMaterialDigest: parsed.transactionMaterialDigest,
          evidence: privateArtifacts.transactionObjectOwnership,
          now
        })
      : undefined;
    const swapQuotePolicy = privateArtifacts.swapQuotePolicy
      ? verifySwapQuotePolicyEvidence({
          transactionMaterial: parsed.transactionMaterial,
          evidence: privateArtifacts.swapQuotePolicy,
          now
        })
      : undefined;
    const humanReadableReview = privateArtifacts.humanReadableReview
      ? verifySupportedHumanReadableReviewEvidence({
          transactionMaterial: parsed.transactionMaterial,
          transactionMaterialDigest: parsed.transactionMaterialDigest,
          swapQuotePolicy,
          transactionObjectOwnership,
          evidence: privateArtifacts.humanReadableReview,
          now
        })
      : undefined;
    const reviewTimeSimulation = privateArtifacts.reviewTimeSimulation
      ? verifyReviewTimeSimulationEvidence({
          transactionMaterial: parsed.transactionMaterial,
          transactionMaterialDigest: parsed.transactionMaterialDigest,
          evidence: privateArtifacts.reviewTimeSimulation,
          now
        })
      : undefined;
    const verifiedArtifacts = {
      ...parsed,
      ...(swapQuotePolicy ? { swapQuotePolicy } : {}),
      ...(transactionObjectOwnership ? { transactionObjectOwnership } : {}),
      ...(humanReadableReview ? { humanReadableReview } : {}),
      ...(reviewTimeSimulation ? { reviewTimeSimulation } : {})
    };
    assertPrivateDerivedReviewStateProjections(state, verifiedArtifacts);
    return verifiedArtifacts;
  }
}

function assertPrivateDerivedReviewStateProjections(
  state: ReviewState,
  privateArtifacts: PrivateReviewArtifacts
): void {
  for (const binding of PRIVATE_DERIVED_REVIEW_FIELD_BINDINGS) {
    const publicValue = binding.getPublicState(state);
    const privateEvidence = binding.getPrivateEvidence(privateArtifacts);
    if (publicValue === undefined && privateEvidence === undefined) {
      continue;
    }
    if (publicValue === undefined || privateEvidence === undefined) {
      throw new Error(`review state ${binding.field} must match private ${binding.field} evidence`);
    }
    const projected = binding.projectPrivateEvidence(privateEvidence);
    if (!isDeepStrictEqual(publicValue, projected)) {
      throw new Error(`review state ${binding.field} must be projected from private ${binding.field} evidence`);
    }
  }
}

export function transition(session: ReviewSession, next: InternalSessionStatus): void {
  if (session.status === next) {
    return;
  }

  const allowed = ALLOWED_TRANSITIONS[session.status] ?? [];
  if (!allowed.includes(next)) {
    throw new SessionStoreError(
      "invalid_session_transition",
      `Invalid session transition: ${session.status} -> ${next}`
    );
  }
  session.status = next;
}

function assertPlanInSession(session: ReviewSession, planId: string): void {
  if (!session.plans.some((plan) => plan.id === planId)) {
    throw new SessionStoreError(
      "plan_not_in_session",
      `Action plan not found in review session: ${planId}`
    );
  }
}

function assertSameSessionId(expected: string, actual: string, label: string): void {
  if (actual !== expected) {
    throw new SessionStoreError(
      "session_mismatch",
      `${label} session mismatch: expected ${expected}, got ${actual}`
    );
  }
}

function parseReviewState(
  state: ReviewState,
  validateAdapterLifecycle: AdapterLifecycleValidator
): ReviewState {
  let parsed;
  try {
    parsed = parseLifecycleValidatedReviewState(state, validateAdapterLifecycle);
  } catch {
    throw new SessionStoreError("input_invalid", "Invalid review state shape or adapter lifecycle");
  }
  const normalizedAccount = parseSuiAddress(parsed.account);
  if (!normalizedAccount) {
    throw new SessionStoreError("input_invalid", "Invalid review state account");
  }
  return { ...parsed, account: normalizedAccount } as ReviewState;
}

function parseExecutionResult(
  result: ExecutionResult,
  previous?: ExecutionResult
): ExecutionResult {
  const candidate =
    result.status === "failure" &&
    result.txDigest === undefined &&
    previous?.status === "signed_pending_result"
      ? { ...result, txDigest: previous.txDigest }
      : result;
  const parsed = executionResultSchema.safeParse(result);
  const reparsed = executionResultSchema.safeParse(candidate);
  if (!parsed.success && !reparsed.success) {
    throw new SessionStoreError("input_invalid", "Invalid execution result shape");
  }
  return (reparsed.success ? reparsed.data : parsed.data) as ExecutionResult;
}

function cloneSession<T>(session: T): T {
  return cloneLocalSession(session);
}
