import { Inputs } from "@mysten/sui/transactions";

export function createDeepbookBuildClient(input: {
  expectedChainIdentifier: string;
  buildError?: Error | undefined;
}) {
  return {
    core: {
      getBalance: async () => ({
        balance: {
          balance: "1000000000000",
          coinBalance: "1000000000000",
          addressBalance: "1000000000000"
        }
      }),
      listCoins: async () => ({
        objects: [
          {
            objectId: `0x${"b".repeat(64)}`,
            version: "1",
            digest: "7".repeat(44),
            balance: "1000000000000"
          }
        ],
        hasNextPage: false,
        cursor: null
      }),
      getCurrentSystemState: async () => ({
        systemState: {
          referenceGasPrice: "1",
          epoch: "1"
        }
      }),
      getChainIdentifier: async () => ({ chainIdentifier: input.expectedChainIdentifier }),
      resolveTransactionPlugin: () => async (
        transactionData: {
          gasData: {
            price: string | number | null;
            budget: string | number | null;
            payment: Array<{ objectId: string; version: string; digest: string }> | null;
          };
          inputs: unknown[];
        },
        _options: unknown,
        next: () => Promise<void>
      ) => {
        transactionData.gasData.price ??= "1";
        transactionData.gasData.budget ??= "250000000";
        transactionData.gasData.payment ??= [
          {
            objectId: `0x${"c".repeat(64)}`,
            version: "1",
            digest: "6".repeat(44)
          }
        ];
        transactionData.inputs = transactionData.inputs.map((transactionInput) => {
          if (isUnresolvedObjectInput(transactionInput)) {
            return Inputs.SharedObjectRef({
              objectId: transactionInput.UnresolvedObject.objectId,
              initialSharedVersion: transactionInput.UnresolvedObject.initialSharedVersion ?? "1",
              mutable: transactionInput.UnresolvedObject.mutable ?? true
            });
          }
          return transactionInput;
        });
        if (input.buildError) {
          throw input.buildError;
        }
        await next();
      }
    }
  } as never;
}

function isUnresolvedObjectInput(input: unknown): input is {
  UnresolvedObject: {
    objectId: string;
    initialSharedVersion?: string | number | null;
    mutable?: boolean | null;
  };
} {
  return typeof input === "object" &&
    input !== null &&
    "UnresolvedObject" in input &&
    typeof (input as { UnresolvedObject?: { objectId?: unknown } }).UnresolvedObject?.objectId === "string";
}
