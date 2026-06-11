import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SUI_MAINNET_CHAIN_IDENTIFIER } from "../src/runtime/suiEndpoint.js";
// Boundary invariants for this manual debug utility:
// argv and direct inputs share normalization; invalid direct inputs use safe echo only;
// allowlisted command validation runs before CLI execution or artifact directory writes;
// CLI-derived strings are redacted/capped before output; failure kinds keep source/provenance.
import {
  discoverGasProfileFiles,
  discoverReplayTraceFiles,
  expectedReplayTraceFile,
  fileFingerprint,
  gasProfileFingerprints,
  replayTransactionOutputDir,
  traceCandidateFingerprints
} from "./sui-cli-transaction-diagnostics-artifacts.js";
import {
  normalizeSuiCliDiagnosticsInput,
  parseSuiCliDiagnosticsArgs,
  summarizeSuiCliDiagnosticsFailureInput,
  summarizeSuiCliDiagnosticsFailureInputValue
} from "./sui-cli-transaction-diagnostics-parser.js";
import {
  activeEnvCommand,
  analyzeTraceCommand,
  assertAllowedCommand,
  chainIdentifierCommand,
  envsCommand,
  objectCommand,
  replayCommand,
  txBlockCommand,
  versionCommand
} from "./sui-cli-transaction-diagnostics-policy.js";
import {
  addLimitation,
  commandSucceeded,
  execute,
  fail,
  firstLine,
  runCommand,
  suiCliVersionMatchesSource
} from "./sui-cli-transaction-diagnostics-runner.js";
import { redactSensitive } from "./sui-cli-transaction-diagnostics-redaction.js";
import {
  objectIdFromCli,
  parseJsonObject,
  parseJsonString,
  selectMainnetEnv,
  summarizeObject,
  summarizeTxBlock,
  transactionDigestFromCli
} from "./sui-cli-transaction-diagnostics-summary.js";
import {
  AUTHORITY,
  DECLARED_NETWORK,
  DiagnosticsAllowlistError,
  DiagnosticsInputError,
  PURPOSE,
  SOURCE_CHECKED_SUI_CLI_VERSION,
  SUI_CLI_TRANSACTION_DIAGNOSTICS_USAGE,
  type DiagnosticsContext,
  type DiagnosticsInput,
  type SuiCliObjectSummary,
  type SuiCliDiagnosticsOutput,
  type SuiCliDiagnosticsRunResult,
  expectedMainnetCliChainIdentifier
} from "./sui-cli-transaction-diagnostics-types.js";
import { isCliChainIdentifier } from "./sui-cli-transaction-diagnostics-validators.js";

export {
  FORBIDDEN_SUI_CLI_TERMS,
  SUI_CLI_TRANSACTION_DIAGNOSTICS_USAGE,
  type SuiCliCommandResult,
  type SuiCliCommandRunner,
  type SuiCliCommandSpec,
  expectedMainnetCliChainIdentifier
} from "./sui-cli-transaction-diagnostics-types.js";
export { parseSuiCliDiagnosticsArgs } from "./sui-cli-transaction-diagnostics-parser.js";
export {
  activeEnvCommand,
  analyzeTraceCommand,
  assertAllowedCommand,
  chainIdentifierCommand,
  envsCommand,
  objectCommand,
  replayCommand,
  txBlockCommand,
  versionCommand
} from "./sui-cli-transaction-diagnostics-policy.js";

export function runSuiCliDiagnosticsFromArgv(
  argv: string[],
  context: Partial<DiagnosticsContext> = {}
): SuiCliDiagnosticsRunResult {
  const cwd = context.cwd ?? process.cwd();
  const now = context.now ?? new Date();
  let input: DiagnosticsInput;
  try {
    input = parseSuiCliDiagnosticsArgs(argv, { cwd, now });
  } catch (error) {
    return inputFailure(error, argv, cwd, now);
  }
  return runSuiCliDiagnostics(input, {
    cwd,
    now,
    runner: context.runner ?? runCommand
  });
}

export function runSuiCliDiagnostics(
  input: DiagnosticsInput,
  context: DiagnosticsContext
): SuiCliDiagnosticsRunResult {
  let output: SuiCliDiagnosticsOutput | undefined;
  try {
    const normalizedInput = normalizeSuiCliDiagnosticsInput(input, { cwd: context.cwd });
    output = createDiagnosticsOutput(normalizedInput, context);
    return runSuiCliDiagnosticsCore(normalizedInput, context, output);
  } catch (error) {
    const kind = error instanceof DiagnosticsInputError
      ? "input_invalid"
      : error instanceof DiagnosticsAllowlistError ? error.kind : "internal_error";
    if (output === undefined) {
      return directInputFailure(error, input, context, kind);
    }
    return fail(output, kind, errorMessage(error));
  }
}

function runSuiCliDiagnosticsCore(
  input: DiagnosticsInput,
  context: DiagnosticsContext,
  output: SuiCliDiagnosticsOutput
): SuiCliDiagnosticsRunResult {
  const expectedCliChainIdentifier = output.suiCli.expectedCliChainIdentifier;
  const version = execute(context, output, versionCommand(input.readTimeoutMs));
  if (!commandSucceeded(version)) {
    return fail(output, "missing_cli", "Could not run `sui --version`.");
  }
  output.suiCli.version = redactSensitive(firstLine(version.stdout));
  const versionMatchesSource = suiCliVersionMatchesSource(output.suiCli.version);
  if (!versionMatchesSource) {
    addLimitation(output, "sui_cli_version_mismatch");
  }

  const activeEnv = execute(context, output, activeEnvCommand(input.readTimeoutMs));
  if (commandSucceeded(activeEnv)) {
    const parsedActiveEnv = parseJsonString(activeEnv.stdout);
    if (parsedActiveEnv === undefined) {
      addLimitation(output, "unrecognized_json_shape");
    } else {
      output.suiCli.activeEnv = redactSensitive(parsedActiveEnv);
    }
  } else {
    addLimitation(output, "command_failure");
  }

  let selectedClientEnv = input.clientEnv;
  if (selectedClientEnv !== undefined) {
    output.suiCli.selectedEnv = redactSensitive(selectedClientEnv);
  }
  if (input.mainnet) {
    const envs = execute(context, output, envsCommand(input.readTimeoutMs));
    if (!commandSucceeded(envs)) {
      return fail(output, "command_failure", "Could not read Sui CLI environments.");
    }
    const mainnetEnv = selectMainnetEnv(envs.stdout, expectedCliChainIdentifier);
    if (!mainnetEnv.ok) {
      return fail(output, mainnetEnv.kind, mainnetEnv.message);
    }
    selectedClientEnv = mainnetEnv.alias;
    output.suiCli.selectedEnv = redactSensitive(mainnetEnv.alias);
  }

  const chainIdentifier = execute(context, output, chainIdentifierCommand(input.readTimeoutMs, selectedClientEnv));
  if (!commandSucceeded(chainIdentifier)) {
    return fail(output, "command_failure", "Could not verify Sui CLI chain identifier.");
  }
  const cliChainIdentifier = parseJsonString(chainIdentifier.stdout);
  if (cliChainIdentifier === undefined) {
    return fail(output, "unrecognized_json_shape", "Sui CLI chain identifier output was not a JSON string.");
  }
  if (!isCliChainIdentifier(cliChainIdentifier)) {
    return fail(output, "unrecognized_json_shape", "Sui CLI chain identifier output was not an 8-character hex string.");
  }
  const normalizedCliChainIdentifier = cliChainIdentifier.toLowerCase();
  output.suiCli.chainIdentifier = normalizedCliChainIdentifier;
  if (normalizedCliChainIdentifier !== expectedCliChainIdentifier) {
    return fail(output, "chain_mismatch", "Sui CLI chain identifier does not match mainnet.");
  }

  const txBlock = execute(context, output, txBlockCommand(input.digest, input.readTimeoutMs, selectedClientEnv));
  if (!commandSucceeded(txBlock)) {
    return fail(output, "command_failure", "Could not inspect transaction block.");
  }
  const txBlockJson = parseJsonObject(txBlock.stdout);
  if (txBlockJson === undefined) {
    addLimitation(output, "unrecognized_json_shape");
  } else {
    const responseDigest = transactionDigestFromCli(txBlockJson);
    if (responseDigest === undefined) {
      return fail(output, "unrecognized_json_shape", "Sui CLI transaction block output did not include a valid digest.");
    }
    if (responseDigest !== input.digest) {
      return fail(output, "tx_block_digest_mismatch", "Sui CLI transaction block digest did not match the requested digest.");
    }
    output.txBlockSummary = summarizeTxBlock(txBlockJson, versionMatchesSource);
    if (output.txBlockSummary.unrecognizedExecutionStatus !== undefined) {
      addLimitation(output, "unrecognized_execution_status");
    }
    for (const field of output.txBlockSummary.countFieldsUnavailable ?? []) {
      addLimitation(output, "tx_block_count_field_missing", `txBlockSummary.counts.${field}`);
    }
    if (!output.txBlockSummary.effectsAvailable) {
      addLimitation(output, "effects_missing");
    }
  }

  const objectSummaries: SuiCliObjectSummary[] = [];
  for (const objectId of input.objectIds) {
    const objectResult = execute(context, output, objectCommand(objectId, input.readTimeoutMs, selectedClientEnv));
    if (!commandSucceeded(objectResult)) {
      return fail(output, "command_failure", `Could not inspect object ${objectId}.`);
    }
    const objectJson = parseJsonObject(objectResult.stdout);
    if (objectJson === undefined) {
      addLimitation(output, "unrecognized_json_shape");
      objectSummaries.push({
        source: "sui_cli_object_output" as const,
        sourceCheckedVersion: SOURCE_CHECKED_SUI_CLI_VERSION,
        sourceVersionMatchesInstalledCli: versionMatchesSource,
        requestedObjectId: objectId
      });
    } else {
      const responseObjectId = objectIdFromCli(objectJson);
      if (responseObjectId === undefined) {
        return fail(output, "unrecognized_json_shape", "Sui CLI object output did not include a valid objectId.");
      }
      if (responseObjectId !== objectId) {
        return fail(output, "object_id_mismatch", "Sui CLI object id did not match the requested object id.");
      }
      objectSummaries.push(summarizeObject(objectId, objectJson, versionMatchesSource));
    }
  }
  if (objectSummaries.length > 0) {
    output.objectSummaries = objectSummaries;
  }

  let traceFiles: string[] = [];
  if (input.trace) {
    const replaySpec = replayCommand(input.digest, input.outputDir, input.replayTimeoutMs, selectedClientEnv);
    assertAllowedCommand(replaySpec, context.cwd);
    mkdirSync(input.outputDir, { recursive: true });
    const transactionOutputDir = replayTransactionOutputDir(input.outputDir, input.digest);
    const traceFingerprintBefore = fileFingerprint(expectedReplayTraceFile(input.outputDir, input.digest));
    const traceCandidateFingerprintsBefore = traceCandidateFingerprints(transactionOutputDir);
    const replay = execute(context, output, replaySpec);
    if (!commandSucceeded(replay)) {
      return fail(output, "command_failure", "Could not replay transaction.");
    }
    const replayArtifacts = discoverReplayTraceFiles(
      input.outputDir,
      input.digest,
      traceFingerprintBefore,
      traceCandidateFingerprintsBefore
    );
    traceFiles = replayArtifacts.traceFiles;
    if (replayArtifacts.preexistingUnchanged) {
      addLimitation(output, "trace_file_preexisting");
    }
    if (replayArtifacts.layoutDrift) {
      addLimitation(output, "replay_layout_drift");
    }
    if (replayArtifacts.ambiguous) {
      addLimitation(output, "trace_file_ambiguous");
    }
    output.replay = {
      outputDir: redactSensitive(input.outputDir),
      transactionOutputDir: redactSensitive(transactionOutputDir),
      traceFiles: traceFiles.map(redactSensitive)
    };
  }

  if (input.gasProfile) {
    const tracePath = input.traceFile ?? (traceFiles.length === 1 ? traceFiles[0] : undefined);
    if (tracePath === undefined) {
      addLimitation(output, "trace_file_not_resolved");
      addLimitation(output, "skipped_gas_profile");
    } else {
      const gasProfileSpec = analyzeTraceCommand(tracePath, input.outputDir, input.analyzeTimeoutMs);
      assertAllowedCommand(gasProfileSpec, context.cwd);
      mkdirSync(input.outputDir, { recursive: true });
      const profileFilesBefore = gasProfileFingerprints(input.outputDir);
      const gasProfile = execute(context, output, gasProfileSpec);
      if (!commandSucceeded(gasProfile)) {
        return fail(output, "command_failure", "Could not generate gas profile.");
      }
      const gasProfileArtifacts = discoverGasProfileFiles(input.outputDir, tracePath, profileFilesBefore);
      const profileFiles = gasProfileArtifacts.profileFiles;
      if (profileFiles.length === 0) {
        addLimitation(output, "gas_profile_file_not_resolved");
      }
      if (gasProfileArtifacts.layoutDrift) {
        addLimitation(output, "gas_profile_layout_drift");
      }
      if (gasProfileArtifacts.ambiguous) {
        addLimitation(output, "gas_profile_file_ambiguous");
      }
      output.gasProfile = {
        outputDir: redactSensitive(input.outputDir),
        profileFiles: profileFiles.map(redactSensitive)
      };
    }
  }

  return {
    exitCode: 0,
    output
  };
}

function createDiagnosticsOutput(input: DiagnosticsInput, context: DiagnosticsContext): SuiCliDiagnosticsOutput {
  const expectedCliChainIdentifier = expectedMainnetCliChainIdentifier();
  return {
    generatedAt: context.now.toISOString(),
    purpose: PURPOSE,
    authority: AUTHORITY,
    suiCli: {
      declaredNetwork: DECLARED_NETWORK,
      expectedBase58ChainIdentifier: SUI_MAINNET_CHAIN_IDENTIFIER,
      expectedCliChainIdentifier,
      sourceCheckedVersion: SOURCE_CHECKED_SUI_CLI_VERSION
    },
    input: {
      digest: input.digest,
      objectIds: input.objectIds,
      ...(input.mainnet ? { mainnet: true } : {}),
      ...(input.clientEnv === undefined ? {} : { clientEnv: redactSensitive(input.clientEnv) }),
      trace: input.trace,
      gasProfile: input.gasProfile,
      ...(input.traceFile === undefined ? {} : { traceFile: redactSensitive(input.traceFile) }),
      outputDir: redactSensitive(input.outputDir),
      timeouts: {
        readMs: input.readTimeoutMs,
        replayMs: input.replayTimeoutMs,
        analyzeMs: input.analyzeTimeoutMs
      }
    },
    commands: [],
    limitations: [],
    limitationDetails: []
  };
}

function inputFailure(error: unknown, argv: string[], cwd: string, now: Date): SuiCliDiagnosticsRunResult {
  const expectedCliChainIdentifier = expectedMainnetCliChainIdentifier();
  const kind = error instanceof DiagnosticsInputError ? error.kind : "internal_error";
  return {
    exitCode: 1,
    output: {
      generatedAt: now.toISOString(),
      purpose: PURPOSE,
      authority: AUTHORITY,
      suiCli: {
        declaredNetwork: DECLARED_NETWORK,
        expectedBase58ChainIdentifier: SUI_MAINNET_CHAIN_IDENTIFIER,
        expectedCliChainIdentifier,
        sourceCheckedVersion: SOURCE_CHECKED_SUI_CLI_VERSION
      },
      input: summarizeSuiCliDiagnosticsFailureInput(argv, { cwd }),
      commands: [],
      limitations: [kind],
      limitationDetails: [{ kind }],
      error: {
        kind,
        message: redactSensitive(errorMessage(error))
      }
    }
  };
}

function directInputFailure(
  error: unknown,
  input: DiagnosticsInput,
  context: DiagnosticsContext,
  kind: string
): SuiCliDiagnosticsRunResult {
  const expectedCliChainIdentifier = expectedMainnetCliChainIdentifier();
  return {
    exitCode: 1,
    output: {
      generatedAt: context.now.toISOString(),
      purpose: PURPOSE,
      authority: AUTHORITY,
      suiCli: {
        declaredNetwork: DECLARED_NETWORK,
        expectedBase58ChainIdentifier: SUI_MAINNET_CHAIN_IDENTIFIER,
        expectedCliChainIdentifier,
        sourceCheckedVersion: SOURCE_CHECKED_SUI_CLI_VERSION
      },
      input: summarizeSuiCliDiagnosticsFailureInputValue(input, { cwd: context.cwd }),
      commands: [],
      limitations: [kind],
      limitationDetails: [{ kind }],
      error: {
        kind,
        message: redactSensitive(errorMessage(error))
      }
    }
  };
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return `${error.name}: ${error.message}`;
}

function main(): void {
  const argv = process.argv.slice(2);
  if (shouldPrintSuiCliDiagnosticsUsage(argv)) {
    process.stderr.write(SUI_CLI_TRANSACTION_DIAGNOSTICS_USAGE);
    process.exitCode = 0;
    return;
  }
  const result = runSuiCliDiagnosticsFromArgv(process.argv.slice(2), {
    cwd: process.cwd(),
    now: new Date()
  });
  process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

export function shouldPrintSuiCliDiagnosticsUsage(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
