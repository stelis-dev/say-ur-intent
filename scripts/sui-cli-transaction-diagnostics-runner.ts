import { spawnSync } from "node:child_process";
import {
  MAX_SUI_CLI_STDIO_BUFFER_BYTES,
  SOURCE_CHECKED_SUI_CLI_VERSION,
  type CommandOutput,
  type DiagnosticsContext,
  type SuiCliCommandResult,
  type SuiCliCommandSpec,
  type SuiCliDiagnosticsOutput,
  type SuiCliDiagnosticsRunResult
} from "./sui-cli-transaction-diagnostics-types.js";
import { assertAllowedCommand } from "./sui-cli-transaction-diagnostics-policy.js";
import {
  redactSensitive,
  snippet
} from "./sui-cli-transaction-diagnostics-redaction.js";

export function runCommand(spec: SuiCliCommandSpec): SuiCliCommandResult {
  const startedAt = Date.now();
  const result = spawnSync(spec.command, spec.args, {
    encoding: "utf8",
    maxBuffer: MAX_SUI_CLI_STDIO_BUFFER_BYTES,
    shell: spec.shell,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: spec.timeoutMs
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs: Date.now() - startedAt,
    ...(result.error === undefined ? {} : { error: result.error.message }),
    ...(result.error !== undefined && "code" in result.error && result.error.code === "ETIMEDOUT" ? { timedOut: true } : {})
  };
}

export function execute(
  context: DiagnosticsContext,
  output: SuiCliDiagnosticsOutput,
  spec: SuiCliCommandSpec
): SuiCliCommandResult {
  assertAllowedCommand(spec, context.cwd);
  const result = context.runner(spec);
  output.commands.push(commandOutput(spec, result));
  if (result.timedOut === true) {
    addLimitation(output, "timeout", spec.name);
  }
  if (!commandSucceeded(result)) {
    addLimitation(output, "command_failure", spec.name);
  }
  return result;
}

export function commandSucceeded(result: SuiCliCommandResult): boolean {
  return result.exitCode === 0 && result.timedOut !== true && result.error === undefined;
}

export function fail(output: SuiCliDiagnosticsOutput, kind: string, message: string): SuiCliDiagnosticsRunResult {
  addLimitation(output, kind);
  output.error = { kind, message: redactSensitive(message) };
  return { exitCode: 1, output };
}

export function addLimitation(output: SuiCliDiagnosticsOutput, limitation: string, source?: string): void {
  if (!output.limitations.includes(limitation)) {
    output.limitations.push(limitation);
  }
  const hasSameDetail = output.limitationDetails.some((detail) => detail.kind === limitation && detail.source === source);
  const hasSourcedDetail = source === undefined
    && output.limitationDetails.some((detail) => detail.kind === limitation && detail.source !== undefined);
  if (!hasSameDetail && !hasSourcedDetail) {
    output.limitationDetails.push(source === undefined ? { kind: limitation } : { kind: limitation, source });
  }
}

export function firstLine(source: string): string {
  return source.trim().split(/\r?\n/, 1)[0] ?? "";
}

export function suiCliVersionMatchesSource(version: string): boolean {
  const escaped = SOURCE_CHECKED_SUI_CLI_VERSION.replace(/\./g, "\\.");
  return new RegExp(`(^|[^0-9.])${escaped}([^0-9.]|$)`).test(version);
}

function commandOutput(spec: SuiCliCommandSpec, result: SuiCliCommandResult): CommandOutput {
  const args = spec.args.map(redactSensitive);
  return {
    name: spec.name,
    args,
    argsRedacted: args.some((arg, index) => arg !== spec.args[index]),
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timeoutMs: spec.timeoutMs,
    timeout: result.timedOut === true,
    ...(result.error === undefined ? {} : { error: redactSensitive(result.error) }),
    ...(!commandSucceeded(result) && result.stdout.trim().length > 0
      ? { stdoutSnippet: snippet(result.stdout) }
      : {}),
    ...(!commandSucceeded(result) && result.stderr.trim().length > 0
      ? { stderrSnippet: snippet(result.stderr) }
      : {})
  };
}
