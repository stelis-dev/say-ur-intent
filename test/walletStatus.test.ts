import { describe, expect, it } from "vitest";
import {
  resultForConnectedAccount,
  resultForNoCompatibleWallet,
  resultForWalletError,
  sanitizeFailureDetail
} from "../review-app/src/walletStatus.js";

describe("wallet identity frontend status mapping", () => {
  it("maps connected accounts only when Sui mainnet is authorized", () => {
    expect(
      resultForConnectedAccount({ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", chains: ["sui:mainnet"] }, { walletName: "Wallet" })
    ).toEqual({
      status: "connected",
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      chain: "sui:mainnet",
      walletName: "Wallet"
    });

    expect(resultForConnectedAccount({ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", chains: ["sui:testnet"] })).toMatchObject({
      status: "failed",
      failureReason: "unsupported_chain"
    });
  });

  it("uses deterministic failure reasons without string overfitting", () => {
    expect(resultForNoCompatibleWallet()).toEqual({
      status: "failed",
      failureReason: "no_compatible_wallet"
    });
    expect(resultForConnectedAccount(undefined)).toEqual({
      status: "failed",
      failureReason: "no_accounts_authorized"
    });
  });

  it("maps only Wallet Standard user rejection codes to rejected", () => {
    const rejected = new Error("User rejected");
    rejected.name = "WalletStandardError";
    (rejected as Error & { context: { __code: number } }).context = { __code: 4001000 };
    expect(resultForWalletError(rejected)).toMatchObject({
      status: "rejected",
      failureReason: "user_rejected"
    });

    expect(resultForWalletError(new Error("User rejected"))).toMatchObject({
      status: "failed",
      failureReason: "wallet_provider_error"
    });
  });

  it("sanitizes provider error details", () => {
    expect(sanitizeFailureDetail("  provider\nfailed\tbadly  ")).toBe("provider failed badly");
    expect(sanitizeFailureDetail("x".repeat(600))?.length).toBe(500);
  });
});
