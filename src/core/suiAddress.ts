import { isValidSuiAddress, isValidTransactionDigest, normalizeSuiAddress } from "@mysten/sui/utils";
import { z } from "zod";

// Use the string-only schema at MCP/HTTP output boundaries because zod transforms
// cannot be represented in MCP JSON Schema. Use the normalized schema for values
// before storing them as local session state.
export const suiAddressStringSchema = z
  .string()
  .refine(isValidSuiAddress, "Expected a 32-byte Sui address");

// Shared Sui transaction digest schema (pinned SDK source of truth). Used at
// MCP/HTTP boundaries and by the signable-adapter commitment fields.
export const suiTransactionDigestSchema = z
  .string()
  .refine(isValidTransactionDigest, "Expected a Sui transaction digest");

export const normalizedSuiAddressSchema = suiAddressStringSchema.transform((value) =>
  normalizeSuiAddress(value)
);

export function parseSuiAddress(value: string): string | undefined {
  const parsed = normalizedSuiAddressSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
