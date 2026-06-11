import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  GAS_PROFILE_FILE_PREFIX,
  TRACE_ARTIFACT_FILENAME
} from "./sui-cli-transaction-diagnostics-types.js";

export function replayTransactionOutputDir(outputDir: string, digest: string): string {
  return resolve(outputDir, digest);
}

export function expectedReplayTraceFile(outputDir: string, digest: string): string {
  return resolve(replayTransactionOutputDir(outputDir, digest), TRACE_ARTIFACT_FILENAME);
}

export type FileFingerprint = {
  ctimeMs: number;
  ino: number;
  mtimeMs: number;
  size: number;
};

export function discoverReplayTraceFiles(
  outputDir: string,
  digest: string,
  before: FileFingerprint | undefined,
  candidateFingerprintsBefore: Map<string, FileFingerprint>
): { traceFiles: string[]; preexistingUnchanged: boolean; layoutDrift: boolean; ambiguous: boolean } {
  const traceFile = expectedReplayTraceFile(outputDir, digest);
  const after = fileFingerprint(traceFile);
  const preexistingUnchanged = before !== undefined && after !== undefined && sameFileFingerprint(before, after);
  if (after !== undefined && !preexistingUnchanged) {
    return { traceFiles: [traceFile], preexistingUnchanged: false, layoutDrift: false, ambiguous: false };
  }
  const candidates = replayTraceCandidateFiles(replayTransactionOutputDir(outputDir, digest))
    .filter((candidate) => candidate !== traceFile)
    .filter((candidate) => fileFingerprintChanged(candidateFingerprintsBefore.get(candidate), fileFingerprint(candidate)));
  if (candidates.length === 1) {
    return { traceFiles: candidates, preexistingUnchanged, layoutDrift: true, ambiguous: false };
  }
  return { traceFiles: [], preexistingUnchanged, layoutDrift: candidates.length > 0, ambiguous: candidates.length > 1 };
}

export function fileFingerprint(path: string): FileFingerprint | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const stat = lstatSync(path);
  if (!stat.isFile()) {
    return undefined;
  }
  return { ctimeMs: stat.ctimeMs, ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size };
}

export function sameFileFingerprint(left: FileFingerprint, right: FileFingerprint): boolean {
  return left.ctimeMs === right.ctimeMs
    && left.ino === right.ino
    && left.mtimeMs === right.mtimeMs
    && left.size === right.size;
}

export function traceCandidateFingerprints(transactionOutputDir: string): Map<string, FileFingerprint> {
  return fileFingerprintMap(replayTraceCandidateFiles(transactionOutputDir));
}

export function gasProfileFingerprints(outputDir: string): Map<string, FileFingerprint> {
  return fileFingerprintMap(gasProfileCandidateFiles(outputDir));
}

export function discoverGasProfileFiles(
  outputDir: string,
  tracePath: string,
  before: Map<string, FileFingerprint>
): { profileFiles: string[]; layoutDrift: boolean; ambiguous: boolean } {
  const expected = expectedGasProfileFile(outputDir, tracePath);
  const expectedAfter = fileFingerprint(expected);
  if (fileFingerprintChanged(before.get(expected), expectedAfter)) {
    return { profileFiles: [expected], layoutDrift: false, ambiguous: false };
  }
  const candidates = gasProfileCandidateFiles(outputDir)
    .filter((candidate) => candidate !== expected)
    .filter((candidate) => fileFingerprintChanged(before.get(candidate), fileFingerprint(candidate)));
  if (candidates.length === 1) {
    return { profileFiles: candidates, layoutDrift: true, ambiguous: false };
  }
  return { profileFiles: [], layoutDrift: candidates.length > 0, ambiguous: candidates.length > 1 };
}

function replayTraceCandidateFiles(transactionOutputDir: string): string[] {
  if (!existsSync(transactionOutputDir)) {
    return [];
  }
  return walkFiles(transactionOutputDir)
    .filter((file) => basename(file).toLowerCase().endsWith(".json.zst"))
    .sort();
}

function gasProfileCandidateFiles(outputDir: string): string[] {
  if (!existsSync(outputDir)) {
    return [];
  }
  const stat = lstatSync(outputDir);
  if (!stat.isDirectory()) {
    return [];
  }
  return readdirSync(outputDir)
    .map((entry) => resolve(outputDir, entry))
    .filter((file) => {
      const name = basename(file).toLowerCase();
      const stat = lstatSync(file);
      return stat.isFile() && name.startsWith(GAS_PROFILE_FILE_PREFIX) && name.endsWith(".json");
    })
    .sort();
}

function fileFingerprintMap(files: string[]): Map<string, FileFingerprint> {
  const fingerprints = new Map<string, FileFingerprint>();
  for (const file of files) {
    const fingerprint = fileFingerprint(file);
    if (fingerprint !== undefined) {
      fingerprints.set(file, fingerprint);
    }
  }
  return fingerprints;
}

function fileFingerprintChanged(before: FileFingerprint | undefined, after: FileFingerprint | undefined): boolean {
  return after !== undefined && (before === undefined || !sameFileFingerprint(before, after));
}

function expectedGasProfileFile(outputDir: string, tracePath: string): string {
  return resolve(outputDir, `${GAS_PROFILE_FILE_PREFIX}${gasProfileNameFromTracePath(tracePath)}.json`);
}

function gasProfileNameFromTracePath(tracePath: string): string {
  const name = basename(tracePath);
  const dotIndex = name.indexOf(".");
  return dotIndex === -1 ? name : name.slice(0, dotIndex);
}

function walkFiles(path: string): string[] {
  const stat = lstatSync(path);
  if (stat.isFile()) {
    return [path];
  }
  // Symlink artifacts are intentionally ignored; diagnostics trust regular files and directories only.
  if (!stat.isDirectory()) {
    return [];
  }
  return readdirSync(path)
    .flatMap((entry) => walkFiles(resolve(path, entry)));
}
