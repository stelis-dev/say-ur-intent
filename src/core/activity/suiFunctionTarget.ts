import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";
import { parseSuiAddress } from "../suiAddress.js";
import { TransactionActivityError, type SuiFunctionTarget } from "./transactionActivityTypes.js";

const MOVE_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseSuiFunctionTarget(value: string): SuiFunctionTarget {
  if (value.length === 0 || value.trim() !== value || value.includes("<") || value.includes(">")) {
    throw invalidFunctionTarget();
  }
  const parts = value.split("::");
  if (parts.length !== 3) {
    throw invalidFunctionTarget();
  }
  const [packageId, moduleName, functionName] = parts as [string, string, string];
  const normalizedPackage = parseFunctionPackageAddress(packageId);
  if (
    normalizedPackage === undefined ||
    !MOVE_IDENTIFIER_PATTERN.test(moduleName) ||
    !MOVE_IDENTIFIER_PATTERN.test(functionName)
  ) {
    throw invalidFunctionTarget();
  }
  return {
    package: normalizedPackage,
    module: moduleName,
    function: functionName,
    target: `${normalizedPackage}::${moduleName}::${functionName}`
  };
}

function parseFunctionPackageAddress(value: string): string | undefined {
  const normalized = parseSuiAddress(value);
  if (normalized !== undefined) {
    return normalized;
  }
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    return undefined;
  }
  const normalizedShort = normalizeSuiAddress(value);
  return isValidSuiAddress(normalizedShort) ? normalizedShort : undefined;
}

function invalidFunctionTarget(): TransactionActivityError {
  return new TransactionActivityError("input_invalid", "Invalid Sui function target", {
    field: "function",
    reason: "invalid_function_target"
  });
}
