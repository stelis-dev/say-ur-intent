import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  SUI_MAINNET_WALLET_CHAIN,
  walletIdentityFailureReasonSchema,
  walletIdentityPollingHint,
  walletIdentityStatusSchema
} from "../../../core/session/walletIdentity.js";
import {
  waitForWalletIdentitySession,
  walletStatusCategory
} from "../../../core/session/wait.js";
import type { McpServerDeps } from "../../server.js";
import { errorToolResult, okToolResult } from "../../result.js";
import { noParamsInputSchema, successOutputSchema } from "../../schemas.js";
import { sessionStoreToolError } from "../../toolErrors.js";
import { TOOL_NAMES } from "../../toolNames.js";
import { walletIdentityUserAnswerUse } from "../../responseGuidance.js";
import { userAnswerUseSchema } from "../read/commonSchemas.js";
import {
  waitWalletIdentityInputSchema,
  walletIdentityOutputSchema,
  walletIdentityPollingHintSchema,
  walletIdentityResponse
} from "./shared.js";

export function registerWalletIdentityTools(server: McpServer, deps: McpServerDeps): void {
  server.registerTool(
    TOOL_NAMES.sessionCreateWalletIdentity,
    {
      title: "Create wallet identity capture",
      description: "Create a browser session that captures only a Sui mainnet address and chain identifier.",
      inputSchema: noParamsInputSchema,
      outputSchema: successOutputSchema({
        walletSessionId: z.string(),
        walletUrl: z.string(),
        openTarget: z.literal("system_browser"),
        accessScope: z.literal("same_machine_loopback"),
        status: walletIdentityStatusSchema,
        expiresAt: z.string(),
        lastActivityAt: z.string(),
        pollingHint: walletIdentityPollingHintSchema(),
        userAnswerUse: userAnswerUseSchema
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async () => {
      try {
        const created = await deps.sessions.createWalletIdentitySession();
        return okToolResult({
          walletSessionId: created.session.id,
          walletUrl: `${deps.reviewBaseUrl}/analysis/${created.session.id}#${created.token}`,
          openTarget: "system_browser",
          accessScope: "same_machine_loopback",
          status: created.session.status,
          expiresAt: created.session.expiresAt,
          lastActivityAt: created.session.lastActivityAt,
          pollingHint: walletIdentityPollingHint(),
          userAnswerUse: walletIdentityUserAnswerUse({ hasOpenFields: true })
        });
      } catch (error) {
        return sessionStoreToolError(error, deps.logger);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.sessionGetWalletIdentity,
    {
      title: "Get wallet identity capture status",
      description: "Return current status for a wallet identity capture session.",
      inputSchema: { walletSessionId: z.string().min(1) },
      outputSchema: successOutputSchema({
        ...walletIdentityOutputSchema(),
        userAnswerUse: userAnswerUseSchema
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async ({ walletSessionId }) => {
      try {
        const session = await deps.sessions.getWalletIdentitySession(walletSessionId);
        if (!session) {
          return errorToolResult({
            kind: "session_not_found",
            details: { walletSessionId }
          });
        }

        return okToolResult({
          ...walletIdentityResponse(session),
          userAnswerUse: walletIdentityUserAnswerUse({
            hasAccount: session.status === "connected",
            hasFailure: session.status === "rejected" || session.status === "failed"
          })
        });
      } catch (error) {
        return sessionStoreToolError(error, deps.logger);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.sessionWaitWalletIdentity,
    {
      title: "Wait for wallet identity capture",
      description: "Wait briefly for a wallet identity capture session to reach a terminal status.",
      inputSchema: waitWalletIdentityInputSchema(),
      outputSchema: successOutputSchema({
        waitOutcome: z.enum(["status_reached", "timed_out"]),
        walletSessionId: z.string(),
        status: walletIdentityStatusSchema,
        statusCategory: z.enum(["terminal", "non_terminal"]),
        account: z.string().optional(),
        chain: z.literal(SUI_MAINNET_WALLET_CHAIN).optional(),
        walletName: z.string().optional(),
        walletId: z.string().optional(),
        failureReason: walletIdentityFailureReasonSchema.optional(),
        failureDetail: z.string().optional(),
        expiresAt: z.string(),
        lastActivityAt: z.string(),
        pollingHint: walletIdentityPollingHintSchema(),
        userAnswerUse: userAnswerUseSchema
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async ({ walletSessionId, timeoutMs }, extra) => {
      try {
        const result = await waitForWalletIdentitySession(deps.sessions, walletSessionId, {
          timeoutMs,
          signal: extra.signal
        });
        return okToolResult({
          waitOutcome: result.waitOutcome,
          ...walletIdentityResponse(result.session),
          statusCategory: result.statusCategory,
          userAnswerUse: walletIdentityUserAnswerUse({
            hasAccount: result.session.status === "connected",
            hasFailure: result.session.status === "rejected" || result.session.status === "failed",
            hasWaitOutcome: true
          })
        });
      } catch (error) {
        return sessionStoreToolError(error, deps.logger);
      }
    }
  );
}
