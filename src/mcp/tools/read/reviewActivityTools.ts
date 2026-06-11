import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  actionPlanSchema,
  executionResultSchema,
  internalSessionStatusSchema,
  reviewStateOutputSchema,
  unknownRecordSchema
} from "../../../core/action/schemas.js";
import {
  REVIEW_ACTIVITY_LIST_DEFAULT_LIMIT,
  REVIEW_ACTIVITY_LIST_MAX_LIMIT,
  REVIEW_ACTIVITY_LOW_SAMPLE_THRESHOLD
} from "../../../core/activity/activityStore.js";
import { successOutputSchema } from "../../schemas.js";
import { okToolResult } from "../../result.js";
import type { McpServerDeps } from "../../server.js";
import { TOOL_NAMES } from "../../toolNames.js";
import {
  reviewActivityListUserAnswerUse,
  reviewFunnelUserAnswerUse,
  reviewSessionDetailUserAnswerUse
} from "../../responseGuidance.js";
import {
  fetchedAtSchema,
  reviewActivityAccountSourceSchema,
  reviewActivityDataScopeSchema,
  reviewActivityInputSchema,
  userAnswerUseSchema
} from "./commonSchemas.js";
import { activityStoreReadError } from "./readToolHelpers.js";

const reviewActivityCommonOutput = {
  dataScope: reviewActivityDataScopeSchema,
  accountSource: reviewActivityAccountSourceSchema,
  userAnswerUse: userAnswerUseSchema,
  lowSampleWarning: z.boolean(),
  lowSampleThreshold: z.literal(REVIEW_ACTIVITY_LOW_SAMPLE_THRESHOLD),
  truncated: z.object({
    activities: z.boolean(),
    snapshots: z.boolean(),
    transitions: z.boolean()
  })
};

const reviewActivityRowSchema = z.object({
  reviewSessionId: z.string(),
  planId: z.string(),
  actionKind: z.string(),
  adapterId: z.string(),
  protocol: z.string(),
  currentStatus: internalSessionStatusSchema,
  account: z.string(),
  createdAt: fetchedAtSchema,
  updatedAt: fetchedAtSchema,
  executionStatus: z.string().optional(),
  txDigest: z.string().optional(),
  snapshotCount: z.number().int().nonnegative(),
  transitionCount: z.number().int().nonnegative()
});

export function registerReviewActivityListTool(server: McpServer, deps: McpServerDeps): void {
  server.registerTool(
    TOOL_NAMES.readListReviewActivity,
    {
      title: "List review activity",
      description: "List local Say Ur Intent review-session records for one account. Not wallet transaction history.",
      inputSchema: {
        ...reviewActivityInputSchema,
        status: internalSessionStatusSchema.optional(),
        limit: z.number().int().min(1).max(REVIEW_ACTIVITY_LIST_MAX_LIMIT).optional()
      },
      outputSchema: successOutputSchema({
        ...reviewActivityCommonOutput,
        activities: z.array(reviewActivityRowSchema)
      }),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ account, from, to, status, limit }) => {
      try {
        const result = await deps.activityStore.listReviewActivity({
          account,
          from,
          to,
          status,
          limit: limit ?? REVIEW_ACTIVITY_LIST_DEFAULT_LIMIT
        });
        return okToolResult({
          ...result,
          userAnswerUse: reviewActivityListUserAnswerUse()
        });
      } catch (error) {
        return activityStoreReadError(error, deps);
      }
    }
  );
}

export function registerReviewActivitySummaryTools(server: McpServer, deps: McpServerDeps): void {
  server.registerTool(
    TOOL_NAMES.readSummarizeReviewFunnel,
    {
      title: "Summarize review funnel",
      description: "Lifecycle counts for local Say Ur Intent review sessions in one account scope.",
      inputSchema: reviewActivityInputSchema,
      outputSchema: successOutputSchema({
        ...reviewActivityCommonOutput,
        summary: z.object({
          total: z.number().int().nonnegative(),
          opened: z.number().int().nonnegative(),
          walletConnected: z.number().int().nonnegative(),
          stateComputed: z.number().int().nonnegative(),
          currentStatusCounts: unknownRecordSchema,
          everReachedReviewStateCounts: z.object({
            ready_for_wallet_review: z.number().int().nonnegative(),
            blocked: z.number().int().nonnegative(),
            refresh_required: z.number().int().nonnegative()
          }),
          signedPending: z.number().int().nonnegative(),
          success: z.number().int().nonnegative(),
          failure: z.number().int().nonnegative(),
          expiredBeforeResult: z.number().int().nonnegative(),
          avgCreatedToSignedSeconds: z.number().nullable(),
          avgOpenedToSignedSeconds: z.number().nullable()
        })
      }),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ account, from, to }) => {
      try {
        const result = await deps.activityStore.summarizeReviewFunnel({ account, from, to });
        return okToolResult({
          ...result,
          userAnswerUse: reviewFunnelUserAnswerUse()
        });
      } catch (error) {
        return activityStoreReadError(error, deps);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.readGetReviewSessionDetail,
    {
      title: "Get review session detail",
      description: "Return one stored Say Ur Intent review session with plan, snapshots, transitions, and result.",
      inputSchema: {
        reviewSessionId: z.string().min(1),
        account: z.string().min(1).optional()
      },
      outputSchema: successOutputSchema({
        ...reviewActivityCommonOutput,
        session: reviewActivityRowSchema.omit({
          executionStatus: true,
          txDigest: true,
          snapshotCount: true,
          transitionCount: true
        }),
        planJson: actionPlanSchema,
        intentJson: z.unknown().optional(),
        stateSnapshots: z.array(
          z.object({
            id: z.number().int().positive(),
            planId: z.string(),
            account: z.string(),
            status: z.string(),
            blockedReason: z.string().optional(),
            refreshReason: z.string().optional(),
            stateJson: reviewStateOutputSchema,
            updatedAt: fetchedAtSchema,
            recordedAt: fetchedAtSchema
          })
        ),
        transitions: z.array(
          z.object({
            id: z.number().int().positive(),
            event: z.string(),
            fromStatus: z.string().optional(),
            toStatus: z.string(),
            isNoOp: z.boolean(),
            account: z.string().optional(),
            reason: z.string().optional(),
            transitionedAt: fetchedAtSchema
          })
        ),
        execution: z
          .object({
            reviewSessionId: z.string(),
            planId: z.string(),
            accountId: z.number().int().positive(),
            account: z.string(),
            status: z.string(),
            txDigest: z.string().optional(),
            explorerUrl: z.string().optional(),
            failureReason: z.string().optional(),
            recordedAt: fetchedAtSchema,
            updatedAt: fetchedAtSchema,
            resultJson: executionResultSchema
          })
          .optional()
      }),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ reviewSessionId, account }) => {
      try {
        const result = await deps.activityStore.getReviewSessionDetail({ reviewSessionId, account });
        return okToolResult({
          ...result,
          userAnswerUse: reviewSessionDetailUserAnswerUse(result.execution !== undefined)
        });
      } catch (error) {
        return activityStoreReadError(error, deps);
      }
    }
  );
}
