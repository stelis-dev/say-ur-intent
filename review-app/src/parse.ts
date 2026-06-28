// Shared defensive parsers for untrusted JSON payloads (server responses, on-chain
// metadata). One place to narrow `unknown`, so every page reader does it the same
// way instead of redefining these per file.

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
