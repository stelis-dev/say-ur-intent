import type { SuiClientTypes } from "@mysten/sui/client";
import { parseSuiAddress } from "../suiAddress.js";
import type { SuiChainReceiptEffectsStatus, SuiChainReceiptPackageCall } from "./suiChainReceiptEvidence.js";

// Shared, pure mappers from the SDK getTransaction result to chain-receipt facts.
// Both the session-bound verifier (suiChainReceiptVerifier.ts) and the public
// receipt reader (suiChainReceiptReader.ts) use these so the effects-status,
// Move-call, and object-type shapes are mapped in one place. Balance changes are
// not here because the verifier filters them to the reviewed account while the
// public reader keeps them all, so each owns its own balance mapper.

export function effectsStatusFromSdk(status: SuiClientTypes.ExecutionStatus): SuiChainReceiptEffectsStatus {
  if (status.success) {
    return { success: true };
  }
  const error = status.error;
  const errorKind =
    typeof error === "object" && error !== null && typeof error.$kind === "string"
      ? error.$kind.slice(0, 200)
      : undefined;
  const errorMessage =
    typeof error === "object" && error !== null && typeof error.message === "string" && error.message.length > 0
      ? error.message.slice(0, 2000)
      : undefined;
  return {
    success: false,
    ...(errorKind === undefined ? {} : { errorKind }),
    ...(errorMessage === undefined ? {} : { errorMessage })
  };
}

export function packageCallsFromTransaction(
  transaction: SuiClientTypes.TransactionData
): SuiChainReceiptPackageCall[] {
  return transaction.commands.flatMap((command, commandIndex) => {
    const moveCall = moveCallFromCommand(command);
    if (!moveCall) {
      return [];
    }
    const packageId = parseSuiAddress(moveCall.package);
    if (!packageId) {
      throw new Error("Sui mainnet receipt contains a Move call with an invalid package id.");
    }
    return [
      {
        commandIndex,
        packageId,
        module: moveCall.module,
        function: moveCall.function,
        target: `${packageId}::${moveCall.module}::${moveCall.function}`
      }
    ];
  });
}

export function objectTypesFromSdk(objectTypes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(objectTypes).map(([objectId, objectType]) => {
      const normalizedObjectId = parseSuiAddress(objectId);
      if (!normalizedObjectId) {
        throw new Error("Sui mainnet receipt contains an invalid object id in objectTypes.");
      }
      return [normalizedObjectId, objectType];
    })
  );
}

// Fail-closed address parsing for receipt facts. Both the verifier and the
// public reader turn a raw chain address into a receipt address ONLY through
// this helper, so neither path can silently drop or null out a balance-change
// address or sender when the SDK payload is not the expected shape. A malformed
// address throws; callers map the throw to a fail-closed receipt outcome rather
// than returning partial facts.
export function requireReceiptAddress(
  rawAddress: string | null | undefined,
  errorMessage: string
): string {
  const address = rawAddress === null || rawAddress === undefined ? undefined : parseSuiAddress(rawAddress);
  if (!address) {
    throw new Error(errorMessage);
  }
  return address;
}

// Shared error classification for the getTransaction read, used by both the
// verifier and the public reader so a "transaction not found" is recognized one
// way everywhere.
export function isReceiptNotFoundError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null
      ? ((error as { code?: unknown; status?: unknown }).code ?? (error as { status?: unknown }).status)
      : undefined;
  if (code === "NOT_FOUND" || code === "NotFound" || code === "NOT_FOUND_ERROR" || code === 5) {
    return true;
  }
  // Only genuine "this digest does not exist / is not indexed" signals map to
  // not_found. Availability/outage phrasing (e.g. "service not available") is a
  // provider failure and must stay an `unavailable` (502), not a 404.
  return /\b(not found|not indexed|could not find|unable to find|no transaction)\b/i.test(
    receiptErrorMessage(error, "")
  );
}

export function receiptErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === "string") {
    return error || fallback;
  }
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return fallback;
}

function moveCallFromCommand(
  command: SuiClientTypes.TransactionData["commands"][number]
): { package: string; module: string; function: string } | undefined {
  const maybeCommand = command as {
    $kind?: string;
    MoveCall?: { package: string; module: string; function: string };
  };
  if (!maybeCommand.MoveCall) {
    return undefined;
  }
  if (maybeCommand.$kind !== undefined && maybeCommand.$kind !== "MoveCall") {
    return undefined;
  }
  return maybeCommand.MoveCall;
}
