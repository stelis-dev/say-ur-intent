import type { ReviewSession } from "../action/types.js";

/**
 * Persistence seam for live review-session records. The session-store orchestration
 * (transitions, handoff gating, expiry, artifact verification) is identical across
 * backends; only this record store and the artifact store differ between the
 * in-memory and SQLite implementations, so the security invariants cannot drift.
 *
 * The handoff lock is exposed as its own operation because it is the one mutation
 * that must be atomic across processes: the SQLite backend implements it as a single
 * conditional UPDATE so two processes can never hand off two different transactions
 * for the same session.
 */
export interface SessionRecordStore {
  get(id: string): ReviewSession | undefined;
  set(id: string, session: ReviewSession): void;
  ids(): string[];
  clear(): void;
  // Set pending_handoff_digest iff currently unset or already equal to digest.
  // Returns false only on a genuine conflict (a different digest is already locked).
  acquireHandoffLock(id: string, digest: string): boolean;
  releaseHandoffLock(id: string): void;
}

export class InMemorySessionRecordStore implements SessionRecordStore {
  private readonly sessions = new Map<string, ReviewSession>();

  get(id: string): ReviewSession | undefined {
    return this.sessions.get(id);
  }

  set(id: string, session: ReviewSession): void {
    this.sessions.set(id, session);
  }

  ids(): string[] {
    return [...this.sessions.keys()];
  }

  clear(): void {
    this.sessions.clear();
  }

  acquireHandoffLock(id: string, digest: string): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }
    if (session.pendingHandoffDigest !== undefined && session.pendingHandoffDigest !== digest) {
      return false;
    }
    session.pendingHandoffDigest = digest;
    return true;
  }

  releaseHandoffLock(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    delete session.pendingHandoffDigest;
  }
}
