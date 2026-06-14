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

type LiveReviewSessionRow = {
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
};

/**
 * SQLite-backed live review-session records. Holds the same SessionRecordStore
 * contract as the in-memory backend so the shared LocalSessionStore orchestration
 * (and every security invariant) runs unchanged. The handoff lock is a single
 * conditional UPDATE so two processes can never hand off two different transactions
 * for the same session.
 */
export class SqliteSessionRecordStore implements SessionRecordStore {
  constructor(private readonly db: SqliteDatabase) {}

  get(id: string): ReviewSession | undefined {
    const row = this.db
      .prepare(`SELECT * FROM live_review_sessions WHERE id = ?`)
      .get(id) as LiveReviewSessionRow | undefined;
    return row ? sessionFromRow(row) : undefined;
  }

  set(id: string, session: ReviewSession): void {
    this.db
      .prepare(
        `INSERT INTO live_review_sessions
           (id, token_hash, status, account, pending_handoff_digest,
            plans_json, review_state_json, execution_result_json,
            created_at, expires_at, last_activity_at)
         VALUES
           (@id, @tokenHash, @status, @account, @pendingHandoffDigest,
            @plansJson, @reviewStateJson, @executionResultJson,
            @createdAt, @expiresAt, @lastActivityAt)
         ON CONFLICT(id) DO UPDATE SET
           token_hash = excluded.token_hash,
           status = excluded.status,
           account = excluded.account,
           pending_handoff_digest = excluded.pending_handoff_digest,
           plans_json = excluded.plans_json,
           review_state_json = excluded.review_state_json,
           execution_result_json = excluded.execution_result_json,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at,
           last_activity_at = excluded.last_activity_at`
      )
      .run({
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
        lastActivityAt: session.lastActivityAt
      });
  }

  ids(): string[] {
    const rows = this.db.prepare(`SELECT id FROM live_review_sessions`).all() as { id: string }[];
    return rows.map((row) => row.id);
  }

  clear(): void {
    this.db.prepare(`DELETE FROM live_review_sessions`).run();
  }

  acquireHandoffLock(id: string, digest: string): boolean {
    // Atomic across processes: claim the lock only when it is free or already held
    // by the same digest. A different in-flight digest leaves the row untouched.
    const result = this.db
      .prepare(
        `UPDATE live_review_sessions
         SET pending_handoff_digest = ?
         WHERE id = ? AND (pending_handoff_digest IS NULL OR pending_handoff_digest = ?)`
      )
      .run(digest, id, digest);
    return result.changes > 0;
  }

  releaseHandoffLock(id: string): void {
    this.db
      .prepare(`UPDATE live_review_sessions SET pending_handoff_digest = NULL WHERE id = ?`)
      .run(id);
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

// Reconstruct the ReviewSession from columns + JSON blobs. Optional fields are
// omitted (not set to undefined) so the shape matches the in-memory store exactly.
function sessionFromRow(row: LiveReviewSessionRow): ReviewSession {
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
