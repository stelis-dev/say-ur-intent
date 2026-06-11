import { resolve } from "node:path";
import {
  isValidSuiObjectId,
  isValidTransactionDigest,
  normalizeSuiObjectId
} from "@mysten/sui/utils";
import {
  DEFAULT_ANALYZE_TIMEOUT_MS,
  DEFAULT_READ_TIMEOUT_MS,
  DEFAULT_REPLAY_TIMEOUT_MS,
  DiagnosticsInputError,
  INVALID_CLIENT_ENV_MARKER,
  MAX_OBJECT_IDS,
  type DiagnosticsInput,
  type SuiCliDiagnosticsOutput,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  UNSAFE_OUTPUT_DIR_MARKER
} from "./sui-cli-transaction-diagnostics-types.js";
import {
  pathFromUserInput,
  timestampForPath,
  validateArtifactPath,
  validateTraceFilePath
} from "./sui-cli-transaction-diagnostics-paths.js";
import {
  containsPrivateKeyMaterial,
  containsSensitiveMaterial,
  redactSensitive
} from "./sui-cli-transaction-diagnostics-redaction.js";
import {
  clientEnvAllowed,
  timeoutMsAllowed
} from "./sui-cli-transaction-diagnostics-validators.js";

type RawDiagnosticsArgv = {
  digest?: string;
  objectIds: string[];
  mainnet: boolean;
  clientEnv?: string;
  trace: boolean;
  gasProfile: boolean;
  traceFile?: string;
  outputDir?: string;
  readTimeoutMs?: string;
  replayTimeoutMs?: string;
  analyzeTimeoutMs?: string;
};

const VALUE_OPTION_HANDLERS = {
  "--digest": (raw, value) => { raw.digest = value; },
  "--object": (raw, value) => { raw.objectIds.push(value); },
  "--client-env": (raw, value) => { raw.clientEnv = value; },
  "--trace-file": (raw, value) => { raw.traceFile = value; },
  "--output-dir": (raw, value) => { raw.outputDir = value; },
  "--read-timeout-ms": (raw, value) => { raw.readTimeoutMs = value; },
  "--replay-timeout-ms": (raw, value) => { raw.replayTimeoutMs = value; },
  "--analyze-timeout-ms": (raw, value) => { raw.analyzeTimeoutMs = value; }
} satisfies Record<string, (raw: RawDiagnosticsArgv, value: string) => void>;

const BOOLEAN_OPTION_HANDLERS = {
  "--mainnet": (raw) => { raw.mainnet = true; },
  "--trace": (raw) => { raw.trace = true; },
  "--gas-profile": (raw) => { raw.gasProfile = true; }
} satisfies Record<string, (raw: RawDiagnosticsArgv) => void>;

type ValueOption = keyof typeof VALUE_OPTION_HANDLERS;
type BooleanOption = keyof typeof BOOLEAN_OPTION_HANDLERS;

export function parseSuiCliDiagnosticsArgs(
  argv: string[],
  options: { cwd?: string; now?: Date } = {}
): DiagnosticsInput {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const raw = scanSuiCliDiagnosticsArgv(argv, "strict");
  const readTimeoutMs = raw.readTimeoutMs === undefined
    ? DEFAULT_READ_TIMEOUT_MS
    : parseTimeout(raw.readTimeoutMs, "--read-timeout-ms");
  const replayTimeoutMs = raw.replayTimeoutMs === undefined
    ? DEFAULT_REPLAY_TIMEOUT_MS
    : parseTimeout(raw.replayTimeoutMs, "--replay-timeout-ms");
  const analyzeTimeoutMs = raw.analyzeTimeoutMs === undefined
    ? DEFAULT_ANALYZE_TIMEOUT_MS
    : parseTimeout(raw.analyzeTimeoutMs, "--analyze-timeout-ms");

  if (raw.digest === undefined || !isValidTransactionDigest(raw.digest)) {
    throw new DiagnosticsInputError("Expected --digest to be a valid Sui transaction digest.");
  }

  const rawOutputPath = raw.outputDir === undefined
    ? resolve(cwd, ".WORK", "sui-cli-diagnostics", timestampForPath(now))
    : pathFromUserInput(raw.outputDir, cwd);
  const rawTraceFilePath = raw.traceFile === undefined ? undefined : pathFromUserInput(raw.traceFile, cwd);

  return normalizeSuiCliDiagnosticsInput({
    digest: raw.digest,
    objectIds: raw.objectIds,
    mainnet: raw.mainnet,
    ...(raw.clientEnv === undefined ? {} : { clientEnv: raw.clientEnv }),
    trace: raw.trace,
    gasProfile: raw.gasProfile,
    ...(rawTraceFilePath === undefined ? {} : { traceFile: rawTraceFilePath }),
    outputDir: rawOutputPath,
    readTimeoutMs,
    replayTimeoutMs,
    analyzeTimeoutMs
  }, { cwd });
}

export function normalizeSuiCliDiagnosticsInput(
  input: DiagnosticsInput,
  options: { cwd?: string } = {}
): DiagnosticsInput {
  const cwd = options.cwd ?? process.cwd();
  if (!isValidTransactionDigest(input.digest)) {
    throw new DiagnosticsInputError("Expected --digest to be a valid Sui transaction digest.");
  }
  if (input.clientEnv !== undefined && !clientEnvAllowed(input.clientEnv)) {
    throw new DiagnosticsInputError("--client-env must be an existing Sui CLI environment alias, not a URL or command.");
  }
  if (input.mainnet && input.clientEnv !== undefined) {
    throw new DiagnosticsInputError("--mainnet and --client-env are mutually exclusive.");
  }
  if (input.objectIds.length > MAX_OBJECT_IDS) {
    throw new DiagnosticsInputError(`Expected at most ${MAX_OBJECT_IDS} --object values.`);
  }
  assertNoSensitiveAliasValue(input.clientEnv, "--client-env");
  const normalizedObjectIds = input.objectIds.map((objectId) => {
    if (!isValidSuiObjectId(objectId)) {
      throw new DiagnosticsInputError("Expected --object to be a valid Sui object id.");
    }
    return normalizeSuiObjectId(objectId);
  });
  if (input.trace && input.traceFile !== undefined) {
    throw new DiagnosticsInputError("--trace and --trace-file are mutually exclusive.");
  }
  if (input.traceFile !== undefined && !input.gasProfile) {
    throw new DiagnosticsInputError("--trace-file is only valid with --gas-profile.");
  }
  if (input.gasProfile && !input.trace && input.traceFile === undefined) {
    throw new DiagnosticsInputError("--gas-profile requires --trace or --trace-file.");
  }
  const readTimeoutMs = validateTimeoutNumber(input.readTimeoutMs, "--read-timeout-ms");
  const replayTimeoutMs = validateTimeoutNumber(input.replayTimeoutMs, "--replay-timeout-ms");
  const analyzeTimeoutMs = validateTimeoutNumber(input.analyzeTimeoutMs, "--analyze-timeout-ms");
  const rawOutputPath = pathFromUserInput(input.outputDir, cwd);
  assertNoPrivateKeyPathValue(rawOutputPath, "--output-dir");
  const outputDir = validateArtifactPath(rawOutputPath, cwd, "output directory");
  const rawTraceFilePath = input.traceFile === undefined ? undefined : pathFromUserInput(input.traceFile, cwd);
  assertNoPrivateKeyPathValue(rawTraceFilePath, "--trace-file");
  const traceFile = rawTraceFilePath === undefined ? undefined : validateTraceFilePath(rawTraceFilePath);

  return {
    digest: input.digest,
    objectIds: normalizedObjectIds,
    mainnet: input.mainnet,
    ...(input.clientEnv === undefined ? {} : { clientEnv: input.clientEnv }),
    trace: input.trace,
    gasProfile: input.gasProfile,
    ...(traceFile === undefined ? {} : { traceFile }),
    outputDir,
    readTimeoutMs,
    replayTimeoutMs,
    analyzeTimeoutMs
  };
}

export function summarizeSuiCliDiagnosticsFailureInput(
  argv: string[],
  options: { cwd?: string } = {}
): SuiCliDiagnosticsOutput["input"] {
  const cwd = options.cwd ?? process.cwd();
  const raw = scanSuiCliDiagnosticsArgv(argv, "lenient");
  const digest = raw.digest !== undefined && isValidTransactionDigest(raw.digest) ? raw.digest : undefined;
  const objectIds = summarizeObjectIds(raw.objectIds);
  const clientEnv = summarizeClientEnv(raw.clientEnv);
  const outputDir = summarizeOutputDir(raw.outputDir, cwd);
  const timeouts = summarizeTimeouts(raw);

  // Parse-failure output omits traceFile because it is a read-only path outside the artifact sandbox.
  return {
    ...(digest === undefined ? {} : { digest }),
    objectIds,
    ...(raw.mainnet ? { mainnet: true } : {}),
    ...(clientEnv === undefined ? {} : { clientEnv }),
    trace: raw.trace,
    gasProfile: raw.gasProfile,
    outputDir,
    ...(timeouts === undefined ? {} : { timeouts })
  };
}

export function summarizeSuiCliDiagnosticsFailureInputValue(
  input: DiagnosticsInput,
  options: { cwd?: string } = {}
): SuiCliDiagnosticsOutput["input"] {
  const cwd = options.cwd ?? process.cwd();
  const digest = isValidTransactionDigest(input.digest) ? input.digest : undefined;
  const objectIds = summarizeObjectIds(input.objectIds);
  const clientEnv = summarizeClientEnv(input.clientEnv);
  const outputDir = summarizeOutputDir(input.outputDir, cwd);
  const timeouts = summarizeTimeoutValues(input);

  return {
    ...(digest === undefined ? {} : { digest }),
    objectIds,
    ...(input.mainnet ? { mainnet: true } : {}),
    ...(clientEnv === undefined ? {} : { clientEnv }),
    trace: input.trace,
    gasProfile: input.gasProfile,
    outputDir,
    ...(timeouts === undefined ? {} : { timeouts })
  };
}

function summarizeObjectIds(rawObjectIds: string[]): string[] {
  const objectIds: string[] = [];
  for (const objectId of rawObjectIds.slice(0, MAX_OBJECT_IDS)) {
    if (isValidSuiObjectId(objectId)) {
      objectIds.push(normalizeSuiObjectId(objectId));
    }
  }
  return objectIds;
}

function scanSuiCliDiagnosticsArgv(argv: string[], mode: "strict" | "lenient"): RawDiagnosticsArgv {
  const raw: RawDiagnosticsArgv = {
    objectIds: [],
    mainnet: false,
    trace: false,
    gasProfile: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (isValueOption(arg)) {
      const value = optionValue(argv, index, arg, mode);
      if (value === undefined) {
        continue;
      }
      VALUE_OPTION_HANDLERS[arg](raw, value);
      index += 1;
      continue;
    }
    if (isBooleanOption(arg)) {
      BOOLEAN_OPTION_HANDLERS[arg](raw);
      continue;
    }
    if (mode === "strict") {
      throw new DiagnosticsInputError(`Unsupported option: ${arg}`);
    }
  }

  return raw;
}

function isValueOption(arg: string): arg is ValueOption {
  return Object.hasOwn(VALUE_OPTION_HANDLERS, arg);
}

function isBooleanOption(arg: string): arg is BooleanOption {
  return Object.hasOwn(BOOLEAN_OPTION_HANDLERS, arg);
}

function optionValue(
  argv: string[],
  index: number,
  option: string,
  mode: "strict" | "lenient"
): string | undefined {
  const value = argv[index + 1];
  if (value === undefined) {
    if (mode === "strict") {
      throw new DiagnosticsInputError(`Missing value for ${option}.`);
    }
    return undefined;
  }
  if (value.startsWith("--")) {
    if (mode === "strict") {
      throw new DiagnosticsInputError(`Missing value for ${option}; got option ${value} instead.`);
    }
    return undefined;
  }
  return value;
}

function parseTimeout(value: string, option: string): number {
  if (!/^\d+$/.test(value)) {
    throw new DiagnosticsInputError(`${option} must be an integer millisecond value.`);
  }
  const parsed = Number(value);
  if (!timeoutMsAllowed(parsed)) {
    throw new DiagnosticsInputError(`${option} must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`);
  }
  return parsed;
}

function assertNoSensitiveAliasValue(value: string | undefined, option: string): void {
  if (value !== undefined && containsSensitiveMaterial(value)) {
    throw new DiagnosticsInputError(`${option} contains a marker blocked by the diagnostics redaction set; run with --help for the rejection list.`);
  }
}

function validateTimeoutNumber(value: number, option: string): number {
  if (!timeoutMsAllowed(value)) {
    throw new DiagnosticsInputError(`${option} must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

function assertNoPrivateKeyPathValue(value: string | undefined, option: string): void {
  if (value !== undefined && containsPrivateKeyMaterial(value)) {
    throw new DiagnosticsInputError(`${option} contains Sui CLI secret-key material; remove it from the path.`);
  }
}

function summarizeClientEnv(rawClientEnv: string | undefined): string | undefined {
  if (rawClientEnv === undefined) {
    return undefined;
  }
  return clientEnvAllowed(rawClientEnv) ? redactSensitive(rawClientEnv) : INVALID_CLIENT_ENV_MARKER;
}

function summarizeOutputDir(rawOutputDir: string | undefined, cwd: string): string | null {
  if (rawOutputDir === undefined) {
    return null;
  }
  try {
    return redactSensitive(validateArtifactPath(pathFromUserInput(rawOutputDir, cwd), cwd, "output directory"));
  } catch {
    return UNSAFE_OUTPUT_DIR_MARKER;
  }
}

function summarizeTimeouts(raw: RawDiagnosticsArgv): SuiCliDiagnosticsOutput["input"]["timeouts"] | undefined {
  let readMs = DEFAULT_READ_TIMEOUT_MS;
  let replayMs = DEFAULT_REPLAY_TIMEOUT_MS;
  let analyzeMs = DEFAULT_ANALYZE_TIMEOUT_MS;
  let hasTimeout = false;

  if (raw.readTimeoutMs !== undefined) {
    const parsed = parseTimeoutOrUndefined(raw.readTimeoutMs, "--read-timeout-ms");
    if (parsed !== undefined) {
      readMs = parsed;
      hasTimeout = true;
    }
  }
  if (raw.replayTimeoutMs !== undefined) {
    const parsed = parseTimeoutOrUndefined(raw.replayTimeoutMs, "--replay-timeout-ms");
    if (parsed !== undefined) {
      replayMs = parsed;
      hasTimeout = true;
    }
  }
  if (raw.analyzeTimeoutMs !== undefined) {
    const parsed = parseTimeoutOrUndefined(raw.analyzeTimeoutMs, "--analyze-timeout-ms");
    if (parsed !== undefined) {
      analyzeMs = parsed;
      hasTimeout = true;
    }
  }

  return hasTimeout ? { readMs, replayMs, analyzeMs } : undefined;
}

function summarizeTimeoutValues(input: DiagnosticsInput): SuiCliDiagnosticsOutput["input"]["timeouts"] | undefined {
  return timeoutMsAllowed(input.readTimeoutMs)
    && timeoutMsAllowed(input.replayTimeoutMs)
    && timeoutMsAllowed(input.analyzeTimeoutMs)
    ? {
      readMs: input.readTimeoutMs,
      replayMs: input.replayTimeoutMs,
      analyzeMs: input.analyzeTimeoutMs
    }
    : undefined;
}

function parseTimeoutOrUndefined(value: string, option: string): number | undefined {
  try {
    return parseTimeout(value, option);
  } catch {
    return undefined;
  }
}
