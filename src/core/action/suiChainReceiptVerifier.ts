import type { SuiClientTypes } from "@mysten/sui/client";
import { assertNoForbiddenMcpFields } from "./forbiddenFields.js";
import {
  SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE,
  type SuiChainReceiptAccountBalanceChange,
  type SuiChainReceiptEffectsStatus,
  type SuiChainReceiptEvidence,
  type SuiChainReceiptIncludeField,
  type SuiChainReceiptPackageCall,
  suiChainReceiptEvidenceSchema
} from "./suiChainReceiptEvidence.js";
import { normalizeCoinType } from "../read/coinMetadata.js";
import { parseSuiAddress, suiTransactionDigestSchema } from "../suiAddress.js";

type ChainReceiptInclude = { [Field in SuiChainReceiptIncludeField]: true };

export const SUI_CHAIN_RECEIPT_GET_TRANSACTION_INCLUDE = includeObjectFromFields(
  SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE
);

export type SuiChainReceiptVerifierClient = {
  core: {
    getChainIdentifier(): Promise<SuiClientTypes.GetChainIdentifierResponse>;
    getTransaction(
      options: SuiClientTypes.GetTransactionOptions<ChainReceiptInclude>
    ): Promise<SuiClientTypes.TransactionResult<ChainReceiptInclude>>;
  };
};

export type VerifySuiChainReceiptInput = {
  txDigest: string;
  reviewedTransactionDigest: string;
  account: string;
  now: Date;
};

export type VerifySuiChainReceiptOptions = {
  client: SuiChainReceiptVerifierClient;
  network: "mainnet";
  expectedChainIdentifier: string;
};

export type SuiChainReceiptVerificationResult =
  | {
      status: "verified_success";
      receipt: SuiChainReceiptEvidence;
    }
  | {
      status: "verified_failure";
      failureReason: "chain_execution_failed";
      message: string;
      receipt: SuiChainReceiptEvidence;
    }
  | {
      status: "not_found";
      failureReason: "chain_receipt_unavailable";
      message: string;
    }
  | {
      status: "verification_failed";
      failureReason: "receipt_verification_failed";
      message: string;
    };

export async function verifySuiChainReceipt(
  options: VerifySuiChainReceiptOptions,
  input: VerifySuiChainReceiptInput
): Promise<SuiChainReceiptVerificationResult> {
  const parsedInput = parseVerifierInput(input);
  if (!parsedInput.ok) {
    return verificationFailed(parsedInput.message);
  }

  if (options.network !== "mainnet") {
    return verificationFailed("Chain receipt verification requires a verified Sui mainnet endpoint.");
  }

  let chainIdentifier: string;
  try {
    const chainIdentifierResult = await options.client.core.getChainIdentifier();
    chainIdentifier = chainIdentifierResult.chainIdentifier;
  } catch (error) {
    return verificationFailed(errorMessage(error, "Sui mainnet chain identifier lookup failed."));
  }
  if (chainIdentifier !== options.expectedChainIdentifier) {
    return verificationFailed("Chain receipt verification requires a verified Sui mainnet endpoint.");
  }

  let result: SuiClientTypes.TransactionResult<ChainReceiptInclude>;
  try {
    result = await options.client.core.getTransaction({
      digest: parsedInput.txDigest,
      include: SUI_CHAIN_RECEIPT_GET_TRANSACTION_INCLUDE
    });
  } catch (error) {
    if (isReceiptUnavailableError(error)) {
      return {
        status: "not_found",
        failureReason: "chain_receipt_unavailable",
        message: "Sui mainnet did not return a transaction for the signed digest."
      };
    }
    return verificationFailed(errorMessage(error, "Sui mainnet transaction lookup failed."));
  }

  try {
    const transaction = result.$kind === "Transaction" ? result.Transaction : result.FailedTransaction;
    const receipt = createSuiChainReceiptEvidenceFromTransaction({
      transaction,
      txDigest: parsedInput.txDigest,
      reviewedTransactionDigest: parsedInput.reviewedTransactionDigest,
      account: parsedInput.account,
      chainIdentifier,
      fetchedAt: parsedInput.now
    });
    if (!receipt.effectsStatus.success) {
      return {
        status: "verified_failure",
        failureReason: "chain_execution_failed",
        message: "Sui mainnet verified the transaction receipt and reported failed execution effects.",
        receipt
      };
    }
    return { status: "verified_success", receipt };
  } catch (error) {
    return verificationFailed(errorMessage(error, "Sui mainnet transaction receipt could not be verified."));
  }
}

function includeObjectFromFields(fields: readonly SuiChainReceiptIncludeField[]): ChainReceiptInclude {
  return Object.fromEntries(fields.map((field) => [field, true])) as ChainReceiptInclude;
}

function parseVerifierInput(input: VerifySuiChainReceiptInput):
  | { ok: true; txDigest: string; reviewedTransactionDigest: string; account: string; now: Date }
  | { ok: false; message: string } {
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    return { ok: false, message: "Chain receipt fetchedAt time must be a valid Date." };
  }
  const txDigest = suiTransactionDigestSchema.safeParse(input.txDigest);
  if (!txDigest.success) {
    return { ok: false, message: "Signed transaction digest is not a valid Sui transaction digest." };
  }
  const reviewedTransactionDigest = suiTransactionDigestSchema.safeParse(input.reviewedTransactionDigest);
  if (!reviewedTransactionDigest.success) {
    return { ok: false, message: "Reviewed transaction digest is not a valid Sui transaction digest." };
  }
  const account = parseSuiAddress(input.account);
  if (!account) {
    return { ok: false, message: "Reviewed account is not a valid Sui address." };
  }
  return {
    ok: true,
    txDigest: txDigest.data,
    reviewedTransactionDigest: reviewedTransactionDigest.data,
    account,
    now: input.now
  };
}

function createSuiChainReceiptEvidenceFromTransaction(input: {
  transaction: SuiClientTypes.Transaction<ChainReceiptInclude>;
  txDigest: string;
  reviewedTransactionDigest: string;
  account: string;
  chainIdentifier: string;
  fetchedAt: Date;
}): SuiChainReceiptEvidence {
  if (input.txDigest !== input.reviewedTransactionDigest) {
    throw new Error("Signed transaction digest does not match the reviewed transaction digest.");
  }
  if (input.transaction.digest !== input.txDigest) {
    throw new Error("Sui mainnet returned a transaction digest that does not match the signed digest.");
  }
  const transactionData = input.transaction.transaction;
  if (!transactionData) {
    throw new Error("Sui mainnet receipt is missing parsed transaction data.");
  }
  const effects = input.transaction.effects;
  if (!effects) {
    throw new Error("Sui mainnet receipt is missing transaction effects.");
  }
  if (effects.transactionDigest !== input.txDigest) {
    throw new Error("Sui mainnet receipt effects digest does not match the signed digest.");
  }
  const sender = transactionData.sender === null || transactionData.sender === undefined
    ? undefined
    : parseSuiAddress(transactionData.sender);
  if (!sender) {
    throw new Error("Sui mainnet receipt is missing a valid sender.");
  }
  if (sender !== input.account) {
    throw new Error("Sui mainnet receipt sender does not match the reviewed account.");
  }
  if (!input.transaction.balanceChanges) {
    throw new Error("Sui mainnet receipt is missing balance changes.");
  }
  if (!input.transaction.objectTypes) {
    throw new Error("Sui mainnet receipt is missing object type map.");
  }

  const receipt = {
    kind: "sui_chain_receipt_v1",
    source: {
      method: "client.core.getTransaction",
      network: "sui:mainnet",
      chainIdentifier: input.chainIdentifier,
      fetchedAt: input.fetchedAt.toISOString(),
      include: [...SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE]
    },
    txDigest: input.txDigest,
    sender,
    effectsStatus: effectsStatusFromSdk(effects.status),
    packageCalls: packageCallsFromTransaction(transactionData),
    accountBalanceChanges: accountBalanceChangesFromSdk(input.transaction.balanceChanges, input.account),
    objectTypes: objectTypesFromSdk(input.transaction.objectTypes)
  } satisfies SuiChainReceiptEvidence;
  const parsed = suiChainReceiptEvidenceSchema.parse(receipt);
  assertNoForbiddenMcpFields(parsed);
  return parsed;
}

function packageCallsFromTransaction(
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
    return [{
      commandIndex,
      packageId,
      module: moveCall.module,
      function: moveCall.function,
      target: `${packageId}::${moveCall.module}::${moveCall.function}`
    }];
  });
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

function accountBalanceChangesFromSdk(
  balanceChanges: SuiClientTypes.BalanceChange[],
  account: string
): SuiChainReceiptAccountBalanceChange[] {
  return balanceChanges.flatMap((change, index) => {
    const address = parseSuiAddress(change.address);
    if (!address) {
      throw new Error("Sui mainnet receipt contains a balance change with an invalid address.");
    }
    if (address !== account) {
      return [];
    }
    const amount = BigInt(change.amount);
    return [{
      index,
      coinType: normalizeCoinType(change.coinType),
      amountRaw: amount.toString(),
      direction: amount > 0n ? "increase" : amount < 0n ? "decrease" : "zero"
    }];
  });
}

function objectTypesFromSdk(objectTypes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(objectTypes).map(([objectId, objectType]) => {
    const normalizedObjectId = parseSuiAddress(objectId);
    if (!normalizedObjectId) {
      throw new Error("Sui mainnet receipt contains an invalid object id in objectTypes.");
    }
    return [normalizedObjectId, objectType];
  }));
}

function effectsStatusFromSdk(status: SuiClientTypes.ExecutionStatus): SuiChainReceiptEffectsStatus {
  if (status.success) {
    return { success: true };
  }
  const error = status.error;
  const errorKind = typeof error === "object" && error !== null && typeof error.$kind === "string"
    ? error.$kind.slice(0, 200)
    : undefined;
  const errorMessage = typeof error === "object" && error !== null &&
    typeof error.message === "string" &&
    error.message.length > 0
    ? error.message.slice(0, 2000)
    : undefined;
  return {
    success: false,
    ...(errorKind === undefined ? {} : { errorKind }),
    ...(errorMessage === undefined ? {} : { errorMessage })
  };
}

function verificationFailed(message: string): SuiChainReceiptVerificationResult {
  return {
    status: "verification_failed",
    failureReason: "receipt_verification_failed",
    message
  };
}

function isReceiptUnavailableError(error: unknown): boolean {
  const code = errorCode(error);
  if (
    code === "NOT_FOUND" ||
    code === "NotFound" ||
    code === "NOT_FOUND_ERROR" ||
    code === 5
  ) {
    return true;
  }
  return /\b(not found|not indexed|not available|could not find|unable to find|no transaction)\b/i.test(
    errorMessage(error, "")
  );
}

function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const value = (error as { code?: unknown; status?: unknown }).code ??
    (error as { status?: unknown }).status;
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function errorMessage(error: unknown, fallback: string): string {
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
