import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const MCP_PROMPTS = [
  {
    name: "inspect-supported-sui-actions",
    title: "Inspect Supported Sui Actions",
    description: "Review current supported mainnet surfaces and tool status.",
    text: [
      "Inspect the Say Ur Intent MCP server status and supported mainnet Sui protocol surfaces.",
      "Use read.get_server_status first, then read.list_supported_protocols.",
      "Report implemented tools separately from unavailable or blocked surfaces."
    ].join("\n")
  },
  {
    name: "prepare-reviewable-sui-action",
    title: "Prepare Reviewable Sui Action",
    description: "Prepare a local review session for a supported action proposal.",
    text: [
      "Prepare a reviewable Sui action only through Say Ur Intent's review-session flow.",
      "Use action.prepare_external_proposal_review when the input is a structured external payment or Sui action proposal.",
      "External proposals get read-only local review and never become signing material. Use action.prepare_sui_action_review for a natural-language swap intent; after a wallet account is connected, account-bound review can reach ready_for_wallet_review, where the local review page offers digest-gated, user-controlled wallet signing.",
      "Show the reviewUrl and summarize the review checks. This MCP response never contains signing data, transaction bytes, or signing readiness; signing and execution receipts happen on the local review page."
    ].join("\n")
  }
] as const;

export function registerMcpPrompts(server: McpServer): void {
  for (const prompt of MCP_PROMPTS) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description
      },
      async () => ({
        description: prompt.description,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: prompt.text
            }
          }
        ]
      })
    );
  }
}
