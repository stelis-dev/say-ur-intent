import {
  type ExternalActivityBalanceChangeFact,
  type ExternalActivityObjectChangeFact,
  type ExternalActivityTransactionDetail
} from "../core/activity/transactionActivityDetails.js";
import {
  TransactionActivitySourceError,
  type SuiTransactionActivityFact
} from "../core/activity/transactionActivityTypes.js";
import { parseSuiAddress } from "../core/suiAddress.js";

export type GraphqlTransactionNode = {
  digest?: unknown;
  sender?: { address?: unknown } | null;
  kind?: GraphqlTransactionKind | null;
  effects?: {
    status?: unknown;
    timestamp?: unknown;
    checkpoint?: { sequenceNumber?: unknown } | null;
    executionError?: GraphqlExecutionError | null;
    gasEffects?: {
      gasObject?: { address?: unknown } | null;
      gasSummary?: GraphqlGasSummary | null;
    } | null;
    balanceChanges?: GraphqlConnection<GraphqlBalanceChange> | null;
    objectChanges?: GraphqlConnection<GraphqlObjectChange> | null;
    events?: GraphqlConnection<GraphqlEvent> | null;
  } | null;
};

type GraphqlConnection<T> = {
  nodes?: T[] | null;
  pageInfo?: { hasNextPage?: unknown } | null;
};

type GraphqlTransactionKind = {
  __typename?: unknown;
  commands?: GraphqlConnection<GraphqlCommand> | null;
};

type GraphqlCommand = {
  __typename?: unknown;
  function?: GraphqlMoveFunction | null;
};

type GraphqlMoveFunction = {
  fullyQualifiedName?: unknown;
  name?: unknown;
  module?: GraphqlMoveModule | null;
};

type GraphqlMoveModule = {
  name?: unknown;
  package?: { address?: unknown } | null;
};

type GraphqlGasSummary = {
  computationCost?: unknown;
  storageCost?: unknown;
  storageRebate?: unknown;
  nonRefundableStorageFee?: unknown;
};

type GraphqlBalanceChange = {
  amount?: unknown;
  coinType?: { repr?: unknown } | null;
  owner?: { address?: unknown } | null;
};

type GraphqlObjectChange = {
  address?: unknown;
  idCreated?: unknown;
  idDeleted?: unknown;
  inputState?: GraphqlObjectState | null;
  outputState?: GraphqlObjectState | null;
};

type GraphqlObjectState = {
  asMoveObject?: {
    contents?: { type?: { repr?: unknown } | null } | null;
  } | null;
};

type GraphqlEvent = {
  sequenceNumber?: unknown;
  sender?: { address?: unknown } | null;
  transactionModule?: GraphqlMoveModule | null;
  contents?: { type?: { repr?: unknown } | null } | null;
};

type GraphqlExecutionError = {
  message?: unknown;
  abortCode?: unknown;
  identifier?: unknown;
  instructionOffset?: unknown;
  sourceLineNumber?: unknown;
  module?: GraphqlMoveModule | null;
  function?: GraphqlMoveFunction | null;
};

export function transactionFactFromNode(node: GraphqlTransactionNode): SuiTransactionActivityFact {
  if (typeof node.digest !== "string" || node.digest.length === 0) {
    throw new TransactionActivitySourceError("provider_error", "Sui GraphQL transaction was missing digest");
  }
  const sender = typeof node.sender?.address === "string" ? parseSuiAddress(node.sender.address) : undefined;
  const checkpointValue = node.effects?.checkpoint?.sequenceNumber;
  const checkpoint = typeof checkpointValue === "number" || typeof checkpointValue === "string"
    ? String(checkpointValue)
    : undefined;
  const timestamp = typeof node.effects?.timestamp === "string" ? normalizeGraphqlTimestamp(node.effects.timestamp) : undefined;
  return {
    digest: node.digest,
    sender,
    checkpoint,
    timestamp,
    status: executionStatusFromGraphql(node.effects?.status),
    details: transactionDetailsFromNode(node)
  };
}

function transactionDetailsFromNode(node: GraphqlTransactionNode): ExternalActivityTransactionDetail {
  return {
    transactionKind: stringValue(node.kind?.__typename),
    moveCalls: moveCallFactsFromKind(node.kind),
    balanceChanges: balanceChangeFactsFromEffects(node.effects),
    objectChanges: objectChangeFactsFromEffects(node.effects),
    events: eventFactsFromEffects(node.effects),
    gas: gasFactFromEffects(node.effects),
    executionError: executionErrorFactFromEffects(node.effects),
    truncation: {
      moveCalls: node.kind?.commands?.pageInfo?.hasNextPage === true,
      balanceChanges: node.effects?.balanceChanges?.pageInfo?.hasNextPage === true,
      objectChanges: node.effects?.objectChanges?.pageInfo?.hasNextPage === true,
      events: node.effects?.events?.pageInfo?.hasNextPage === true
    }
  };
}

function moveCallFactsFromKind(kind: GraphqlTransactionKind | null | undefined) {
  const nodes = Array.isArray(kind?.commands?.nodes) ? kind.commands.nodes : [];
  return nodes.flatMap((command, commandIndex) => {
    if (command.__typename !== "MoveCallCommand" || !command.function) {
      return [];
    }
    const target = stringValue(command.function.fullyQualifiedName);
    const packageId = stringValue(command.function.module?.package?.address);
    const module = stringValue(command.function.module?.name);
    const fn = stringValue(command.function.name);
    if (!target || !packageId || !module || !fn) {
      return [];
    }
    return [{
      commandIndex,
      package: packageId,
      module,
      function: fn,
      target
    }];
  });
}

function balanceChangeFactsFromEffects(effects: GraphqlTransactionNode["effects"]): ExternalActivityBalanceChangeFact[] {
  const nodes = Array.isArray(effects?.balanceChanges?.nodes) ? effects.balanceChanges.nodes : [];
  return nodes.flatMap((change, index) => {
    const amountRaw = unsignedOrSignedIntegerString(change.amount);
    const coinType = stringValue(change.coinType?.repr);
    if (!amountRaw || !coinType) {
      return [];
    }
    return [{
      index,
      owner: stringValue(change.owner?.address),
      coinType,
      amountRaw,
      direction: balanceChangeDirection(amountRaw)
    }];
  });
}

function objectChangeFactsFromEffects(effects: GraphqlTransactionNode["effects"]): ExternalActivityObjectChangeFact[] {
  const nodes = Array.isArray(effects?.objectChanges?.nodes) ? effects.objectChanges.nodes : [];
  return nodes.flatMap((change, index) => {
    const objectId = stringValue(change.address);
    if (!objectId) {
      return [];
    }
    return [{
      index,
      objectId,
      changeKind: objectChangeKind(change),
      inputType: stringValue(change.inputState?.asMoveObject?.contents?.type?.repr),
      outputType: stringValue(change.outputState?.asMoveObject?.contents?.type?.repr)
    }];
  });
}

function eventFactsFromEffects(effects: GraphqlTransactionNode["effects"]) {
  const nodes = Array.isArray(effects?.events?.nodes) ? effects.events.nodes : [];
  return nodes.flatMap((event) => {
    const sequenceNumber = unsignedOrSignedIntegerString(event.sequenceNumber);
    if (!sequenceNumber) {
      return [];
    }
    return [{
      sequenceNumber,
      sender: stringValue(event.sender?.address),
      package: stringValue(event.transactionModule?.package?.address),
      module: stringValue(event.transactionModule?.name),
      eventType: stringValue(event.contents?.type?.repr)
    }];
  });
}

function gasFactFromEffects(effects: GraphqlTransactionNode["effects"]) {
  const summary = effects?.gasEffects?.gasSummary;
  if (!summary) {
    return undefined;
  }
  const computationCostRaw = unsignedOrSignedIntegerString(summary.computationCost);
  const storageCostRaw = unsignedOrSignedIntegerString(summary.storageCost);
  const storageRebateRaw = unsignedOrSignedIntegerString(summary.storageRebate);
  const nonRefundableStorageFeeRaw = unsignedOrSignedIntegerString(summary.nonRefundableStorageFee);
  return {
    gasObjectId: stringValue(effects?.gasEffects?.gasObject?.address),
    computationCostRaw,
    storageCostRaw,
    storageRebateRaw,
    nonRefundableStorageFeeRaw,
    netGasCostRaw: netGasCostRaw({ computationCostRaw, storageCostRaw, storageRebateRaw })
  };
}

function executionErrorFactFromEffects(effects: GraphqlTransactionNode["effects"]) {
  const error = effects?.executionError;
  const message = stringValue(error?.message);
  if (!error || !message) {
    return undefined;
  }
  const fn = error.function;
  const module = error.module ?? fn?.module;
  return {
    message,
    abortCodeRaw: unsignedOrSignedIntegerString(error.abortCode),
    identifier: stringValue(error.identifier),
    instructionOffset: integerNumber(error.instructionOffset),
    sourceLineNumber: integerNumber(error.sourceLineNumber),
    package: stringValue(module?.package?.address),
    module: stringValue(module?.name),
    function: stringValue(fn?.name)
  };
}

function objectChangeKind(change: GraphqlObjectChange): "created" | "mutated" | "deleted" {
  if (change.idCreated === true) return "created";
  if (change.idDeleted === true) return "deleted";
  return "mutated";
}

function balanceChangeDirection(amountRaw: string): "increase" | "decrease" | "zero" {
  if (amountRaw.startsWith("-")) return "decrease";
  if (amountRaw === "0") return "zero";
  return "increase";
}

function netGasCostRaw(input: {
  computationCostRaw?: string | undefined;
  storageCostRaw?: string | undefined;
  storageRebateRaw?: string | undefined;
}): string | undefined {
  if (input.computationCostRaw === undefined || input.storageCostRaw === undefined || input.storageRebateRaw === undefined) {
    return undefined;
  }
  return String(BigInt(input.computationCostRaw) + BigInt(input.storageCostRaw) - BigInt(input.storageRebateRaw));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function unsignedOrSignedIntegerString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value);
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return value;
  }
  return undefined;
}

function integerNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function executionStatusFromGraphql(value: unknown) {
  if (value === "SUCCESS") return "success";
  if (value === "FAILURE") return "failure";
  // Null status can occur before checkpointed effects are available; unmapped
  // provider enum values stay unknown until explicitly mapped.
  return "unknown";
}

function normalizeGraphqlTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TransactionActivitySourceError("provider_error", "Sui GraphQL transaction timestamp was invalid");
  }
  return parsed.toISOString();
}
