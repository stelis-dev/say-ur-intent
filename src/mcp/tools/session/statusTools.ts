import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  executionPollingStatusSchema,
  internalSessionStatusSchema,
  reviewStateOutputSchema
} from "../../../core/action/schemas.js";
import { isTerminalWalletIdentityStatus, walletIdentityStatusSchema } from "../../../core/session/walletIdentity.js";
import { activeAccountResponse, activeAccountResponseSchema } from "../../activeAccountResponse.js";
import type { McpServerDeps } from "../../server.js";
import { errorToolResult, okToolResult } from "../../result.js";
import { noParamsInputSchema, successOutputSchema } from "../../schemas.js";
import { activityStoreToolError, sessionStoreToolError } from "../../toolErrors.js";
import { TOOL_NAMES } from "../../toolNames.js";
import { interactionStatusUserAnswerUse, reviewStatusUserAnswerUse } from "../../responseGuidance.js";
import { userAnswerUseSchema } from "../read/commonSchemas.js";
import {
  executionStatusCategory,
  type ExecutionStatusCategory,
  getExecutionPollingStatus,
  isInteractionPendingReviewStatus
} from "../../../core/session/status.js";
import { executionStatusCategorySchema, latest } from "./shared.js";

const INTERACTION_PENDING_REVIEW_STATUS_CATEGORIES = [
  "user_action_required",
  "awaiting_chain_result",
  "non_terminal"
] as const satisfies readonly ExecutionStatusCategory[];

export function registerSessionStatusTools(server: McpServer, deps: McpServerDeps): void {
  server.registerTool(
    TOOL_NAMES.sessionGetInteractionStatus,
    {
      title: "Get local interaction status",
      description: "Return active account context and pending local wallet or review interactions.",
      inputSchema: noParamsInputSchema,
      outputSchema: successOutputSchema({
        activeAccount: activeAccountResponseSchema,
        pendingWalletIdentitySessions: z.object({
          limit: z.number().int().positive(),
          items: z.array(
            z.object({
              walletSessionId: z.string(),
              status: walletIdentityStatusSchema,
              statusCategory: z.literal("non_terminal"),
              expiresAt: z.string(),
              lastActivityAt: z.string()
            })
          ),
          truncated: z.boolean()
        }),
        pendingReviewSessions: z.object({
          limit: z.number().int().positive(),
          items: z.array(
            z.object({
              reviewSessionId: z.string(),
              internalStatus: internalSessionStatusSchema,
              status: executionPollingStatusSchema,
              statusCategory: z.enum(INTERACTION_PENDING_REVIEW_STATUS_CATEGORIES),
              lastActivityAt: z.string()
            })
          ),
          truncated: z.boolean()
        }),
        userAnswerUse: userAnswerUseSchema
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async () => {
      let active: Awaited<ReturnType<typeof deps.activityStore.getActiveAccount>>;
      try {
        active = await deps.activityStore.getActiveAccount();
      } catch (error) {
        return activityStoreToolError(error, deps.logger);
      }

      try {
        const [walletSessions, reviewSessions] = await Promise.all([
          deps.sessions.listWalletIdentitySessions(),
          deps.sessions.listReviewSessions()
        ]);
        const pendingWallets = latest(
          walletSessions
            .filter((session) => !isTerminalWalletIdentityStatus(session.status))
            .map((session) => ({
              walletSessionId: session.id,
              status: session.status,
              statusCategory: "non_terminal" as const,
              expiresAt: session.expiresAt,
              lastActivityAt: session.lastActivityAt
            }))
        );
        const pendingReviews = latest(
          reviewSessions
            .map((session) => ({
              session,
              status: getExecutionPollingStatus(session)
            }))
            .filter(({ status }) => isInteractionPendingReviewStatus(status))
            .map(({ session, status }) => ({
              reviewSessionId: session.id,
              internalStatus: session.status,
              status,
              statusCategory: executionStatusCategory(status),
              lastActivityAt: session.lastActivityAt
            }))
        );

        return okToolResult({
          activeAccount: activeAccountResponse(active),
          pendingWalletIdentitySessions: pendingWallets,
          pendingReviewSessions: pendingReviews,
          userAnswerUse: interactionStatusUserAnswerUse()
        });
      } catch (error) {
        return sessionStoreToolError(error, deps.logger);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.sessionGetReviewStatus,
    {
      title: "Get review status",
      description: "Return the current status for a review session.",
      inputSchema: { reviewSessionId: z.string().min(1) },
      outputSchema: successOutputSchema({
        reviewSessionId: z.string(),
        internalStatus: internalSessionStatusSchema,
        pollingStatus: executionPollingStatusSchema,
        statusCategory: executionStatusCategorySchema(),
        lastActivityAt: z.string(),
        userAnswerUse: userAnswerUseSchema,
        reviewState: reviewStateOutputSchema.optional()
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async ({ reviewSessionId }) => {
      try {
        const session = await deps.sessions.getReviewSession(reviewSessionId);
        if (!session) {
          return errorToolResult({
            kind: "session_not_found",
            details: { reviewSessionId }
          });
        }

        const pollingStatus = getExecutionPollingStatus(session);
        return okToolResult({
          reviewSessionId: session.id,
          internalStatus: session.status,
          pollingStatus,
          statusCategory: executionStatusCategory(pollingStatus),
          lastActivityAt: session.lastActivityAt,
          userAnswerUse: reviewStatusUserAnswerUse(
            session.reviewState !== undefined,
            session.reviewState?.adapterLifecycle !== undefined,
            session.reviewState?.humanReadableReview !== undefined,
            session.reviewState?.simulation !== undefined
          ),
          reviewState: session.reviewState
        });
      } catch (error) {
        return sessionStoreToolError(error, deps.logger);
      }
    }
  );
}
