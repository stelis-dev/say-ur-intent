import { describe, expect, it } from "vitest";
import { TOOL_NAMES, assertValidToolName } from "../src/mcp/toolNames.js";

describe("MCP tool names", () => {
  it("uses MCP-compatible permission prefixes", () => {
    for (const name of Object.values(TOOL_NAMES)) {
      expect(() => assertValidToolName(name)).not.toThrow();
      expect(name).not.toContain("/");
    }
  });
});
