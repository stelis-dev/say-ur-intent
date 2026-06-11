import { Buffer } from "node:buffer";
import { MIST_PER_SUI, SUI_DECIMALS } from "@mysten/sui/utils";
import { z } from "zod";
import { parseSuiAddress } from "../suiAddress.js";
import {
  classifySuiDeFiActivity,
  protocolActivityClassifierMatchSchema
} from "./transactionActivityClassifier.js";

export const EXTERNAL_ACTIVITY_TRANSACTION_DETAIL_JSON_MAX_BYTES = 64 * 1024;
export const SUI_GAS_UNIT_SOURCE = "@mysten/sui MIST_PER_SUI" as const;

export const externalActivityGasCostFactSchema = z.object({
  netCostRaw: z.string().regex(/^-?\d+$/),
  rawUnit: z.literal("MIST"),
  display: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  displayUnit: z.literal("SUI"),
  decimals: z.literal(SUI_DECIMALS),
  unitSource: z.literal(SUI_GAS_UNIT_SOURCE)
}).strict();

export const externalActivityTransactionDetailSchema = z.object({
  transactionKind: z.string().optional(),
  moveCalls: z.array(z.object({
    commandIndex: z.number().int().nonnegative(),
    package: z.string(),
    module: z.string(),
    function: z.string(),
    target: z.string()
  }).strict()),
  balanceChanges: z.array(z.object({
    index: z.number().int().nonnegative(),
    owner: z.string().optional(),
    coinType: z.string(),
    amountRaw: z.string().regex(/^-?\d+$/),
    direction: z.enum(["increase", "decrease", "zero"])
  }).strict()),
  objectChanges: z.array(z.object({
    index: z.number().int().nonnegative(),
    objectId: z.string(),
    changeKind: z.enum(["created", "mutated", "deleted"]),
    inputType: z.string().optional(),
    outputType: z.string().optional()
  }).strict()),
  events: z.array(z.object({
    sequenceNumber: z.string().regex(/^\d+$/),
    sender: z.string().optional(),
    package: z.string().optional(),
    module: z.string().optional(),
    eventType: z.string().optional()
  }).strict()),
  gas: z.object({
    gasObjectId: z.string().optional(),
    computationCostRaw: z.string().regex(/^\d+$/).optional(),
    storageCostRaw: z.string().regex(/^\d+$/).optional(),
    storageRebateRaw: z.string().regex(/^\d+$/).optional(),
    nonRefundableStorageFeeRaw: z.string().regex(/^\d+$/).optional(),
    netGasCostRaw: z.string().regex(/^-?\d+$/).optional()
  }).strict().optional(),
  executionError: z.object({
    message: z.string(),
    abortCodeRaw: z.string().regex(/^\d+$/).optional(),
    identifier: z.string().optional(),
    instructionOffset: z.number().int().nonnegative().optional(),
    sourceLineNumber: z.number().int().nonnegative().optional(),
    package: z.string().optional(),
    module: z.string().optional(),
    function: z.string().optional()
  }).strict().optional(),
  truncation: z.object({
    moveCalls: z.boolean(),
    balanceChanges: z.boolean(),
    objectChanges: z.boolean(),
    events: z.boolean()
  }).strict()
}).strict();

export const externalActivityTransactionCompactFactsSchema = z.object({
  factScope: z.literal("transaction"),
  requestedAccountScoped: z.literal(false),
  moveCallTargets: z.array(z.string()),
  balanceChanges: z.array(z.object({
    coinType: z.string(),
    amountRaw: z.string().regex(/^-?\d+$/),
    direction: z.enum(["increase", "decrease", "zero"]),
    count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()
  }).strict()),
  objectChangeCounts: z.object({
    created: z.number().int().nonnegative(),
    mutated: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative()
  }).strict(),
  eventTypes: z.array(z.string()),
  gasCost: externalActivityGasCostFactSchema.optional(),
  gasNetCostRaw: z.string().regex(/^-?\d+$/).optional(),
  executionError: z.object({
    message: z.string(),
    abortCodeRaw: z.string().regex(/^\d+$/).optional(),
    package: z.string().optional(),
    module: z.string().optional(),
    function: z.string().optional()
  }).strict().optional(),
  detailTruncated: z.boolean(),
  protocolMatches: z.array(protocolActivityClassifierMatchSchema).optional()
}).strict();

export type ExternalActivityTransactionDetail = z.infer<typeof externalActivityTransactionDetailSchema>;
export type ExternalActivityGasCostFact = z.infer<typeof externalActivityGasCostFactSchema>;
export type ExternalActivityTransactionCompactFacts = z.infer<typeof externalActivityTransactionCompactFactsSchema>;
export type ExternalActivityMoveCallFact = ExternalActivityTransactionDetail["moveCalls"][number];
export type ExternalActivityBalanceChangeFact = ExternalActivityTransactionDetail["balanceChanges"][number];
export type ExternalActivityObjectChangeFact = ExternalActivityTransactionDetail["objectChanges"][number];

export function externalActivityTransactionDetailJsonByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function sanitizeExternalActivityTransactionDetailsForKnownAccount(
  details: ExternalActivityTransactionDetail,
  storageAccount: string
): ExternalActivityTransactionDetail {
  return {
    ...details,
    balanceChanges: details.balanceChanges.map((change) => {
      if (addressMatches(change.owner, storageAccount)) {
        return { ...change, owner: storageAccount };
      }
      const { owner: _owner, ...withoutOwner } = change;
      return withoutOwner;
    }),
    events: details.events.map((event) => {
      if (addressMatches(event.sender, storageAccount)) {
        return { ...event, sender: storageAccount };
      }
      const { sender: _sender, ...withoutSender } = event;
      return withoutSender;
    })
  };
}

export function externalActivityTransactionTouchesAccount(
  transaction: { details?: ExternalActivityTransactionDetail | undefined },
  account: string
): boolean {
  return externalActivityTransactionBalanceOwners(transaction).includes(account);
}

export function externalActivityTransactionBalanceOwners(
  transaction: { details?: ExternalActivityTransactionDetail | undefined }
): string[] {
  const owners = transaction.details?.balanceChanges.flatMap((change) => {
    const owner = change.owner === undefined ? undefined : parseSuiAddress(change.owner);
    return owner === undefined ? [] : [owner];
  }) ?? [];
  return [...new Set(owners)];
}

export function externalActivityTransactionDetailsReferenceOnlyAccount(
  details: ExternalActivityTransactionDetail,
  account: string
): boolean {
  return details.balanceChanges.every((change) => change.owner === undefined || addressMatches(change.owner, account))
    && details.events.every((event) => event.sender === undefined || addressMatches(event.sender, account));
}

export function compactExternalActivityTransactionDetails(
  details: ExternalActivityTransactionDetail
): ExternalActivityTransactionCompactFacts {
  const objectChangeCounts = {
    created: 0,
    mutated: 0,
    deleted: 0
  };
  for (const change of details.objectChanges) {
    objectChangeCounts[change.changeKind] += 1;
  }

  const executionError = details.executionError === undefined
    ? undefined
    : {
        message: details.executionError.message,
        ...(details.executionError.abortCodeRaw === undefined ? {} : { abortCodeRaw: details.executionError.abortCodeRaw }),
        ...(details.executionError.package === undefined ? {} : { package: details.executionError.package }),
        ...(details.executionError.module === undefined ? {} : { module: details.executionError.module }),
        ...(details.executionError.function === undefined ? {} : { function: details.executionError.function })
      };

  const protocolMatches = classifySuiDeFiActivity(details);

  return {
    factScope: "transaction",
    requestedAccountScoped: false,
    moveCallTargets: uniqueStrings(details.moveCalls.map((call) => call.target)),
    balanceChanges: compactBalanceChanges(details.balanceChanges),
    objectChangeCounts,
    eventTypes: uniqueStrings(details.events.flatMap((event) => event.eventType === undefined ? [] : [event.eventType])),
    ...(details.gas?.netGasCostRaw === undefined ? {} : { gasCost: suiGasCostFact(details.gas.netGasCostRaw) }),
    ...(details.gas?.netGasCostRaw === undefined ? {} : { gasNetCostRaw: details.gas.netGasCostRaw }),
    ...(executionError === undefined ? {} : { executionError }),
    detailTruncated: details.truncation.moveCalls
      || details.truncation.balanceChanges
      || details.truncation.objectChanges
      || details.truncation.events,
    ...(protocolMatches.length === 0 ? {} : { protocolMatches })
  };
}

export function suiGasCostFact(netCostRaw: string): ExternalActivityGasCostFact {
  return {
    netCostRaw,
    rawUnit: "MIST",
    display: formatSignedMistAsSui(netCostRaw),
    displayUnit: "SUI",
    decimals: SUI_DECIMALS,
    unitSource: SUI_GAS_UNIT_SOURCE
  };
}

function formatSignedMistAsSui(raw: string): string {
  if (!/^-?\d+$/.test(raw)) {
    throw new Error("gas raw amount must be a signed integer string");
  }
  const negative = raw.startsWith("-");
  const unsignedRaw = negative ? raw.slice(1) : raw;
  const amount = BigInt(unsignedRaw);
  const whole = amount / MIST_PER_SUI;
  const fractional = amount % MIST_PER_SUI;
  const sign = negative && amount !== 0n ? "-" : "";
  if (fractional === 0n) {
    return `${sign}${whole.toString()}`;
  }
  const fractionalText = fractional
    .toString()
    .padStart(SUI_DECIMALS, "0")
    .replace(/0+$/, "");
  return `${sign}${whole.toString()}.${fractionalText}`;
}

function compactBalanceChanges(
  balanceChanges: ExternalActivityTransactionDetail["balanceChanges"]
): ExternalActivityTransactionCompactFacts["balanceChanges"] {
  const compacted = new Map<string, {
    coinType: string;
    amountRaw: string;
    direction: "increase" | "decrease" | "zero";
    count: number;
  }>();

  for (const change of balanceChanges) {
    const key = `${change.coinType}\n${change.amountRaw}\n${change.direction}`;
    const existing = compacted.get(key);
    if (existing === undefined) {
      compacted.set(key, {
        coinType: change.coinType,
        amountRaw: change.amountRaw,
        direction: change.direction,
        count: 1
      });
      continue;
    }
    existing.count += 1;
  }

  return [...compacted.values()].map((change) => ({
    coinType: change.coinType,
    amountRaw: change.amountRaw,
    direction: change.direction,
    ...(change.count === 1 ? {} : { count: change.count })
  }));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function addressMatches(candidate: string | undefined, account: string): candidate is string {
  const normalized = candidate === undefined ? undefined : parseSuiAddress(candidate);
  return normalized !== undefined && normalized === account;
}
