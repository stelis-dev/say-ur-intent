import {
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS
} from "./sui-cli-transaction-diagnostics-types.js";

// Shared guards for CLI diagnostics input values, CLI output values, and command invariants.
export function isCliChainIdentifier(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}$/i.test(value);
}

export function clientEnvAllowed(value: string | undefined): value is string {
  return typeof value === "string" && value !== "." && value !== ".." && /^[A-Za-z0-9_.-]{1,64}$/.test(value);
}

export function timeoutMsAllowed(value: number): boolean {
  return Number.isSafeInteger(value) && value >= MIN_TIMEOUT_MS && value <= MAX_TIMEOUT_MS;
}
