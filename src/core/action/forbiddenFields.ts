const FORBIDDEN_EDGE_TERMS = [
  "bytes",
  "signature",
  "sessiontoken",
  "reviewtoken",
  "wallettoken",
  "fragmenttoken",
  "tokenhash",
  "privatekey",
  "secretkey",
  "seed",
  "mnemonic"
] as const;
const FORBIDDEN_PREFIX_OR_SUFFIX_TERMS = ["serialized", "signable"] as const;

function isForbiddenFieldKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    FORBIDDEN_EDGE_TERMS.some((term) => normalized === term || normalized.endsWith(term)) ||
    FORBIDDEN_PREFIX_OR_SUFFIX_TERMS.some(
      (term) => normalized === term || normalized.startsWith(term) || normalized.endsWith(term)
    )
  );
}

export function findForbiddenMcpFields(value: unknown, path = "$"): string[] {
  if (value === null || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenMcpFields(item, `${path}[${index}]`));
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const normalized = key.toLowerCase();
    const currentPath = `${path}.${key}`;
    // Deliberately conservative: MCP tool output and stored evidence should not
    // carry raw byte, signing, token, signature, seed, or key material under
    // direct prefix/suffix key names. Generic domain keys such as tokenSymbol
    // and bytesPerSecond remain valid.
    const current = isForbiddenFieldKey(normalized) ? [currentPath] : [];
    return current.concat(findForbiddenMcpFields(nested, currentPath));
  });
}

export function assertNoForbiddenMcpFields(value: unknown): void {
  const forbidden = findForbiddenMcpFields(value);
  if (forbidden.length > 0) {
    throw new Error(`MCP payload contains forbidden field(s): ${forbidden.join(", ")}`);
  }
}
