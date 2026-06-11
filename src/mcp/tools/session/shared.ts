import { z } from "zod";
import {
  executionPollingStatusSchema
} from "../../../core/action/schemas.js";
import { EXECUTION_STATUS_CATEGORIES } from "../../../core/session/status.js";
import {
  SUI_MAINNET_WALLET_CHAIN,
  walletIdentityFailureReasonSchema,
  walletIdentityPollingHint,
  walletIdentityStatusSchema,
  type WalletIdentitySession
} from "../../../core/session/walletIdentity.js";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS
} from "../../../core/session/wait.js";

export const INTERACTION_STATUS_LIMIT = 5;

export function walletIdentityPollingHintSchema() {
  return z.object({
    nonTerminalStatuses: z.array(walletIdentityStatusSchema),
    terminalStatuses: z.array(walletIdentityStatusSchema),
    recommendedIntervalSeconds: z.number().int().positive()
  });
}

export function executionPollingHintSchema() {
  return z.object({
    nonTerminalStatuses: z.array(executionPollingStatusSchema),
    waitStoppingStatuses: z.array(executionPollingStatusSchema),
    finalStatuses: z.array(executionPollingStatusSchema),
    userActionRequiredStatuses: z.array(executionPollingStatusSchema),
    recommendedIntervalSeconds: z.number().int().positive()
  });
}

export function executionStatusCategorySchema() {
  return z.enum(EXECUTION_STATUS_CATEGORIES);
}

export function waitWalletIdentityInputSchema() {
  return {
    walletSessionId: z.string().min(1),
    timeoutMs: z.number().int().min(1).max(MAX_WAIT_TIMEOUT_MS).default(DEFAULT_WAIT_TIMEOUT_MS).optional()
  };
}

export function waitExecutionInputSchema() {
  return {
    reviewSessionId: z.string().min(1),
    timeoutMs: z.number().int().min(1).max(MAX_WAIT_TIMEOUT_MS).default(DEFAULT_WAIT_TIMEOUT_MS).optional()
  };
}

export function walletIdentityResponse(session: WalletIdentitySession) {
  return {
    walletSessionId: session.id,
    status: session.status,
    account: session.status === "connected" ? session.account : undefined,
    chain: session.status === "connected" ? session.chain : undefined,
    walletName:
      session.status === "connected" || session.status === "rejected" || session.status === "failed"
        ? session.walletName
        : undefined,
    walletId:
      session.status === "connected" || session.status === "rejected" || session.status === "failed"
        ? session.walletId
        : undefined,
    failureReason: session.status === "rejected" || session.status === "failed" ? session.failureReason : undefined,
    failureDetail: session.status === "rejected" || session.status === "failed" ? session.failureDetail : undefined,
    expiresAt: session.expiresAt,
    lastActivityAt: session.lastActivityAt,
    pollingHint: walletIdentityPollingHint()
  };
}

export function walletIdentityOutputSchema() {
  return {
    walletSessionId: z.string(),
    status: walletIdentityStatusSchema,
    account: z.string().optional(),
    chain: z.literal(SUI_MAINNET_WALLET_CHAIN).optional(),
    walletName: z.string().optional(),
    walletId: z.string().optional(),
    failureReason: walletIdentityFailureReasonSchema.optional(),
    failureDetail: z.string().optional(),
    expiresAt: z.string(),
    lastActivityAt: z.string(),
    pollingHint: walletIdentityPollingHintSchema()
  };
}

export function latest<T extends { lastActivityAt: string }>(items: T[]) {
  const sorted = [...items].sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
  return {
    limit: INTERACTION_STATUS_LIMIT,
    items: sorted.slice(0, INTERACTION_STATUS_LIMIT),
    truncated: sorted.length > INTERACTION_STATUS_LIMIT
  };
}
