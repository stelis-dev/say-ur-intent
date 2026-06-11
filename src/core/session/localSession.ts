import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

export type LocalSessionBase = {
  id: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
};

export type CreatedLocalSessionBase = {
  base: LocalSessionBase;
  token: string;
};

export function createLocalSessionBase(now: Date, ttlMs: number): CreatedLocalSessionBase {
  const id = randomBytes(18).toString("base64url");
  const token = randomBytes(32).toString("base64url");
  const createdAt = now.toISOString();
  return {
    base: {
      id,
      tokenHash: hashToken(token),
      createdAt,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      lastActivityAt: createdAt
    },
    token
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatchesHash(tokenHash: string, token: string): boolean {
  const expected = Buffer.from(tokenHash, "hex");
  const actual = Buffer.from(hashToken(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isLocalSessionExpired(session: { expiresAt: string }, now: Date): boolean {
  return new Date(session.expiresAt).getTime() <= now.getTime();
}

export function cloneLocalSession<T>(value: T): T {
  return structuredClone(value);
}
