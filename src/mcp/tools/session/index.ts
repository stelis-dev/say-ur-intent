import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerDeps } from "../../server.js";
import { registerExecutionResultTools } from "./executionResultTools.js";
import { registerSessionStatusTools } from "./statusTools.js";
import { registerWalletIdentityTools } from "./walletIdentityTools.js";

export function registerSessionTools(server: McpServer, deps: McpServerDeps): void {
  registerWalletIdentityTools(server, deps);
  registerSessionStatusTools(server, deps);
  registerExecutionResultTools(server, deps);
}
