import { describe, expect, it } from "vitest";
import { redactMeta } from "../src/runtime/logger.js";

describe("runtime logger redaction", () => {
  it("redacts sensitive keys recursively while preserving structure", () => {
    expect(
      redactMeta({
        requestId: "req_1",
        payload: {
          token: "secret-token",
          nested: [{ signature: "sig" }, { value: "visible" }]
        },
        responseBytes: 42
      })
    ).toEqual({
      requestId: "req_1",
      payload: {
        token: "[redacted]",
        nested: [{ signature: "[redacted]" }, { value: "visible" }]
      },
      responseBytes: "[redacted]"
    });
  });

  it("handles circular meta without treating repeated references as circular", () => {
    const shared = { value: "visible" };
    const circular: Record<string, unknown> = { sharedA: shared, sharedB: shared };
    circular.self = circular;

    expect(redactMeta(circular)).toEqual({
      sharedA: { value: "visible" },
      sharedB: { value: "visible" },
      self: { value: "[circular]" }
    });
  });
});
