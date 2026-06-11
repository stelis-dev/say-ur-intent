import {
  isValidSuiObjectId,
  isValidTransactionDigest,
  normalizeSuiObjectId
} from "@mysten/sui/utils";
import {
  SNIPPET_LIMIT,
  SOURCE_CHECKED_SUI_CLI_VERSION,
  type SuiCliObjectSummary,
  type SuiCliTxBlockCountField,
  type SuiCliTxBlockSummary
} from "./sui-cli-transaction-diagnostics-types.js";
import {
  containsSensitiveMaterial,
  redactSensitive
} from "./sui-cli-transaction-diagnostics-redaction.js";
import {
  clientEnvAllowed,
  isCliChainIdentifier
} from "./sui-cli-transaction-diagnostics-validators.js";

export function parseJsonString(source: string): string | undefined {
  try {
    const parsed = JSON.parse(source) as unknown;
    return typeof parsed === "string" && parsed.length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseJsonObject(source: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(source) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function transactionDigestFromCli(value: Record<string, unknown>): string | undefined {
  const digest = stringValue(value.digest);
  return digest !== undefined && isValidTransactionDigest(digest) ? digest : undefined;
}

export function objectIdFromCli(value: Record<string, unknown>): string | undefined {
  const objectId = stringValue(value.objectId);
  return objectId !== undefined && isValidSuiObjectId(objectId) ? normalizeSuiObjectId(objectId) : undefined;
}

export function selectMainnetEnv(
  source: string,
  expectedCliChainIdentifier: string
): { ok: true; alias: string } | { ok: false; kind: "unrecognized_json_shape" | "mainnet_env_not_found" | "mainnet_env_ambiguous" | "mainnet_env_alias_unsafe"; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return { ok: false, kind: "unrecognized_json_shape", message: "Sui CLI envs output was not valid JSON." };
  }
  if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) {
    return { ok: false, kind: "unrecognized_json_shape", message: "Sui CLI envs output did not match the expected env list shape." };
  }
  const matches: string[] = [];
  for (const env of parsed[0]) {
    if (!isRecord(env)) {
      continue;
    }
    const alias = stringValue(env.alias);
    const chainId = stringValue(env.chain_id);
    if (!isCliChainIdentifier(chainId) || chainId.toLowerCase() !== expectedCliChainIdentifier || alias === undefined) {
      continue;
    }
    if (!clientEnvAllowed(alias) || containsSensitiveMaterial(alias)) {
      return {
        ok: false,
        kind: "mainnet_env_alias_unsafe",
        message: "Sui CLI envs output included a mainnet env alias blocked by diagnostics alias policy."
      };
    }
    matches.push(alias);
  }
  if (matches.length === 0) {
    return { ok: false, kind: "mainnet_env_not_found", message: "No Sui CLI environment alias points at the expected mainnet chain id." };
  }
  if (matches.length > 1) {
    return { ok: false, kind: "mainnet_env_ambiguous", message: "Multiple Sui CLI environment aliases point at mainnet; use --client-env explicitly." };
  }
  return { ok: true, alias: matches[0] as string };
}

export function summarizeTxBlock(value: Record<string, unknown>, versionMatchesSource: boolean): SuiCliTxBlockSummary {
  const effects = recordValue(value.effects);
  const status = recordValue(effects?.status);
  const gasUsed = recordValue(effects?.gasUsed);
  const objectChanges = arrayValue(value.objectChanges);
  const balanceChanges = arrayValue(value.balanceChanges);
  const events = arrayValue(value.events);
  const executionStatus = executionStatusFromCli(status);
  const counts: SuiCliTxBlockSummary["counts"] = {};
  const countFieldsUnavailable: SuiCliTxBlockCountField[] = [];
  addOptionalTopLevelCount(counts, countFieldsUnavailable, "objectChanges", objectChanges);
  addOptionalTopLevelCount(counts, countFieldsUnavailable, "balanceChanges", balanceChanges);
  addOptionalTopLevelCount(counts, countFieldsUnavailable, "events", events);
  const summary: SuiCliTxBlockSummary = {
    source: "sui_cli_transaction_block_response",
    sourceCheckedVersion: SOURCE_CHECKED_SUI_CLI_VERSION,
    sourceVersionMatchesInstalledCli: versionMatchesSource,
    topLevelKeys: redactedSortedKeys(value),
    effectsAvailable: effects !== undefined,
    status: executionStatus.status,
    counts
  };
  if (countFieldsUnavailable.length > 0) summary.countFieldsUnavailable = countFieldsUnavailable;
  if (executionStatus.unrecognized !== undefined) summary.unrecognizedExecutionStatus = executionStatus.unrecognized;
  if (effects !== undefined) {
    summary.counts.dependencies = arrayValue(effects.dependencies)?.length ?? 0;
    summary.counts.created = arrayValue(effects.created)?.length ?? 0;
    summary.counts.mutated = arrayValue(effects.mutated)?.length ?? 0;
    summary.counts.deleted = arrayValue(effects.deleted)?.length ?? 0;
    summary.counts.wrapped = arrayValue(effects.wrapped)?.length ?? 0;
    summary.counts.unwrapped = arrayValue(effects.unwrapped)?.length ?? 0;
    summary.counts.unwrappedThenDeleted = arrayValue(effects.unwrappedThenDeleted)?.length ?? 0;
  }
  const digest = stringValue(value.digest);
  if (digest !== undefined) summary.digest = digest;
  const executionError = stringValue(status?.error);
  if (executionError !== undefined) {
    const redactedExecutionError = redactSensitive(executionError);
    summary.executionError = redactedExecutionError.slice(0, SNIPPET_LIMIT);
    if (redactedExecutionError.length > SNIPPET_LIMIT) {
      summary.executionErrorTruncated = true;
    }
  }
  const checkpoint = integerString(value.checkpoint);
  if (checkpoint !== undefined) summary.checkpoint = checkpoint;
  const timestampMs = integerString(value.timestampMs);
  if (timestampMs !== undefined) summary.timestampMs = timestampMs;
  if (gasUsed !== undefined) summary.gas = gasSummaryFromCli(gasUsed);
  return summary;
}

function addOptionalTopLevelCount(
  counts: SuiCliTxBlockSummary["counts"],
  unavailable: SuiCliTxBlockCountField[],
  field: SuiCliTxBlockCountField,
  value: unknown[] | undefined
): void {
  if (value === undefined) {
    unavailable.push(field);
    return;
  }
  counts[field] = value.length;
}

export function summarizeObject(
  requestedObjectId: string,
  value: Record<string, unknown>,
  versionMatchesSource: boolean
): SuiCliObjectSummary {
  const content = recordValue(value.content);
  const summary: SuiCliObjectSummary = {
    source: "sui_cli_object_output",
    sourceCheckedVersion: SOURCE_CHECKED_SUI_CLI_VERSION,
    sourceVersionMatchesInstalledCli: versionMatchesSource,
    requestedObjectId
  };
  const objectId = stringValue(value.objectId);
  if (objectId !== undefined) summary.objectId = redactSensitive(objectId);
  const version = integerString(value.version);
  if (version !== undefined) summary.version = version;
  const digest = stringValue(value.digest);
  if (digest !== undefined) summary.digest = redactSensitive(digest);
  const objectType = stringValue(value.objType);
  if (objectType !== undefined) summary.objectType = redactSensitive(objectType);
  const ownerKindValue = ownerKind(value.owner);
  if (ownerKindValue !== undefined) summary.ownerKind = ownerKindValue;
  const previousTransaction = stringValue(value.prevTx);
  if (previousTransaction !== undefined) summary.previousTransaction = redactSensitive(previousTransaction);
  const storageRebateRaw = integerString(value.storageRebate);
  if (storageRebateRaw !== undefined) summary.storageRebateRaw = storageRebateRaw;
  if (content !== undefined) summary.contentShape = summarizeJsonShape(content);
  return summary;
}

function summarizeJsonShape(value: Record<string, unknown>): { topLevelKeys: string[]; topLevelFieldTypes: Record<string, string> } {
  const entries = redactedFieldEntries(value);
  return {
    topLevelKeys: entries.map(([key]) => key),
    topLevelFieldTypes: Object.fromEntries(entries)
  };
}

function redactedSortedKeys(value: Record<string, unknown>): string[] {
  return redactedFieldEntries(value).map(([key]) => key);
}

function redactedFieldEntries(value: Record<string, unknown>): Array<[string, string]> {
  const entries = Object.entries(value)
    .map(([key, field]) => ({
      originalKey: key,
      redactedKey: redactSensitive(key),
      type: fieldType(field)
    }))
    .sort((left, right) => left.redactedKey.localeCompare(right.redactedKey)
      || left.originalKey.localeCompare(right.originalKey));
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.redactedKey, (totals.get(entry.redactedKey) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const total = totals.get(entry.redactedKey) ?? 0;
    if (total <= 1) {
      return [entry.redactedKey, entry.type];
    }
    const index = (seen.get(entry.redactedKey) ?? 0) + 1;
    seen.set(entry.redactedKey, index);
    return [`${entry.redactedKey}#${index}`, entry.type];
  });
}

function executionStatusFromCli(status: Record<string, unknown> | undefined): { status: "success" | "failure" | "unknown"; unrecognized?: string } {
  const value = stringValue(status?.status)?.toLowerCase();
  if (value === "success" || value === "failure") {
    return { status: value };
  }
  return value === undefined ? { status: "unknown" } : { status: "unknown", unrecognized: redactSensitive(value) };
}

function gasSummaryFromCli(value: Record<string, unknown>): NonNullable<SuiCliTxBlockSummary["gas"]> {
  const computationCostRaw = integerString(value.computationCost);
  const storageCostRaw = integerString(value.storageCost);
  const storageRebateRaw = integerString(value.storageRebate);
  const nonRefundableStorageFeeRaw = integerString(value.nonRefundableStorageFee);
  return {
    ...(computationCostRaw === undefined ? {} : { computationCostRaw }),
    ...(storageCostRaw === undefined ? {} : { storageCostRaw }),
    ...(storageRebateRaw === undefined ? {} : { storageRebateRaw }),
    ...(nonRefundableStorageFeeRaw === undefined ? {} : { nonRefundableStorageFeeRaw }),
    ...(computationCostRaw === undefined || storageCostRaw === undefined || storageRebateRaw === undefined
      ? {}
      : { netGasCostRaw: String(BigInt(computationCostRaw) + BigInt(storageCostRaw) - BigInt(storageRebateRaw)) })
  };
}

function ownerKind(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return redactSensitive(value);
  }
  return isRecord(value) ? redactSensitive(Object.keys(value).sort()[0] ?? "") || undefined : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integerString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}
