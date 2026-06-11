import { SNIPPET_LIMIT } from "./sui-cli-transaction-diagnostics-types.js";

export function snippet(source: string): string {
  return redactSensitive(source).slice(0, SNIPPET_LIMIT);
}

// This pattern is the single source of truth for output redaction and alias input rejection.
// Widening it tightens both emitted JSON sanitization and accepted CLI alias values.
export function redactSensitive(source: string): string {
  return source
    .replace(/suiprivkey[1-9A-HJ-NP-Za-km-z]*/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(private[\s_-]?key|mnemonic|transaction[\s_-]?bytes|signature|signed[\s_-]?transaction)\b/gi, "[REDACTED_SENSITIVE_TERM]");
}

export function containsSensitiveMaterial(source: string): boolean {
  return redactSensitive(source) !== source;
}

export function containsPrivateKeyMaterial(source: string): boolean {
  return /suiprivkey[1-9A-HJ-NP-Za-km-z]*/i.test(source);
}
