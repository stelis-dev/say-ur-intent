export const SUI_MAINNET_WALLET_CHAIN = "sui:mainnet" as const;

export type WalletIdentityResultPayload =
  | {
      status: "connected";
      account: string;
      chain: typeof SUI_MAINNET_WALLET_CHAIN;
      walletName?: string | undefined;
      walletId?: string | undefined;
    }
  | {
      status: "rejected";
      failureReason: "user_rejected";
      failureDetail?: string | undefined;
      walletName?: string | undefined;
      walletId?: string | undefined;
    }
  | {
      status: "failed";
      failureReason:
        | "no_compatible_wallet"
        | "no_accounts_authorized"
        | "unsupported_chain"
        | "wallet_provider_error";
      failureDetail?: string | undefined;
      walletName?: string | undefined;
      walletId?: string | undefined;
    };

export type WalletAccountLike = {
  address: string;
  chains: readonly string[];
};

export type WalletMetadata = {
  walletName?: string | undefined;
  walletId?: string | undefined;
};

const WALLET_STANDARD_USER_REJECTED_CODE = 4001000;

export function resultForConnectedAccount(
  account: WalletAccountLike | undefined,
  metadata: WalletMetadata = {}
): WalletIdentityResultPayload {
  if (!account) {
    return { status: "failed", failureReason: "no_accounts_authorized", ...metadata };
  }
  if (!account.chains.includes(SUI_MAINNET_WALLET_CHAIN)) {
    return {
      status: "failed",
      failureReason: "unsupported_chain",
      failureDetail: sanitizeFailureDetail(`Account is not authorized for ${SUI_MAINNET_WALLET_CHAIN}`),
      ...metadata
    };
  }
  return {
    status: "connected",
    account: account.address,
    chain: SUI_MAINNET_WALLET_CHAIN,
    ...metadata
  };
}

export function resultForNoCompatibleWallet(): WalletIdentityResultPayload {
  return { status: "failed", failureReason: "no_compatible_wallet" };
}

export function resultForWalletError(
  error: unknown,
  metadata: WalletMetadata = {}
): WalletIdentityResultPayload {
  if (isWalletStandardUserRejected(error)) {
    return {
      status: "rejected",
      failureReason: "user_rejected",
      failureDetail: sanitizeFailureDetail(error instanceof Error ? error.message : undefined),
      ...metadata
    };
  }
  return {
    status: "failed",
    failureReason: "wallet_provider_error",
    failureDetail: sanitizeFailureDetail(error instanceof Error ? error.message : String(error)),
    ...metadata
  };
}

export function sanitizeFailureDetail(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return sanitized ? sanitized.slice(0, 500) : undefined;
}

export function isWalletStandardUserRejected(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "WalletStandardError") {
    return false;
  }
  const context = (error as { context?: { __code?: unknown } }).context;
  return context?.__code === WALLET_STANDARD_USER_REJECTED_CODE;
}
