import type { SuiClientTypes } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import type {
  ReviewTimeSimulationClient
} from "../../src/core/action/reviewTimeSimulationEvidence.js";

export type ReviewTimeSimulationClientFixture = ReviewTimeSimulationClient & {
  calls: Array<SuiClientTypes.SimulateTransactionOptions<{
    transaction: true;
    effects: true;
    balanceChanges: true;
    objectTypes: true;
  }>>;
};

export function createSuccessfulReviewTimeSimulationClient(
  account: string
): ReviewTimeSimulationClientFixture {
  const calls: ReviewTimeSimulationClientFixture["calls"] = [];
  return {
    calls,
    core: {
      async simulateTransaction(options) {
        calls.push(options);
        const transactionBytes = options.transaction;
        if (!(transactionBytes instanceof Uint8Array)) {
          throw new Error("test simulation fixture expects transaction bytes");
        }
        const transaction = Transaction.from(transactionBytes);
        const digest = await transaction.getDigest();
        const transactionData = transaction.getData() as SuiClientTypes.TransactionData;
        const gasObjectId = transactionData.gasData.payment?.[0]?.objectId ?? `0x${"b".repeat(64)}`;
        const gasObjectType = "0x2::coin::Coin<0x2::sui::SUI>";
        return {
          $kind: "Transaction",
          Transaction: {
            digest,
            signatures: [],
            epoch: "1",
            status: { success: true, error: null },
            balanceChanges: [
              {
                address: account,
                coinType: "0x2::sui::SUI",
                amount: "-1000"
              }
            ],
            effects: {
              bcs: null,
              version: 1,
              status: { success: true, error: null },
              gasUsed: {
                computationCost: "100",
                storageCost: "50",
                storageRebate: "20",
                nonRefundableStorageFee: "0"
              },
              transactionDigest: digest,
              gasObject: null,
              eventsDigest: null,
              dependencies: [],
              lamportVersion: null,
              changedObjects: [
                {
                  objectId: gasObjectId,
                  inputState: "Exists",
                  inputVersion: "1",
                  inputDigest: "7".repeat(44),
                  inputOwner: null,
                  outputState: "ObjectWrite",
                  outputVersion: "2",
                  outputDigest: "8".repeat(44),
                  outputOwner: null,
                  idOperation: "None"
                }
              ],
              unchangedConsensusObjects: [],
              auxiliaryDataDigest: null
            },
            events: undefined,
            objectTypes: {
              [gasObjectId]: gasObjectType
            },
            transaction: transactionData,
            bcs: undefined
          },
          commandResults: undefined
        };
      }
    }
  };
}

export function createFailedReviewTimeSimulationClient(
  message = "simulated transaction failed"
): ReviewTimeSimulationClientFixture {
  const calls: ReviewTimeSimulationClientFixture["calls"] = [];
  return {
    calls,
    core: {
      async simulateTransaction(options) {
        calls.push(options);
        const transactionBytes = options.transaction;
        if (!(transactionBytes instanceof Uint8Array)) {
          throw new Error("test simulation fixture expects transaction bytes");
        }
        const transaction = Transaction.from(transactionBytes);
        const digest = await transaction.getDigest();
        const transactionData = transaction.getData() as SuiClientTypes.TransactionData;
        return {
          $kind: "FailedTransaction",
          FailedTransaction: {
            digest,
            signatures: [],
            epoch: "1",
            status: {
              success: false,
              error: { message }
            } as SuiClientTypes.ExecutionStatus,
            balanceChanges: [],
            effects: {
              bcs: null,
              version: 1,
              status: {
                success: false,
                error: { message }
              } as SuiClientTypes.ExecutionStatus,
              gasUsed: {
                computationCost: "0",
                storageCost: "0",
                storageRebate: "0",
                nonRefundableStorageFee: "0"
              },
              transactionDigest: digest,
              gasObject: null,
              eventsDigest: null,
              dependencies: [],
              lamportVersion: null,
              changedObjects: [],
              unchangedConsensusObjects: [],
              auxiliaryDataDigest: null
            },
            events: undefined,
            objectTypes: {},
            transaction: transactionData,
            bcs: undefined
          },
          commandResults: undefined
        };
      }
    }
  };
}
