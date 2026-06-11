import { describe, expect, it } from "vitest";
import { assertNoForbiddenMcpFields, findForbiddenMcpFields } from "../src/core/action/forbiddenFields.js";
import { errorToolResult, okToolResult } from "../src/mcp/result.js";

describe("MCP forbidden fields", () => {
  it("allows review session payload fields", () => {
    expect(() =>
      assertNoForbiddenMcpFields({
        reviewSessionId: "abc",
        reviewUrl: "http://127.0.0.1/review/abc#token",
        plans: [],
        preliminaryChecks: []
      })
    ).not.toThrow();
  });

  it("rejects transaction bytes and signatures", () => {
    const paths = findForbiddenMcpFields({
      transactionBytes: "abc",
      nested: { signature: "sig" }
    });

    expect(paths).toEqual(["$.transactionBytes", "$.nested.signature"]);
  });

  it("rejects session token material without blocking asset token metadata", () => {
    expect(
      findForbiddenMcpFields({
        sessionToken: "secret",
        nested: { tokenHash: "hash" },
        tokenSymbol: "SUI",
        bytesPerSecond: 1,
        presignableState: "draft",
        seedQueueLength: 0
      })
    ).toEqual(["$.sessionToken", "$.nested.tokenHash"]);
  });

  it("guards the MCP tool result path", () => {
    expect(() => okToolResult({ transactionBytes: "abc" })).toThrow("forbidden field");
  });

  it("guards the MCP tool error result path", () => {
    expect(() =>
      errorToolResult({
        kind: "internal_error",
        details: { responseBytes: "abc" }
      })
    ).toThrow("forbidden field");
  });

  it("keeps MCP error results out of output-schema structured content validation", () => {
    const result = errorToolResult({
      kind: "internal_error",
      details: { message: "failed" }
    });

    expect(result).toMatchObject({
      isError: true
    });
    expect(result).not.toHaveProperty("structuredContent");
  });
});
