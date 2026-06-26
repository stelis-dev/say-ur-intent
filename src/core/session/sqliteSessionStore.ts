import { isDeepStrictEqual } from "node:util";
import type {
  ActionPlan,
  ExecutionResult,
  InternalSessionStatus,
  ReviewSession,
  ReviewState
} from "../action/types.js";
import type { SqliteDatabase } from "../activity/sqliteActivityStoreTypes.js";
import {
  clonePrivateReviewArtifacts,
  type PrivateReviewArtifactStore,
  type PrivateReviewArtifacts
} from "./privateReviewArtifacts.js";
import type { SessionRecordStore } from "./sessionRecordStore.js";
import type { KeyedRecordStore } from "./keyedRecordStore.js";
import { walletIdentitySessionSchema, type WalletIdentitySession } from "./walletIdentity.js";
import type { SettingsSession } from "./settingsSession.js";
import { LIVE_REVIEW_SESSION_WRITE_CONTRACT_VERSION } from "./liveReviewSessionContract.js";

export type LiveReviewSessionRow = {
  id: string;
  token_hash: string;
  status: string;
  account: string | null;
  pending_handoff_digest: string | null;
  plans_json: string;
  review_state_json: string | null;
  execution_result_json: string | null;
  created_at: string;
  expires_at: string;
  last_activity_at: string;
  revision: number;
  write_contract_version: string;
};

export function insertLiveReviewSessionRow(db: SqliteDatabase, session: ReviewSession): void {
  const serialized = serializeSessionForLiveReviewSessionRow(session);
  db.prepare(
    `INSERT INTO live_review_sessions
       (id, token_hash, status, account, pending_handoff_digest,
        plans_json, review_state_json, execution_result_json,
        created_at, expires_at, last_activity_at, revision, write_contract_version)
     VALUES
       (@id, @tokenHash, @status, @account, @pendingHandoffDigest,
        @plansJson, @reviewStateJson, @executionResultJson,
        @createdAt, @expiresAt, @lastActivityAt, 0, @writeContractVersion)`
  ).run(serialized);
}

export function updateLiveReviewSessionRow(
  db: SqliteDatabase,
  expectedRevision: number,
  session: ReviewSession
): boolean {
  const serialized = serializeSessionForLiveReviewSessionRow(session);
  const result = db
    .prepare(
      `UPDATE live_review_sessions
       SET token_hash = @tokenHash,
           status = @status,
           account = @account,
           pending_handoff_digest = @pendingHandoffDigest,
           plans_json = @plansJson,
           review_state_json = @reviewStateJson,
           execution_result_json = @executionResultJson,
           created_at = @createdAt,
           expires_at = @expiresAt,
           last_activity_at = @lastActivityAt,
           revision = revision + 1,
           write_contract_version = @writeContractVersion
       WHERE id = @id AND revision = @expectedRevision`
    )
    .run({ ...serialized, expectedRevision });
  return result.changes > 0;
}

export type SqliteSessionRecordStoreOptions = {
  usesActivityStoreLiveSessionMutations?: boolean;
};

/**
 * SQLite-backed live review-session records. Runtime product transitions are
 * committed by SqliteActivityStore when the store is created through that owner,
 * so live session state and review activity stay in one SQLite transaction.
 * Direct instances keep a low-level transition commit path for tests and mixed
 * harnesses that do not couple live state with activity rows.
 */
export class SqliteSessionRecordStore implements SessionRecordStore {
  readonly usesActivityStoreLiveSessionMutations: boolean;

  constructor(
    private readonly db: SqliteDatabase,
    options: SqliteSessionRecordStoreOptions = {}
  ) {
    this.usesActivityStoreLiveSessionMutations = options.usesActivityStoreLiveSessionMutations === true;
  }

  get(id: string): ReviewSession | undefined {
    const row = this.db
      .prepare(`SELECT * FROM live_review_sessions WHERE id = ?`)
      .get(id) as LiveReviewSessionRow | undefined;
    return row ? sessionFromLiveReviewSessionRow(row) : undefined;
  }

  create(id: string, session: ReviewSession): void {
    if (this.getRow(id)) {
      throw new Error(`Review session already exists: ${id}`);
    }
    insertLiveReviewSessionRow(this.db, session);
  }

  commitReviewSessionTransition(id: string, expected: ReviewSession, next: ReviewSession): boolean {
    const commit = this.db.transaction(() => {
      const row = this.getRow(id);
      if (!row || !isDeepStrictEqual(sessionFromLiveReviewSessionRow(row), expected)) {
        return false;
      }
      return updateLiveReviewSessionRow(this.db, row.revision, next);
    });
    return commit.immediate();
  }

  ids(): string[] {
    const rows = this.db.prepare(`SELECT id FROM live_review_sessions`).all() as { id: string }[];
    return rows.map((row) => row.id);
  }

  clear(): void {
    this.db.prepare(`DELETE FROM live_review_sessions`).run();
  }

  acquireHandoffLock(id: string, digest: string): boolean {
    const existing = this.db
      .prepare(`SELECT pending_handoff_digest FROM live_review_sessions WHERE id = ?`)
      .get(id) as { pending_handoff_digest: string | null } | undefined;
    if (!existing) {
      return false;
    }
    if (existing.pending_handoff_digest === digest) {
      return true;
    }
    // Atomic across processes: claim the lock only when it is free or already held
    // by the same digest. A different in-flight digest leaves the row untouched.
    const result = this.db
      .prepare(
        `UPDATE live_review_sessions
         SET pending_handoff_digest = ?,
             revision = revision + 1,
             write_contract_version = ?
         WHERE id = ? AND pending_handoff_digest IS NULL`
      )
      .run(digest, LIVE_REVIEW_SESSION_WRITE_CONTRACT_VERSION, id);
    if (result.changes > 0) {
      return true;
    }
    const current = this.get(id);
    return current?.pendingHandoffDigest === digest;
  }

  releaseHandoffLock(id: string, expectedDigest?: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE live_review_sessions
         SET pending_handoff_digest = NULL,
             revision = revision + 1,
             write_contract_version = ?
         WHERE id = ?
           AND pending_handoff_digest IS NOT NULL
           AND (? IS NULL OR pending_handoff_digest = ?)`
      )
      .run(LIVE_REVIEW_SESSION_WRITE_CONTRACT_VERSION, id, expectedDigest ?? null, expectedDigest ?? null);
    if (result.changes > 0) {
      return true;
    }
    const session = this.get(id);
    return session !== undefined && session.pendingHandoffDigest === undefined;
  }

  private getRow(id: string): LiveReviewSessionRow | undefined {
    return this.db
      .prepare(`SELECT * FROM live_review_sessions WHERE id = ?`)
      .get(id) as LiveReviewSessionRow | undefined;
  }

}

export class SqlitePrivateReviewArtifactStore implements PrivateReviewArtifactStore {
  constructor(private readonly db: SqliteDatabase) {}

  get(reviewSessionId: string): PrivateReviewArtifacts | undefined {
    const row = this.db
      .prepare(`SELECT artifacts_json FROM live_private_review_artifacts WHERE review_session_id = ?`)
      .get(reviewSessionId) as { artifacts_json: string } | undefined;
    if (!row) {
      return undefined;
    }
    // clonePrivateReviewArtifacts re-parses/validates the evidence on read, matching
    // the in-memory store's clone-on-read behaviour.
    return clonePrivateReviewArtifacts(JSON.parse(row.artifacts_json) as PrivateReviewArtifacts);
  }

  set(reviewSessionId: string, artifacts: PrivateReviewArtifacts): void {
    const json = JSON.stringify(clonePrivateReviewArtifacts(artifacts));
    this.db
      .prepare(
        `INSERT INTO live_private_review_artifacts (review_session_id, artifacts_json)
         VALUES (?, ?)
         ON CONFLICT(review_session_id) DO UPDATE SET artifacts_json = excluded.artifacts_json`
      )
      .run(reviewSessionId, json);
  }

  delete(reviewSessionId: string): void {
    this.db.prepare(`DELETE FROM live_private_review_artifacts WHERE review_session_id = ?`).run(reviewSessionId);
  }

  clear(): void {
    this.db.prepare(`DELETE FROM live_private_review_artifacts`).run();
  }
}

/**
 * SQLite-backed id-keyed store for the short-lived wallet-identity and settings
 * session managers. Each record is a JSON blob keyed by id; the table name is a
 * trusted constant supplied by the factories below (never user input).
 */
export class SqliteKeyedRecordStore<T> implements KeyedRecordStore<T> {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly table: string,
    private readonly revive: (raw: unknown) => T
  ) {}

  get(id: string): T | undefined {
    const row = this.db
      .prepare(`SELECT session_json FROM ${this.table} WHERE id = ?`)
      .get(id) as { session_json: string } | undefined;
    return row ? this.revive(JSON.parse(row.session_json)) : undefined;
  }

  set(id: string, value: T): void {
    this.db
      .prepare(
        `INSERT INTO ${this.table} (id, session_json) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET session_json = excluded.session_json`
      )
      .run(id, JSON.stringify(value));
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM ${this.table} WHERE id = ?`).run(id);
  }

  ids(): string[] {
    const rows = this.db.prepare(`SELECT id FROM ${this.table}`).all() as { id: string }[];
    return rows.map((row) => row.id);
  }

  clear(): void {
    this.db.prepare(`DELETE FROM ${this.table}`).run();
  }
}

export function createSqliteWalletIdentityRecordStore(
  db: SqliteDatabase
): KeyedRecordStore<WalletIdentitySession> {
  return new SqliteKeyedRecordStore<WalletIdentitySession>(
    db,
    "live_wallet_identity_sessions",
    (raw) => walletIdentitySessionSchema.parse(raw) as WalletIdentitySession
  );
}

export function createSqliteSettingsRecordStore(db: SqliteDatabase): KeyedRecordStore<SettingsSession> {
  return new SqliteKeyedRecordStore<SettingsSession>(
    db,
    "live_settings_sessions",
    (raw) => raw as SettingsSession
  );
}

// Reconstruct the ReviewSession from columns + JSON blobs. Optional fields are
// omitted (not set to undefined) so the shape matches the in-memory store exactly.
export function sessionFromLiveReviewSessionRow(row: LiveReviewSessionRow): ReviewSession {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    status: row.status as InternalSessionStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastActivityAt: row.last_activity_at,
    plans: JSON.parse(row.plans_json) as ActionPlan[],
    ...(row.account === null ? {} : { account: row.account }),
    ...(row.review_state_json === null
      ? {}
      : { reviewState: JSON.parse(row.review_state_json) as ReviewState }),
    ...(row.execution_result_json === null
      ? {}
      : { executionResult: JSON.parse(row.execution_result_json) as ExecutionResult }),
    ...(row.pending_handoff_digest === null
      ? {}
      : { pendingHandoffDigest: row.pending_handoff_digest })
  };
}

export function serializeSessionForLiveReviewSessionRow(session: ReviewSession): Record<string, unknown> {
  return {
    id: session.id,
    tokenHash: session.tokenHash,
    status: session.status,
    account: session.account ?? null,
    pendingHandoffDigest: session.pendingHandoffDigest ?? null,
    plansJson: JSON.stringify(session.plans),
    reviewStateJson: session.reviewState ? JSON.stringify(session.reviewState) : null,
    executionResultJson: session.executionResult ? JSON.stringify(session.executionResult) : null,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    lastActivityAt: session.lastActivityAt,
    writeContractVersion: LIVE_REVIEW_SESSION_WRITE_CONTRACT_VERSION
  };
}
