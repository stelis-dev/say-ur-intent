import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  promptNameFor,
  shorthandActions,
  type AdapterPromptSurface
} from "../adapters/adapterPromptSurfaces.js";

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

// Platform-owned boundary language appended to every adapter prompt surface.
// Adapters contribute copy about their own action only; they cannot weaken
// or omit these lines.
const PLATFORM_PROMPT_BOUNDARY_LINES = [
  "Show the reviewUrl and summarize the review checks.",
  "This MCP response never contains signing data, transaction bytes, or signing readiness; signing and execution receipts happen on the local review page."
];

function surfacePromptText(surface: AdapterPromptSurface, intent: string): string {
  return [
    `Prepare a reviewable Sui mainnet ${surface.action} for this intent: "${intent}".`,
    `Parse the source amount, source symbol, and target symbol from the intent (any language) and call ${surface.toolName} with them.`,
    ...PLATFORM_PROMPT_BOUNDARY_LINES
  ].join("\n");
}

function registerSurfacePrompt(
  server: McpServer,
  name: string,
  surface: AdapterPromptSurface,
  description: string
): void {
  server.registerPrompt(
    name,
    {
      title: surface.title,
      description,
      argsSchema: {
        intent: z.string().describe(surface.intentArgDescription)
      }
    },
    async ({ intent }) => ({
      description,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: surfacePromptText(surface, intent)
          }
        }
      ]
    })
  );
}

export function registerMcpPrompts(server: McpServer, surfaces: readonly AdapterPromptSurface[] = []): void {
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

  // Adapter prompt surfaces: action-first names (`swap-deep`) with one
  // free-text intent argument so clients can pass the whole request in one
  // line (Claude Code: /mcp__say-ur-intent__swap-deep 10 sui to usdc;
  // Claude Desktop shows a single input field). The model parses the
  // intent; this server never does.
  for (const surface of surfaces) {
    registerSurfacePrompt(server, promptNameFor(surface), surface, surface.description);
  }
  // Bare action shorthands while the action has exactly one protocol.
  for (const [action, surface] of shorthandActions(surfaces)) {
    registerSurfacePrompt(
      server,
      action,
      surface,
      `${surface.description} Shorthand for ${promptNameFor(surface)}.`
    );
  }
}
