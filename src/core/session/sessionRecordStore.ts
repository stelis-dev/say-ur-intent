import { isDeepStrictEqual } from "node:util";
import type { ReviewSession } from "../action/types.js";
import { cloneLocalSession } from "./localSession.js";

/**
 * Persistence seam for live review-session records. The session-store orchestration
 * (transitions, handoff gating, expiry, artifact verification) is identical across
 * backends; only this record store and the artifact store differ for in-memory
 * tests and low-level live-session reads.
 *
 * The handoff lock is exposed as its own operation because it is the one mutation
 * that must be atomic across processes: the SQLite backend implements it as a single
 * conditional UPDATE so two processes can never hand off two different transactions
 * for the same session.
 */
export interface SessionRecordStore {
  readonly usesActivityStoreLiveSessionMutations?: boolean;
  get(id: string): ReviewSession | undefined;
  create(id: string, session: ReviewSession): void;
  commitReviewSessionTransition(id: string, expected: ReviewSession, next: ReviewSession): boolean;
  ids(): string[];
  clear(): void;
  // Set pending_handoff_digest iff currently unset or already equal to digest.
  // Returns false only on a genuine conflict (a different digest is already locked).
  acquireHandoffLock(id: string, digest: string): boolean;
  releaseHandoffLock(id: string, expectedDigest?: string): boolean;
}

export class InMemorySessionRecordStore implements SessionRecordStore {
  private readonly sessions = new Map<string, ReviewSession>();
  readonly usesActivityStoreLiveSessionMutations = false;

  get(id: string): ReviewSession | undefined {
    const session = this.sessions.get(id);
    return session ? cloneLocalSession(session) : undefined;
  }

  create(id: string, session: ReviewSession): void {
    if (this.sessions.has(id)) {
      throw new Error(`Review session already exists: ${id}`);
    }
    this.sessions.set(id, cloneLocalSession(session));
  }

  commitReviewSessionTransition(id: string, expected: ReviewSession, next: ReviewSession): boolean {
    const current = this.sessions.get(id);
    if (!current || !isDeepStrictEqual(current, expected)) {
      return false;
    }
    this.sessions.set(id, cloneLocalSession(next));
    return true;
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

  releaseHandoffLock(id: string, expectedDigest?: string): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }
    if (expectedDigest !== undefined && session.pendingHandoffDigest !== expectedDigest) {
      return false;
    }
    if (session.pendingHandoffDigest === undefined) {
      return true;
    }
    delete session.pendingHandoffDigest;
    return true;
  }
}
