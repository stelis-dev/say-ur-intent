import type { EventLogRecord } from "../eventlog/sink.js";
import {
  cloneLocalSession,
  createLocalSessionBase,
  isLocalSessionExpired,
  tokenMatchesHash
} from "./localSession.js";
import type { SettingsSession } from "./settingsSession.js";
import {
  InMemoryKeyedRecordStore,
  type KeyedRecordStore
} from "./keyedRecordStore.js";

export type SettingsSessionManagerOptions = {
  ttlMs: number;
  appendEventLog: (record: EventLogRecord) => Promise<void>;
  recordStore?: KeyedRecordStore<SettingsSession>;
};

export type CreatedSettingsSessionRecord = {
  session: SettingsSession;
  token: string;
};

export class SettingsSessionManager {
  private readonly sessions: KeyedRecordStore<SettingsSession>;

  constructor(private readonly options: SettingsSessionManagerOptions) {
    this.sessions = options.recordStore ?? new InMemoryKeyedRecordStore<SettingsSession>();
  }

  async create(now: Date): Promise<CreatedSettingsSessionRecord> {
    const { base, token } = createLocalSessionBase(now, this.options.ttlMs);
    const session: SettingsSession = {
      ...base,
      type: "local_settings"
    };
    this.sessions.set(session.id, session);
    await this.options.appendEventLog({
      type: "settings_session.created",
      sessionId: session.id,
      at: now.toISOString()
    });
    return { session: cloneLocalSession(session), token };
  }

  async get(id: string, now: Date): Promise<SettingsSession | undefined> {
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }
    if (isLocalSessionExpired(session, now)) {
      this.sessions.delete(id);
      return undefined;
    }
    return cloneLocalSession(session);
  }

  async validateToken(id: string, token: string, now: Date): Promise<boolean> {
    const session = await this.get(id, now);
    if (!session) {
      return false;
    }
    return tokenMatchesHash(session.tokenHash, token);
  }

  clear(): void {
    this.sessions.clear();
  }
}
