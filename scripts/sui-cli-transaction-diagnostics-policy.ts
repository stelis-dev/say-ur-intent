import { isValidSuiObjectId, isValidTransactionDigest } from "@mysten/sui/utils";
import {
  DiagnosticsAllowlistError,
  FORBIDDEN_SUI_CLI_TERMS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  type SuiCliCommandSpec
} from "./sui-cli-transaction-diagnostics-types.js";
import {
  pathFromUserInput,
  validateArtifactPath,
  validateTraceFilePath
} from "./sui-cli-transaction-diagnostics-paths.js";
import {
  containsPrivateKeyMaterial,
  containsSensitiveMaterial
} from "./sui-cli-transaction-diagnostics-redaction.js";
import {
  clientEnvAllowed,
  timeoutMsAllowed
} from "./sui-cli-transaction-diagnostics-validators.js";

export function versionCommand(timeoutMs: number): SuiCliCommandSpec {
  return { name: "sui.version", command: "sui", args: ["--version"], shell: false, timeoutMs };
}

export function activeEnvCommand(timeoutMs: number): SuiCliCommandSpec {
  return { name: "sui.client.active_env", command: "sui", args: ["client", "active-env", "--json"], shell: false, timeoutMs };
}

export function envsCommand(timeoutMs: number): SuiCliCommandSpec {
  return { name: "sui.client.envs", command: "sui", args: ["client", "envs", "--json"], shell: false, timeoutMs };
}

export function chainIdentifierCommand(timeoutMs: number, clientEnv?: string | undefined): SuiCliCommandSpec {
  return {
    name: "sui.client.chain_identifier",
    command: "sui",
    args: clientArgs(clientEnv, "chain-identifier", "--json"),
    shell: false,
    timeoutMs
  };
}

export function txBlockCommand(digest: string, timeoutMs: number, clientEnv?: string | undefined): SuiCliCommandSpec {
  return { name: "sui.client.tx_block", command: "sui", args: clientArgs(clientEnv, "tx-block", "--json", digest), shell: false, timeoutMs };
}

export function objectCommand(objectId: string, timeoutMs: number, clientEnv?: string | undefined): SuiCliCommandSpec {
  return { name: "sui.client.object", command: "sui", args: clientArgs(clientEnv, "object", "--json", objectId), shell: false, timeoutMs };
}

export function replayCommand(
  digest: string,
  outputDir: string,
  timeoutMs: number,
  clientEnv?: string | undefined
): SuiCliCommandSpec {
  return {
    name: "sui.replay.trace",
    command: "sui",
    args: clientEnv === undefined
      ? ["replay", "--digest", digest, "--trace", "--output-dir", outputDir, "--show-effects", "true"]
      : ["replay", "--client.env", clientEnv, "--digest", digest, "--trace", "--output-dir", outputDir, "--show-effects", "true"],
    shell: false,
    timeoutMs
  };
}

export function analyzeTraceCommand(traceFile: string, outputDir: string, timeoutMs: number): SuiCliCommandSpec {
  return {
    name: "sui.analyze_trace.gas_profile",
    command: "sui",
    args: ["analyze-trace", "--path", traceFile, "--output-dir", outputDir, "gas-profile"],
    shell: false,
    timeoutMs
  };
}

export function assertAllowedCommand(spec: SuiCliCommandSpec, cwd = process.cwd()): void {
  if (spec.command !== "sui" || spec.shell !== false) {
    throw new DiagnosticsAllowlistError("Sui CLI diagnostics can only run allowlisted `sui` commands with shell disabled.");
  }
  if (!timeoutMsAllowed(spec.timeoutMs)) {
    throw new DiagnosticsAllowlistError(`Sui CLI command timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds.`);
  }
  if (!commandShapeAllowed(spec, cwd)) {
    throw new DiagnosticsAllowlistError(`Sui CLI command is not allowlisted: ${spec.name}`);
  }
  if (commandUserValueHasSensitiveMaterial(spec)) {
    throw new DiagnosticsAllowlistError(`Sui CLI command includes sensitive user-supplied argument: ${spec.name}`);
  }
  const commandText = commandPolicyText(spec).toLowerCase();
  for (const forbidden of FORBIDDEN_SUI_CLI_TERMS) {
    if (commandText.includes(forbidden.toLowerCase())) {
      throw new DiagnosticsAllowlistError(`Sui CLI command includes forbidden term: ${forbidden}`);
    }
  }
}

function commandShapeAllowed(spec: SuiCliCommandSpec, cwd: string): boolean {
  switch (spec.name) {
    case "sui.version":
      return spec.args.length === 1 && spec.args[0] === "--version";
    case "sui.client.active_env":
      return exactArgs(spec.args, ["client", "active-env", "--json"]);
    case "sui.client.envs":
      return exactArgs(spec.args, ["client", "envs", "--json"]);
    case "sui.client.chain_identifier":
      return clientArgsAllowed(spec.args, ["chain-identifier", "--json"]);
    case "sui.client.tx_block":
      return clientArgsAllowed(spec.args, ["tx-block", "--json"])
        && isValidTransactionDigest(spec.args.at(-1) ?? "");
    case "sui.client.object":
      return clientArgsAllowed(spec.args, ["object", "--json"])
        && isValidSuiObjectId(spec.args.at(-1) ?? "");
    case "sui.replay.trace":
      return replayArgsAllowed(spec.args, cwd);
    case "sui.analyze_trace.gas_profile":
      return spec.args.length === 6
        && spec.args[0] === "analyze-trace"
        && spec.args[1] === "--path"
        && commandTraceFileAllowed(spec.args[2], cwd)
        && spec.args[3] === "--output-dir"
        && commandArtifactOutputDirAllowed(spec.args[4], cwd)
        && spec.args[5] === "gas-profile";
    default:
      return false;
  }
}

function clientArgs(clientEnv: string | undefined, ...tail: string[]): string[] {
  return clientEnv === undefined ? ["client", ...tail] : ["client", "--client.env", clientEnv, ...tail];
}

function replayArgsAllowed(args: string[], cwd: string): boolean {
  if (args[0] !== "replay") {
    return false;
  }
  const tailStart = args[1] === "--client.env" ? 3 : 1;
  if (tailStart === 3 && !clientEnvAllowed(args[2])) {
    return false;
  }
  const outputDir = args[tailStart + 4];
  return args.length === tailStart + 7
    && args[tailStart] === "--digest"
    && isValidTransactionDigest(args[tailStart + 1] ?? "")
    && args[tailStart + 2] === "--trace"
    && args[tailStart + 3] === "--output-dir"
    && commandArtifactOutputDirAllowed(outputDir, cwd)
    && args[tailStart + 5] === "--show-effects"
    && args[tailStart + 6] === "true";
}

function clientArgsAllowed(args: string[], tailPrefix: string[]): boolean {
  if (args[0] !== "client") {
    return false;
  }
  const tailStart = args[1] === "--client.env" ? 3 : 1;
  if (tailStart === 3 && !clientEnvAllowed(args[2])) {
    return false;
  }
  if (args.length !== tailStart + tailPrefix.length + 1 && tailPrefix[0] !== "chain-identifier") {
    return false;
  }
  if (tailPrefix[0] === "chain-identifier" && args.length !== tailStart + tailPrefix.length) {
    return false;
  }
  return tailPrefix.every((value, index) => args[tailStart + index] === value);
}

function commandTraceFileAllowed(path: string | undefined, cwd: string): path is string {
  if (typeof path !== "string") {
    return false;
  }
  try {
    validateTraceFilePath(pathFromUserInput(path, cwd));
    return true;
  } catch {
    return false;
  }
}

function commandArtifactOutputDirAllowed(path: string | undefined, cwd: string): path is string {
  if (typeof path !== "string") {
    return false;
  }
  try {
    validateArtifactPath(pathFromUserInput(path, cwd), cwd, "output directory");
    return true;
  } catch {
    return false;
  }
}

function exactArgs(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((value, index) => actual[index] === value);
}

function commandPolicyText(spec: SuiCliCommandSpec): string {
  switch (spec.name) {
    case "sui.version":
      return spec.args.join(" ");
    case "sui.client.active_env":
    case "sui.client.envs":
      return spec.args.join(" ");
    case "sui.client.chain_identifier":
      return clientCommandPolicyText(spec.args, "chain-identifier", "--json");
    case "sui.client.tx_block":
      return clientCommandPolicyText(spec.args, "tx-block", "--json");
    case "sui.client.object":
      return clientCommandPolicyText(spec.args, "object", "--json");
    case "sui.replay.trace":
      return spec.args[1] === "--client.env"
        ? ["replay", "--client.env", "--digest", "--trace", "--output-dir", "--show-effects"].join(" ")
        : ["replay", "--digest", "--trace", "--output-dir", "--show-effects"].join(" ");
    case "sui.analyze_trace.gas_profile":
      return ["analyze-trace", "--path", "--output-dir", "gas-profile"].join(" ");
    default:
      return spec.args.join(" ");
  }
}

function clientCommandPolicyText(args: string[], ...tail: string[]): string {
  return args[1] === "--client.env"
    ? ["client", "--client.env", ...tail].join(" ")
    : ["client", ...tail].join(" ");
}

function commandUserValueHasSensitiveMaterial(spec: SuiCliCommandSpec): boolean {
  return commandUserValues(spec).some(({ kind, value }) => kind === "alias"
    ? containsSensitiveMaterial(value)
    : containsPrivateKeyMaterial(value));
}

function commandUserValues(spec: SuiCliCommandSpec): Array<{ kind: "alias" | "path"; value: string }> {
  // Digests and object ids are validated as protocol identifiers. Free-form aliases reject all redaction markers;
  // artifact paths reject only actual Sui private key material and otherwise rely on output redaction.
  switch (spec.name) {
    case "sui.client.chain_identifier":
      return clientEnvValue(spec.args);
    case "sui.client.tx_block":
    case "sui.client.object":
      return clientEnvValue(spec.args);
    case "sui.replay.trace": {
      const tailStart = spec.args[1] === "--client.env" ? 3 : 1;
      return [
        ...clientEnvValue(spec.args),
        pathValue(spec.args[tailStart + 4])
      ].filter((value): value is { kind: "alias" | "path"; value: string } => value !== undefined);
    }
    case "sui.analyze_trace.gas_profile":
      return [pathValue(spec.args[2]), pathValue(spec.args[4])]
        .filter((value): value is { kind: "path"; value: string } => value !== undefined);
    default:
      return [];
  }
}

function clientEnvValue(args: string[]): Array<{ kind: "alias"; value: string }> {
  return args[1] === "--client.env" && typeof args[2] === "string" ? [{ kind: "alias", value: args[2] }] : [];
}

function pathValue(value: string | undefined): { kind: "path"; value: string } | undefined {
  return typeof value === "string" ? { kind: "path", value } : undefined;
}
