import type { PublicChainReceipt, PublicChainReceiptBalanceChange } from "../../src/core/action/suiChainReceiptReader.js";
import type { SuiChainReceiptEffectsStatus, SuiChainReceiptPackageCall } from "../../src/core/action/suiChainReceiptEvidence.js";

// Pure, DOM-free validation of the /api/receipt response against the shared
// server SOT types. Kept out of receipt.ts so the fail-closed behaviour is unit
// tested directly (vitest runs in a node environment), not only asserted by a
// source grep.
//
// It validates EVERY field the page renders, down to each balance-change,
// Move-call, and object-type entry, and CONSTRUCTS the typed result instead of
// casting an unchecked value. A cast would lie about nested fields, so a drifted
// entry (e.g. a numeric amountRaw or a missing address) could render
// "undefined ..."; here any drift returns null and the page shows an error.
// Building the object also makes a future field added to the type a compile
// error here, so the validator cannot silently fall behind the type.
export function parseReceipt(value: unknown): PublicChainReceipt | null {
  const r = asRecord(value);
  if (!r) {
    return null;
  }
  if (typeof r.txDigest !== "string") {
    return null;
  }
  if (r.sender !== undefined && typeof r.sender !== "string") {
    return null;
  }
  if (typeof r.chainIdentifier !== "string") {
    return null;
  }
  if (typeof r.fetchedAt !== "string") {
    return null;
  }
  const effectsStatus = parseEffectsStatus(r.effectsStatus);
  if (!effectsStatus) {
    return null;
  }
  const balanceChanges = parseBalanceChanges(r.balanceChanges);
  if (!balanceChanges) {
    return null;
  }
  const packageCalls = parsePackageCalls(r.packageCalls);
  if (!packageCalls) {
    return null;
  }
  const objectTypes = parseObjectTypes(r.objectTypes);
  if (!objectTypes) {
    return null;
  }
  return {
    txDigest: r.txDigest,
    sender: r.sender,
    effectsStatus,
    packageCalls,
    balanceChanges,
    objectTypes,
    chainIdentifier: r.chainIdentifier,
    fetchedAt: r.fetchedAt
  };
}

function parseEffectsStatus(value: unknown): SuiChainReceiptEffectsStatus | null {
  const r = asRecord(value);
  if (!r || typeof r.success !== "boolean") {
    return null;
  }
  if (r.success) {
    return { success: true };
  }
  const status: { success: false; errorKind?: string; errorMessage?: string } = { success: false };
  if (r.errorKind !== undefined) {
    if (typeof r.errorKind !== "string") {
      return null;
    }
    status.errorKind = r.errorKind;
  }
  if (r.errorMessage !== undefined) {
    if (typeof r.errorMessage !== "string") {
      return null;
    }
    status.errorMessage = r.errorMessage;
  }
  return status;
}

function parseBalanceChanges(value: unknown): PublicChainReceiptBalanceChange[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const changes: PublicChainReceiptBalanceChange[] = [];
  for (const entry of value) {
    const r = asRecord(entry);
    if (!r) {
      return null;
    }
    if (typeof r.index !== "number") {
      return null;
    }
    if (typeof r.address !== "string" || typeof r.coinType !== "string" || typeof r.amountRaw !== "string") {
      return null;
    }
    if (r.direction !== "increase" && r.direction !== "decrease" && r.direction !== "zero") {
      return null;
    }
    changes.push({
      index: r.index,
      address: r.address,
      coinType: r.coinType,
      amountRaw: r.amountRaw,
      direction: r.direction
    });
  }
  return changes;
}

function parsePackageCalls(value: unknown): SuiChainReceiptPackageCall[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const calls: SuiChainReceiptPackageCall[] = [];
  for (const entry of value) {
    const r = asRecord(entry);
    if (!r) {
      return null;
    }
    if (typeof r.commandIndex !== "number") {
      return null;
    }
    if (
      typeof r.packageId !== "string" ||
      typeof r.module !== "string" ||
      typeof r.function !== "string" ||
      typeof r.target !== "string"
    ) {
      return null;
    }
    calls.push({
      commandIndex: r.commandIndex,
      packageId: r.packageId,
      module: r.module,
      function: r.function,
      target: r.target
    });
  }
  return calls;
}

function parseObjectTypes(value: unknown): Record<string, string> | null {
  if (Array.isArray(value)) {
    return null;
  }
  const r = asRecord(value);
  if (!r) {
    return null;
  }
  const objectTypes: Record<string, string> = {};
  for (const [objectId, objectType] of Object.entries(r)) {
    if (typeof objectType !== "string") {
      return null;
    }
    objectTypes[objectId] = objectType;
  }
  return objectTypes;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}
