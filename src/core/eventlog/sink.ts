import { appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export type EventLogRecord = {
  type:
    | "session.created"
    | "review.opened"
    | "wallet.connected"
    | "wallet_identity.created"
    | "wallet_identity.opened"
    | "wallet_identity.connecting"
    | "wallet_identity.connected"
    | "wallet_identity.rejected"
    | "wallet_identity.failed"
    | "wallet_identity.expired"
    | "settings_session.created"
    | "local_sessions.invalidated"
    | "state.computed"
    | "handoff.prepared"
    | "handoff.refused"
    | "handoff.cancelled"
    | "sign.requested"
    | "result.recorded";
  sessionId: string;
  planId?: string;
  walletAddressHash?: string;
  txDigest?: string;
  status?: string;
  reason?: string;
  at: string;
};

export interface EventLogSink {
  append(record: EventLogRecord): Promise<void>;
}

export class NullEventLogSink implements EventLogSink {
  async append(_record: EventLogRecord): Promise<void> {}
}

export class NdjsonEventLogSink implements EventLogSink {
  constructor(private readonly filePath: string) {}

  async append(record: EventLogRecord): Promise<void> {
    await appendFile(this.filePath, `${JSON.stringify(redactEvent(record))}\n`, "utf8");
  }
}

export function redactEvent(record: EventLogRecord): EventLogRecord {
  const redacted: EventLogRecord = {
    type: record.type,
    sessionId: record.sessionId,
    at: record.at
  };
  if (record.planId) redacted.planId = record.planId;
  if (record.walletAddressHash) redacted.walletAddressHash = record.walletAddressHash;
  if (record.txDigest) redacted.txDigest = record.txDigest;
  if (record.status) redacted.status = record.status;
  if (record.reason) redacted.reason = record.reason;
  return redacted;
}

export function hashEventValue(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
