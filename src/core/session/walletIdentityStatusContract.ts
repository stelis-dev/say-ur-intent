// Single source of truth for the wallet-identity session lifecycle status. This
// module is intentionally pure - no zod, no node, no session model - so both the
// server (walletIdentity.ts, which builds the zod schema and session model from
// it) and the browser bundle (connect.ts, which validates responses and decides
// UI state) import the same contract instead of keeping parallel copies.
export const WALLET_IDENTITY_STATUSES = [
  "pending",
  "opened",
  "connecting",
  "connected",
  "rejected",
  "failed",
  "expired"
] as const;

export type WalletIdentityStatus = (typeof WALLET_IDENTITY_STATUSES)[number];
export type WalletIdentityNonTerminalStatus = "pending" | "opened" | "connecting";
export type WalletIdentityTerminalStatus = "connected" | "rejected" | "failed" | "expired";

export function isWalletIdentityStatus(value: unknown): value is WalletIdentityStatus {
  return typeof value === "string" && (WALLET_IDENTITY_STATUSES as readonly string[]).includes(value);
}

export function isTerminalWalletIdentityStatus(
  status: WalletIdentityStatus
): status is WalletIdentityTerminalStatus {
  return status === "connected" || status === "rejected" || status === "failed" || status === "expired";
}
