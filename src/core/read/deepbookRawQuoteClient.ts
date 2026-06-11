import { bcs } from "@mysten/sui/bcs";
import type { SuiClientTypes } from "@mysten/sui/client";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import {
  DeepBookClient,
  type AccountInfo,
  type BalanceManager,
  type LockedBalances
} from "@mysten/deepbook-v3";
import {
  ReadServiceInputError,
  type DeepBookReadClient,
  type DeepbookRawQuoteReturnValues
} from "./readServiceTypes.js";

export function createDeepBookReadClient(input: {
  client: SuiGrpcClient;
  simulationSender: string;
  network: SuiClientTypes.Network;
  balanceManagers?: Record<string, BalanceManager> | undefined;
}): DeepBookReadClient {
  const sdkClient = new DeepBookClient({
    client: input.client,
    address: input.simulationSender,
    network: input.network,
    ...(input.balanceManagers === undefined ? {} : { balanceManagers: input.balanceManagers })
  });

  return {
    midPrice: (poolKey) => sdkClient.midPrice(poolKey),
    poolBookParams: (poolKey) => sdkClient.poolBookParams(poolKey),
    getLevel2TicksFromMid: (poolKey, ticks) => sdkClient.getLevel2TicksFromMid(poolKey, ticks),
    getQuoteQuantityOutRaw: (poolKey, baseQuantity) =>
      simulateDeepbookRawQuote({
        client: input.client,
        simulationSender: input.simulationSender,
        poolKey,
        command: () => sdkClient.deepBook.getQuoteQuantityOut(poolKey, baseQuantity)
      }),
    getBaseQuantityOutRaw: (poolKey, quoteQuantity) =>
      simulateDeepbookRawQuote({
        client: input.client,
        simulationSender: input.simulationSender,
        poolKey,
        command: () => sdkClient.deepBook.getBaseQuantityOut(poolKey, quoteQuantity)
      }),
    getQuoteQuantityOutInputFeeRaw: (poolKey, baseQuantity) =>
      simulateDeepbookRawQuote({
        client: input.client,
        simulationSender: input.simulationSender,
        poolKey,
        command: () => sdkClient.deepBook.getQuoteQuantityOutInputFee(poolKey, baseQuantity)
      }),
    getBaseQuantityOutInputFeeRaw: (poolKey, quoteQuantity) =>
      simulateDeepbookRawQuote({
        client: input.client,
        simulationSender: input.simulationSender,
        poolKey,
        command: () => sdkClient.deepBook.getBaseQuantityOutInputFee(poolKey, quoteQuantity)
      }),
    getBalanceManagerIds: (owner) => sdkClient.getBalanceManagerIds(owner),
    accountExists: (poolKey, managerKey) => sdkClient.accountExists(poolKey, managerKey),
    account: (poolKey, managerKey): Promise<AccountInfo> => sdkClient.account(poolKey, managerKey),
    lockedBalance: (poolKey, balanceManagerKey): Promise<LockedBalances> =>
      sdkClient.lockedBalance(poolKey, balanceManagerKey),
    accountOpenOrders: (poolKey, managerKey) => sdkClient.accountOpenOrders(poolKey, managerKey)
  };
}

async function simulateDeepbookRawQuote(input: {
  client: SuiGrpcClient;
  simulationSender: string;
  poolKey: string;
  command: () => (tx: Transaction) => void;
}): Promise<DeepbookRawQuoteReturnValues> {
  const tx = new Transaction();
  tx.setSender(input.simulationSender);
  tx.add(input.command());
  const result = await input.client.core.simulateTransaction({
    transaction: tx,
    include: { commandResults: true, effects: true }
  });

  const returnValues = result.commandResults?.[0]?.returnValues;
  if (!Array.isArray(returnValues) || returnValues.length < 3) {
    throw new ReadServiceInputError("quote_unavailable", "DeepBook raw quote return values are unavailable", {
      poolKey: input.poolKey,
      expectedReturnValues: ["base_quantity_out", "quote_quantity_out", "deep_quantity_required"]
    });
  }

  return {
    baseOutRaw: parseU64ReturnValue(returnValues[0], "baseOutRaw", input.poolKey),
    quoteOutRaw: parseU64ReturnValue(returnValues[1], "quoteOutRaw", input.poolKey),
    deepRequiredRaw: parseU64ReturnValue(returnValues[2], "deepRequiredRaw", input.poolKey)
  };
}

function parseU64ReturnValue(value: unknown, field: string, poolKey: string): string {
  const bcsValue = typeof value === "object" && value !== null && "bcs" in value ? value.bcs : undefined;
  if (!(bcsValue instanceof Uint8Array)) {
    throw new ReadServiceInputError("quote_unavailable", "DeepBook raw quote return value is unavailable", {
      poolKey,
      field
    });
  }

  try {
    return bcs.U64.parse(bcsValue).toString();
  } catch (error) {
    throw new ReadServiceInputError("quote_unavailable", "DeepBook raw quote return value is not a u64", {
      poolKey,
      field,
      reason: error instanceof Error ? error.message : "unknown"
    });
  }
}
