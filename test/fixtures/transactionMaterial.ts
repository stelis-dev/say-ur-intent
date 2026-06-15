import { Inputs, Transaction } from "@mysten/sui/transactions";
import type {
  LocalTransactionMaterialDigestCommitment,
  LocalTransactionMaterialHandle,
  LocalTransactionMaterialStore
} from "../../src/core/session/transactionMaterialStore.js";

export async function buildTestTransactionBytes(
  account: string,
  options: { includeSharedObject?: boolean | undefined; moveCallTarget?: string | undefined } = {}
): Promise<Uint8Array> {
  const transaction = new Transaction();
  transaction.setSender(account);
  transaction.setGasBudget(1000);
  transaction.setGasPrice(1);
  transaction.setGasPayment([
    {
      objectId: `0x${"b".repeat(64)}`,
      version: "1",
      digest: "7".repeat(44)
    }
  ]);
  if (options.moveCallTarget) {
    transaction.moveCall({
      target: options.moveCallTarget,
      arguments: [transaction.pure.u64(1n)]
    });
  }
  if (options.includeSharedObject) {
    const shared = transaction.object(
      Inputs.SharedObjectRef({
        objectId: `0x${"c".repeat(64)}`,
        initialSharedVersion: "1",
        mutable: false
      })
    );
    transaction.moveCall({
      target: "0x2::clock::timestamp_ms",
      arguments: [shared]
    });
  }
  return transaction.build();
}

export async function recordTestTransactionMaterial(input: {
  materialStore: Pick<LocalTransactionMaterialStore, "recordTransactionMaterial">;
  reviewSessionId: string;
  planId: string;
  account: string;
  now: Date;
  computedAt?: Date | undefined;
  expiresAt: Date;
  includeSharedObject?: boolean | undefined;
  moveCallTarget?: string | undefined;
}): Promise<{
  handle: LocalTransactionMaterialHandle;
  digest: LocalTransactionMaterialDigestCommitment;
}> {
  const transactionBytes = await buildTestTransactionBytes(input.account, {
    includeSharedObject: input.includeSharedObject,
    moveCallTarget: input.moveCallTarget
  });
  const handle = input.materialStore.recordTransactionMaterial(
    {
      reviewSessionId: input.reviewSessionId,
      planId: input.planId,
      account: input.account,
      kind: "deepbook_swap_transaction_data",
      source: "say_ur_intent_built",
      transactionBytes,
      expiresAt: input.expiresAt
    },
    input.now
  );
  const transactionDigest = await Transaction.from(transactionBytes).getDigest();
  return {
    handle,
    digest: {
      materialId: handle.materialId,
      reviewSessionId: handle.reviewSessionId,
      planId: handle.planId,
      account: handle.account,
      kind: handle.kind,
      source: handle.source,
      digestKind: "sui_transaction_digest",
      transactionDigest,
      computedAt: (input.computedAt ?? input.now).toISOString(),
      expiresAt: handle.expiresAt
    }
  };
}
