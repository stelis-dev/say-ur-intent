import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerDeps } from "../../server.js";
import { registerDeepbookReadTools } from "./deepbookReadTools.js";
import { registerFlowxReadTools } from "./flowxReadTools.js";
import {
  registerReviewActivityListTool,
  registerReviewActivitySummaryTools
} from "./reviewActivityTools.js";
import {
  registerServerStatusTools,
  SUPPORTED_PROTOCOLS
} from "./serverStatusTools.js";
import { registerTransactionActivityTools } from "./transactionActivityTools.js";
import { registerWalletReadTools } from "./walletReadTools.js";

export { SUPPORTED_PROTOCOLS };

export function registerReadTools(server: McpServer, deps: McpServerDeps): void {
  registerServerStatusTools(server);
  registerDeepbookReadTools(server, deps);
  registerFlowxReadTools(server, deps);
  registerWalletReadTools(server, deps);
  registerReviewActivityListTool(server, deps);
  registerTransactionActivityTools(server, deps);
  registerReviewActivitySummaryTools(server, deps);
}
