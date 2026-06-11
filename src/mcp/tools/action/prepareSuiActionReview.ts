import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createDeepbookSwapActionPlan,
  deepbookSwapIntentInputSchema
} from "../../../adapters/deepbook/deepbookSwapIntent.js";
import { actionPlanSchema, reviewCheckSchema } from "../../../core/action/schemas.js";
import type { ActionPlan, McpActionResponse, ReviewCheck } from "../../../core/action/types.js";
import { externalProposalToActionPlan } from "../../../core/proposal/externalProposalReview.js";
import { externalProposalSchema } from "../../../core/proposal/schemas.js";
import {
  prepareActionReviewUserAnswerUse,
  prepareExternalProposalReviewUserAnswerUse
} from "../../responseGuidance.js";
import { registerSayUrIntentTool } from "../../registerTool.js";
import type { McpServerDeps } from "../../server.js";
import { successOutputSchema } from "../../schemas.js";
import { okToolResult } from "../../result.js";
import { sessionStoreToolError } from "../../toolErrors.js";
import { TOOL_NAMES } from "../../toolNames.js";
import { userAnswerUseSchema } from "../read/commonSchemas.js";

export function registerActionTools(server: McpServer, deps: McpServerDeps): void {
  server.registerTool(
    TOOL_NAMES.actionPrepareSuiActionReview,
    {
      title: "Prepare DeepBook swap review",
      description: "Create a local DeepBook swap review session. Returns a review URL; the local review page owns user-controlled signing, and this response contains no signing data.",
      inputSchema: {
        intent: deepbookSwapIntentInputSchema
      },
      outputSchema: successOutputSchema({
        reviewSessionId: z.string(),
        reviewUrl: z.string(),
        plans: z.array(actionPlanSchema),
        preliminaryChecks: z.array(reviewCheckSchema),
        userAnswerUse: userAnswerUseSchema
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    async ({ intent }) => {
      const now = new Date();
      const plan = createDeepbookSwapActionPlan(intent, now);

      try {
        const { session, token } = await deps.sessions.createReviewSession([plan], now);
        const preliminaryChecks: ReviewCheck[] = plan.preliminaryChecks ?? [];
        const hasBlockingPreliminaryChecks = preliminaryChecks.some((check) => check.status === "fail");
        const payload: McpActionResponse = {
          reviewSessionId: session.id,
          reviewUrl: `${deps.reviewBaseUrl}/review/${session.id}#${token}`,
          plans: session.plans,
          preliminaryChecks,
          userAnswerUse: prepareActionReviewUserAnswerUse({ hasBlockingPreliminaryChecks })
        };
        return okToolResult(payload);
      } catch (error) {
        return sessionStoreToolError(error, deps.logger);
      }
    }
  );

  registerSayUrIntentTool(
    server,
    TOOL_NAMES.actionPrepareExternalProposalReview,
    {
      title: "Prepare external proposal review",
      description: "Create a local non-signable review session from an untrusted external Sui proposal.",
      inputSchema: {
        proposal: externalProposalSchema
      },
      outputSchema: successOutputSchema({
        reviewSessionId: z.string(),
        reviewUrl: z.string(),
        plans: z.array(actionPlanSchema),
        preliminaryChecks: z.array(reviewCheckSchema),
        userAnswerUse: userAnswerUseSchema
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    async ({ proposal }) => {
      const now = new Date();
      const plan = externalProposalToActionPlan(proposal, now);

      try {
        const { session, token } = await deps.sessions.createReviewSession([plan], now);
        const preliminaryChecks: ReviewCheck[] = plan.preliminaryChecks ?? [];
        const payload: McpActionResponse = {
          reviewSessionId: session.id,
          reviewUrl: `${deps.reviewBaseUrl}/review/${session.id}#${token}`,
          plans: session.plans,
          preliminaryChecks,
          userAnswerUse: prepareExternalProposalReviewUserAnswerUse()
        };
        return okToolResult(payload);
      } catch (error) {
        return sessionStoreToolError(error, deps.logger);
      }
    }
  );
}
