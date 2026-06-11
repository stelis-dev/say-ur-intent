import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  executionPollingStatusSchema,
  executionResultSchema
} from "../../../core/action/schemas.js";
import { waitForExecutionResult } from "../../../core/session/wait.js";
import type { McpServerDeps } from "../../server.js";
import { errorToolResult, okToolResult } from "../../result.js";
import { successOutputSchema } from "../../schemas.js";
import { sessionStoreToolError } from "../../toolErrors.js";
import { TOOL_NAMES } from "../../toolNames.js";
import { executionResultUserAnswerUse } from "../../responseGuidance.js";
import { userAnswerUseSchema } from "../read/commonSchemas.js";
import {
  executionPollingHint,
  executionStatusCategory,
  getExecutionPollingStatus
} from "../../../core/session/status.js";
import {
  executionPollingHintSchema,
  executionStatusCategorySchema,
  waitExecutionInputSchema
} from "./shared.js";

export function registerExecutionResultTools(server: McpServer, deps: McpServerDeps): void {
  server.registerTool(
    TOOL_NAMES.sessionGetExecutionResult,
    {
      title: "Get execution polling result",
      description: "Return execution polling status and any recorded result. No result exists until a signable adapter exists.",
      inputSchema: { reviewSessionId: z.string().min(1) },
      outputSchema: successOutputSchema({
        reviewSessionId: z.string(),
        status: executionPollingStatusSchema,
        statusCategory: executionStatusCategorySchema(),
        lastActivityAt: z.string(),
        pollingHint: executionPollingHintSchema(),
        executionResult: executionResultSchema.optional(),
        userAnswerUse: userAnswerUseSchema
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

        const status = getExecutionPollingStatus(session);
        return okToolResult({
          reviewSessionId: session.id,
          status,
          statusCategory: executionStatusCategory(status),
          lastActivityAt: session.lastActivityAt,
          pollingHint: executionPollingHint(),
          executionResult: session.executionResult,
          userAnswerUse: executionResultUserAnswerUse({
            hasExecutionResult: session.executionResult !== undefined
          })
        });
      } catch (error) {
        return sessionStoreToolError(error, deps.logger);
      }
    }
  );

  server.registerTool(
    TOOL_NAMES.sessionWaitExecutionResult,
    {
      title: "Wait for execution polling result",
      description: "Wait briefly for execution polling status to reach a wait-stopping status.",
      inputSchema: waitExecutionInputSchema(),
      outputSchema: successOutputSchema({
        waitOutcome: z.enum(["status_reached", "timed_out"]),
        reviewSessionId: z.string(),
        status: executionPollingStatusSchema,
        statusCategory: executionStatusCategorySchema(),
        lastActivityAt: z.string(),
        pollingHint: executionPollingHintSchema(),
        executionResult: executionResultSchema.optional(),
        userAnswerUse: userAnswerUseSchema
      }),
      annotations: { readOnlyHint: false, openWorldHint: false }
    },
    async ({ reviewSessionId, timeoutMs }, extra) => {
      try {
        const result = await waitForExecutionResult(deps.sessions, reviewSessionId, {
          timeoutMs,
          signal: extra.signal
        });
        return okToolResult({
          waitOutcome: result.waitOutcome,
          reviewSessionId: result.session.id,
          status: result.status,
          statusCategory: executionStatusCategory(result.status),
          lastActivityAt: result.session.lastActivityAt,
          pollingHint: executionPollingHint(),
          executionResult: result.session.executionResult,
          userAnswerUse: executionResultUserAnswerUse({
            hasExecutionResult: result.session.executionResult !== undefined,
            hasWaitOutcome: true
          })
        });
      } catch (error) {
        return sessionStoreToolError(error, deps.logger);
      }
    }
  );
}
