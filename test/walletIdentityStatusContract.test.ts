import { describe, expect, it } from "vitest";
import {
  WALLET_IDENTITY_STATUSES,
  isTerminalWalletIdentityStatus,
  isWalletIdentityStatus
} from "../src/core/session/walletIdentityStatusContract.js";

// This pure contract is the single source of truth for the wallet-identity status
// set: the server (walletIdentity.ts) builds its zod schema and session model from
// it, and the browser Connect page imports it for response validation and UI
// state. Locking it here covers both, so the two cannot drift.
describe("wallet identity status contract", () => {
  it("lists exactly the known lifecycle statuses", () => {
    expect(WALLET_IDENTITY_STATUSES).toEqual([
      "pending",
      "opened",
      "connecting",
      "connected",
      "rejected",
      "failed",
      "expired"
    ]);
  });

  it("accepts every known status", () => {
    for (const status of WALLET_IDENTITY_STATUSES) {
      expect(isWalletIdentityStatus(status)).toBe(true);
    }
  });

  it("rejects unknown or non-string values so the response boundary fails closed", () => {
    for (const value of ["", "active", "valid", "done", "CONNECTED", "expiredd", "unknown"]) {
      expect(isWalletIdentityStatus(value)).toBe(false);
    }
    for (const value of [undefined, null, 1, true, {}, ["opened"], { status: "opened" }]) {
      expect(isWalletIdentityStatus(value)).toBe(false);
    }
  });

  it("treats connected, rejected, failed, and expired as terminal and the rest as active", () => {
    expect(isTerminalWalletIdentityStatus("connected")).toBe(true);
    expect(isTerminalWalletIdentityStatus("rejected")).toBe(true);
    expect(isTerminalWalletIdentityStatus("failed")).toBe(true);
    expect(isTerminalWalletIdentityStatus("expired")).toBe(true);
    expect(isTerminalWalletIdentityStatus("pending")).toBe(false);
    expect(isTerminalWalletIdentityStatus("opened")).toBe(false);
    expect(isTerminalWalletIdentityStatus("connecting")).toBe(false);
  });
});
