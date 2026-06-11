import type {
  McpServer,
  RegisteredTool,
  ToolCallback
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AnySchema,
  ZodRawShapeCompat
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_NAMES, assertValidToolName } from "./toolNames.js";

export type SayUrIntentToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

export type SayUrIntentToolConfig<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined
> = {
  title?: string;
  description?: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
  annotations?: ToolAnnotations;
  defaultAnnotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};

const DEFAULT_TOOL_ANNOTATIONS = {
  openWorldHint: false
} satisfies ToolAnnotations;

function mergedAnnotations(
  defaultAnnotations: ToolAnnotations | undefined,
  annotations: ToolAnnotations | undefined
): ToolAnnotations {
  return {
    ...DEFAULT_TOOL_ANNOTATIONS,
    ...(defaultAnnotations ?? {}),
    ...(annotations ?? {})
  };
}

export function registerSayUrIntentTool<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined
>(
  server: McpServer,
  name: SayUrIntentToolName,
  config: SayUrIntentToolConfig<OutputArgs, InputArgs>,
  callback: ToolCallback<InputArgs>
): RegisteredTool {
  assertValidToolName(name);
  const { defaultAnnotations, annotations, ...sdkConfig } = config;

  return server.registerTool(
    name,
    {
      ...sdkConfig,
      annotations: mergedAnnotations(defaultAnnotations, annotations)
    },
    callback
  );
}
