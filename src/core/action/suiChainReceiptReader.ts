import type { SuiClientTypes } from "@mysten/sui/client";
import { normalizeCoinType } from "../read/coinMetadata.js";
import { suiTransactionDigestSchema } from "../suiAddress.js";
import {
  effectsStatusFromSdk,
  isReceiptNotFoundError,
  objectTypesFromSdk,
  packageCallsFromTransaction,
  receiptErrorMessage,
  requireReceiptAddress
} from "./suiChainReceiptMapping.js";
import {
  SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE,
  type SuiChainReceiptEffectsStatus,
  type SuiChainReceiptIncludeField,
  type SuiChainReceiptPackageCall
} from "./suiChainReceiptEvidence.js";

// Public chain-receipt read: on-chain facts for ANY transaction digest, with no
// session, no reviewed-digest comparison, and no account filter. It keeps every
// balance change (each tagged with its address), unlike the session-bound
// verifier which keeps only the reviewed account's changes. The SDK read and the
// fact mappers are shared with the verifier through suiChainReceiptMapping.ts.
type ChainReceiptInclude = { [Field in SuiChainReceiptIncludeField]: true };

const PUBLIC_RECEIPT_INCLUDE = Object.fromEntries(
  SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE.map((field) => [field, true])
) as ChainReceiptInclude;

export type PublicChainReceiptBalanceChange = {
  index: number;
  address: string;
  coinType: string;
  amountRaw: string;
  direction: "increase" | "decrease" | "zero";
};

export type PublicChainReceipt = {
  txDigest: string;
  sender: string | undefined;
  effectsStatus: SuiChainReceiptEffectsStatus;
  packageCalls: SuiChainReceiptPackageCall[];
  balanceChanges: PublicChainReceiptBalanceChange[];
  objectTypes: Record<string, string>;
  chainIdentifier: string;
  fetchedAt: string;
};

export type PublicChainReceiptResult =
  | { status: "found"; receipt: PublicChainReceipt }
  | { status: "invalid_digest" }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };

export type PublicChainReceiptReaderClient = {
  core: {
    getChainIdentifier(): Promise<SuiClientTypes.GetChainIdentifierResponse>;
    getTransaction(
      options: SuiClientTypes.GetTransactionOptions<ChainReceiptInclude>
    ): Promise<SuiClientTypes.TransactionResult<ChainReceiptInclude>>;
  };
};

export type ReadPublicChainReceiptOptions = {
  client: PublicChainReceiptReaderClient;
  network: "mainnet";
  expectedChainIdentifier: string;
};

export async function readPublicChainReceipt(
  options: ReadPublicChainReceiptOptions,
  input: { digest: string; now: Date }
): Promise<PublicChainReceiptResult> {
  const digest = suiTransactionDigestSchema.safeParse(input.digest);
  if (!digest.success) {
    return { status: "invalid_digest" };
  }
  if (options.network !== "mainnet") {
    return { status: "unavailable", message: "Receipt reads require a verified Sui mainnet endpoint." };
  }

  let chainIdentifier: string;
  try {
    chainIdentifier = (await options.client.core.getChainIdentifier()).chainIdentifier;
  } catch (error) {
    return { status: "unavailable", message: receiptErrorMessage(error, "Sui mainnet chain identifier lookup failed.") };
  }
  if (chainIdentifier !== options.expectedChainIdentifier) {
    return { status: "unavailable", message: "Receipt reads require a verified Sui mainnet endpoint." };
  }

  let result: SuiClientTypes.TransactionResult<ChainReceiptInclude>;
  try {
    result = await options.client.core.getTransaction({ digest: digest.data, include: PUBLIC_RECEIPT_INCLUDE });
  } catch (error) {
    if (isReceiptNotFoundError(error)) {
      return { status: "not_found" };
    }
    return { status: "unavailable", message: receiptErrorMessage(error, "Sui mainnet transaction lookup failed.") };
  }

  const transaction = result.$kind === "Transaction" ? result.Transaction : result.FailedTransaction;
  const transactionData = transaction.transaction;
  const effects = transaction.effects;
  if (!transactionData || !effects || !transaction.balanceChanges || !transaction.objectTypes) {
    return { status: "unavailable", message: "Sui mainnet receipt is missing required fields." };
  }

  // Build receipt facts fail-closed: any malformed field (sender, Move calls,
  // balance-change address, object id) throws inside this block and maps to an
  // `unavailable` outcome, so the public receipt is never returned with silently
  // dropped or nulled facts and the mappers can never crash the request.
  let receipt: PublicChainReceipt;
  try {
    receipt = {
      txDigest: transaction.digest,
      // A present-but-unparseable sender is a malformed payload and fails closed.
      // An absent sender is legitimate for some system transactions, so it maps
      // to undefined. The account-bound verifier instead requires a sender
      // because it must match the reviewed account.
      sender:
        transactionData.sender === null || transactionData.sender === undefined
          ? undefined
          : requireReceiptAddress(transactionData.sender, "Sui mainnet receipt has an unparseable sender address."),
      effectsStatus: effectsStatusFromSdk(effects.status),
      packageCalls: packageCallsFromTransaction(transactionData),
      balanceChanges: balanceChangesFromSdk(transaction.balanceChanges),
      objectTypes: objectTypesFromSdk(transaction.objectTypes),
      chainIdentifier,
      fetchedAt: input.now.toISOString()
    };
  } catch (error) {
    return {
      status: "unavailable",
      message: receiptErrorMessage(error, "Sui mainnet receipt could not be read as expected facts.")
    };
  }
  return { status: "found", receipt };
}

function balanceChangesFromSdk(
  balanceChanges: SuiClientTypes.BalanceChange[]
): PublicChainReceiptBalanceChange[] {
  return balanceChanges.map((change, index) => {
    const address = requireReceiptAddress(
      change.address,
      "Sui mainnet receipt contains a balance change with an invalid address."
    );
    const amount = BigInt(change.amount);
    return {
      index,
      address,
      coinType: normalizeCoinType(change.coinType),
      amountRaw: amount.toString(),
      direction: amount > 0n ? "increase" : amount < 0n ? "decrease" : "zero"
    };
  });
}

