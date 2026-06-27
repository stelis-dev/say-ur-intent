import { z } from "zod";
import { normalizedSuiAddressSchema } from "../suiAddress.js";
import type { LocalSessionBase } from "./localSession.js";
import {
  WALLET_IDENTITY_STATUSES,
  isTerminalWalletIdentityStatus,
  type WalletIdentityNonTerminalStatus,
  type WalletIdentityStatus,
  type WalletIdentityTerminalStatus
} from "./walletIdentityStatusContract.js";

// Re-export the shared status contract so existing importers of this module are
// unchanged; the literals, types, and terminal check live in the pure contract.
export { WALLET_IDENTITY_STATUSES, isTerminalWalletIdentityStatus };
export type { WalletIdentityNonTerminalStatus, WalletIdentityStatus, WalletIdentityTerminalStatus };

export const SUI_MAINNET_WALLET_CHAIN = "sui:mainnet" as const;

export const WALLET_IDENTITY_FAILURE_REASONS = [
  "user_rejected",
  "no_compatible_wallet",
  "no_accounts_authorized",
  "unsupported_chain",
  "wallet_provider_error"
] as const;

export type WalletIdentityFailureReason = (typeof WALLET_IDENTITY_FAILURE_REASONS)[number];
export type NonUserWalletIdentityFailureReason = Exclude<WalletIdentityFailureReason, "user_rejected">;

type WalletIdentityBase = LocalSessionBase & {
  status: WalletIdentityStatus;
};

export type ConnectedWalletIdentity = WalletIdentityBase & {
  status: "connected";
  account: string;
  chain: typeof SUI_MAINNET_WALLET_CHAIN;
  walletName?: string | undefined;
  walletId?: string | undefined;
  failureReason?: never;
  failureDetail?: never;
};

export type RejectedWalletIdentity = WalletIdentityBase & {
  status: "rejected";
  failureReason: "user_rejected";
  failureDetail?: string | undefined;
  account?: never;
  chain?: never;
  walletName?: string | undefined;
  walletId?: string | undefined;
};

export type FailedWalletIdentity = WalletIdentityBase & {
  status: "failed";
  failureReason: NonUserWalletIdentityFailureReason;
  failureDetail?: string | undefined;
  account?: never;
  chain?: never;
  walletName?: string | undefined;
  walletId?: string | undefined;
};

export type WalletIdentitySession =
  | (WalletIdentityBase & {
      status: WalletIdentityNonTerminalStatus | "expired";
      account?: never;
      chain?: never;
      walletName?: never;
      walletId?: never;
      failureReason?: never;
      failureDetail?: never;
    })
  | ConnectedWalletIdentity
  | RejectedWalletIdentity
  | FailedWalletIdentity;

export type WalletIdentityResultInput =
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
      failureReason: NonUserWalletIdentityFailureReason;
      failureDetail?: string | undefined;
      walletName?: string | undefined;
      walletId?: string | undefined;
    };

const isoDateStringSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected ISO 8601 UTC timestamp");

const walletSessionBaseSchema = {
  id: z.string(),
  tokenHash: z.string(),
  createdAt: isoDateStringSchema,
  expiresAt: isoDateStringSchema,
  lastActivityAt: isoDateStringSchema
} as const;

const failureDetailSchema = z.string().min(1).max(500).optional();

export const walletIdentityStatusSchema = z.enum(WALLET_IDENTITY_STATUSES);
export const walletIdentityFailureReasonSchema = z.enum(WALLET_IDENTITY_FAILURE_REASONS);
export const nonUserWalletIdentityFailureReasonSchema = z.enum([
  "no_compatible_wallet",
  "no_accounts_authorized",
  "unsupported_chain",
  "wallet_provider_error"
]);

export const walletIdentitySessionSchema: z.ZodType<WalletIdentitySession> = z.discriminatedUnion(
  "status",
  [
    z.object({ ...walletSessionBaseSchema, status: z.literal("pending") }),
    z.object({ ...walletSessionBaseSchema, status: z.literal("opened") }),
    z.object({ ...walletSessionBaseSchema, status: z.literal("connecting") }),
    z.object({
      ...walletSessionBaseSchema,
      status: z.literal("connected"),
      account: normalizedSuiAddressSchema,
      chain: z.literal(SUI_MAINNET_WALLET_CHAIN),
      walletName: z.string().min(1).optional(),
      walletId: z.string().min(1).optional()
    }),
    z.object({
      ...walletSessionBaseSchema,
      status: z.literal("rejected"),
      failureReason: z.literal("user_rejected"),
      failureDetail: failureDetailSchema,
      walletName: z.string().min(1).optional(),
      walletId: z.string().min(1).optional()
    }),
    z.object({
      ...walletSessionBaseSchema,
      status: z.literal("failed"),
      failureReason: nonUserWalletIdentityFailureReasonSchema,
      failureDetail: failureDetailSchema,
      walletName: z.string().min(1).optional(),
      walletId: z.string().min(1).optional()
    }),
    z.object({ ...walletSessionBaseSchema, status: z.literal("expired") })
  ]
);

export const walletIdentityResultInputSchema: z.ZodType<WalletIdentityResultInput> = z.discriminatedUnion(
  "status",
  [
    z.object({
      status: z.literal("connected"),
      account: normalizedSuiAddressSchema,
      chain: z.literal(SUI_MAINNET_WALLET_CHAIN),
      walletName: z.string().min(1).optional(),
      walletId: z.string().min(1).optional()
    }),
    z.object({
      status: z.literal("rejected"),
      failureReason: z.literal("user_rejected"),
      failureDetail: failureDetailSchema,
      walletName: z.string().min(1).optional(),
      walletId: z.string().min(1).optional()
    }),
    z.object({
      status: z.literal("failed"),
      failureReason: nonUserWalletIdentityFailureReasonSchema,
      failureDetail: failureDetailSchema,
      walletName: z.string().min(1).optional(),
      walletId: z.string().min(1).optional()
    })
  ]
);


export const WALLET_IDENTITY_POLLING_INTERVAL_SECONDS = 5;

export function walletIdentityPollingHint() {
  return {
    nonTerminalStatuses: ["pending", "opened", "connecting"] as WalletIdentityNonTerminalStatus[],
    terminalStatuses: ["connected", "rejected", "failed", "expired"] as WalletIdentityTerminalStatus[],
    recommendedIntervalSeconds: WALLET_IDENTITY_POLLING_INTERVAL_SECONDS
  };
}
