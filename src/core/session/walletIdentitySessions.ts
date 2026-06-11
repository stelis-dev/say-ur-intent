import { hashEventValue, type EventLogRecord } from "../eventlog/sink.js";
import {
  cloneLocalSession,
  createLocalSessionBase,
  isLocalSessionExpired,
  tokenMatchesHash
} from "./localSession.js";
import { SessionStoreError } from "./sessionErrors.js";
import {
  isTerminalWalletIdentityStatus,
  walletIdentityResultInputSchema,
  walletIdentitySessionSchema,
  type WalletIdentityResultInput,
  type WalletIdentitySession,
  type WalletIdentityStatus
} from "./walletIdentity.js";

const ALLOWED_WALLET_IDENTITY_TRANSITIONS: Record<WalletIdentityStatus, WalletIdentityStatus[]> = {
  pending: ["opened", "expired"],
  opened: ["connecting", "failed", "expired"],
  connecting: ["connected", "rejected", "failed", "expired"],
  connected: [],
  rejected: [],
  failed: [],
  expired: []
};

export function transitionWalletIdentity(
  session: WalletIdentitySession,
  next: WalletIdentityStatus
): void {
  if (session.status === next) {
    return;
  }

  const allowed = ALLOWED_WALLET_IDENTITY_TRANSITIONS[session.status] ?? [];
  if (!allowed.includes(next)) {
    throw new SessionStoreError(
      "invalid_session_transition",
      `Invalid wallet identity transition: ${session.status} -> ${next}`
    );
  }
  session.status = next;
}

function parseWalletIdentitySession(session: WalletIdentitySession): void {
  const parsed = walletIdentitySessionSchema.safeParse(session);
  if (!parsed.success) {
    throw new SessionStoreError("input_invalid", "Invalid wallet identity session shape");
  }
}

export type WalletIdentitySessionManagerOptions = {
  ttlMs: number;
  appendEventLog: (record: EventLogRecord) => Promise<void>;
  setActiveAccount: (account: string, now: Date, wallet?: { name?: string | undefined; id?: string | undefined }) => Promise<void>;
};

export type CreatedWalletIdentitySessionRecord = {
  session: WalletIdentitySession;
  token: string;
};

export class WalletIdentitySessionManager {
  private readonly sessions = new Map<string, WalletIdentitySession>();

  constructor(private readonly options: WalletIdentitySessionManagerOptions) {}

  async create(now: Date): Promise<CreatedWalletIdentitySessionRecord> {
    const { base, token } = createLocalSessionBase(now, this.options.ttlMs);
    const session: WalletIdentitySession = {
      ...base,
      status: "pending"
    };

    this.sessions.set(session.id, session);
    await this.options.appendEventLog({
      type: "wallet_identity.created",
      sessionId: session.id,
      status: session.status,
      at: now.toISOString()
    });

    return { session: cloneLocalSession(session), token };
  }

  async get(id: string, now: Date): Promise<WalletIdentitySession | undefined> {
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }

    if (isLocalSessionExpired(session, now) && !isTerminalWalletIdentityStatus(session.status)) {
      return cloneLocalSession(await this.expire(id, session, now));
    }

    return cloneLocalSession(session);
  }

  async list(now: Date): Promise<WalletIdentitySession[]> {
    const sessions: WalletIdentitySession[] = [];
    for (const id of this.sessions.keys()) {
      const session = await this.get(id, now);
      if (session) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  async validateToken(id: string, token: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }
    // Wallet identity sessions expose terminal lifecycle states through read APIs after token validation.
    // Mutable methods own expiry transitions and return lifecycle-specific errors.
    return tokenMatchesHash(session.tokenHash, token);
  }

  async recordOpened(id: string, now: Date): Promise<WalletIdentitySession> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new SessionStoreError("session_not_found", `Wallet identity session not found: ${id}`);
    }
    if (isLocalSessionExpired(session, now) && !isTerminalWalletIdentityStatus(session.status)) {
      return cloneLocalSession(await this.expire(id, session, now));
    }
    if (isTerminalWalletIdentityStatus(session.status)) {
      return cloneLocalSession(session);
    }
    const nextSession = cloneLocalSession(session);
    if (nextSession.status === "pending") {
      transitionWalletIdentity(nextSession, "opened");
    }
    nextSession.lastActivityAt = now.toISOString();
    await this.options.appendEventLog({
      type: "wallet_identity.opened",
      sessionId: id,
      status: nextSession.status,
      at: now.toISOString()
    });
    this.sessions.set(id, nextSession);
    return cloneLocalSession(nextSession);
  }

  async recordConnecting(id: string, now: Date): Promise<WalletIdentitySession> {
    const session = await this.requireMutable(id, now);
    const nextSession = cloneLocalSession(session);
    if (nextSession.status !== "connecting") {
      transitionWalletIdentity(nextSession, "connecting");
    }
    nextSession.lastActivityAt = now.toISOString();
    await this.options.appendEventLog({
      type: "wallet_identity.connecting",
      sessionId: id,
      status: nextSession.status,
      at: now.toISOString()
    });
    this.sessions.set(id, nextSession);
    return cloneLocalSession(nextSession);
  }

  async recordResult(
    id: string,
    result: WalletIdentityResultInput,
    now: Date
  ): Promise<WalletIdentitySession> {
    const session = await this.requireMutable(id, now);
    const parsed = walletIdentityResultInputSchema.safeParse(result);
    if (!parsed.success) {
      throw new SessionStoreError("input_invalid", `Invalid wallet identity result: ${id}`);
    }
    if (
      session.status === "opened" &&
      parsed.data.status === "failed" &&
      parsed.data.failureReason !== "no_compatible_wallet"
    ) {
      throw new SessionStoreError(
        "invalid_session_transition",
        "Only no_compatible_wallet may fail before a connection attempt"
      );
    }
    const nextSession = cloneLocalSession(session);
    transitionWalletIdentity(nextSession, parsed.data.status);
    Object.assign(nextSession, parsed.data);
    nextSession.lastActivityAt = now.toISOString();
    parseWalletIdentitySession(nextSession);
    if (parsed.data.status === "connected") {
      await this.options.setActiveAccount(parsed.data.account, now, {
        name: parsed.data.walletName,
        id: parsed.data.walletId
      });
    }
    this.sessions.set(id, nextSession);
    const eventType =
      parsed.data.status === "connected"
        ? "wallet_identity.connected"
        : parsed.data.status === "rejected"
          ? "wallet_identity.rejected"
          : "wallet_identity.failed";
    const event = {
      type: eventType,
      sessionId: id,
      status: nextSession.status,
      at: now.toISOString()
    } as const;
    await this.options.appendEventLog(
      parsed.data.status === "connected"
        ? { ...event, walletAddressHash: hashEventValue(parsed.data.account) }
        : event
    );
    return cloneLocalSession(nextSession);
  }

  clear(): void {
    this.sessions.clear();
  }

  private async requireMutable(id: string, now: Date): Promise<WalletIdentitySession> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new SessionStoreError("session_not_found", `Wallet identity session not found: ${id}`);
    }
    if (isLocalSessionExpired(session, now) && !isTerminalWalletIdentityStatus(session.status)) {
      await this.expire(id, session, now);
      throw new SessionStoreError("session_expired", `Wallet identity session expired: ${id}`);
    }
    if (isTerminalWalletIdentityStatus(session.status)) {
      throw new SessionStoreError(
        "invalid_session_transition",
        `Wallet identity session already terminal: ${id}`
      );
    }
    return session;
  }

  private async expire(
    id: string,
    session: WalletIdentitySession,
    now: Date
  ): Promise<WalletIdentitySession> {
    const nextSession = cloneLocalSession(session);
    transitionWalletIdentity(nextSession, "expired");
    await this.options.appendEventLog({
      type: "wallet_identity.expired",
      sessionId: id,
      status: nextSession.status,
      at: now.toISOString()
    });
    this.sessions.set(id, nextSession);
    return nextSession;
  }
}
