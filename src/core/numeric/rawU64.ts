import { z } from "zod";

export const MAX_RAW_U64 = (1n << 64n) - 1n;
const CANONICAL_UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const SIGNED_RAW_INTEGER_PATTERN = /^(?:0|-?[1-9][0-9]*)$/;

export function parseRawU64(
  value: string,
  field: string,
  options: { positive?: boolean } = {}
): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${field} must be an unsigned integer string`);
  }
  const amount = BigInt(value);
  if (options.positive && amount === 0n) {
    throw new Error(`${field} must be positive`);
  }
  if (amount > MAX_RAW_U64) {
    throw new Error(`${field} must fit u64`);
  }
  return amount;
}

export function makeRawU64StringSchema(field: string) {
  const label = field === "rawAmount" ? "amount" : field;
  return z.string().min(1).refine((value) => {
    try {
      parseRawU64(value, field);
      return true;
    } catch {
      return false;
    }
  }, `Expected a raw u64 ${label} string`);
}

export function parseCanonicalRawU64(
  value: string,
  field: string,
  options: { positive?: boolean } = {}
): bigint {
  if (!CANONICAL_UNSIGNED_INTEGER_PATTERN.test(value)) {
    throw new Error(`${field} must be a canonical unsigned integer string`);
  }
  return parseRawU64(value, field, options);
}

export function makeCanonicalRawU64StringSchema(field: string) {
  return z.string().min(1).refine((value) => {
    try {
      parseCanonicalRawU64(value, field);
      return true;
    } catch {
      return false;
    }
  }, "Expected an unsigned integer string");
}

export function parseSignedRawInteger(value: string, field: string): bigint {
  if (!SIGNED_RAW_INTEGER_PATTERN.test(value)) {
    throw new Error(`${field} must be a signed integer string`);
  }
  return BigInt(value);
}

export function makeSignedRawIntegerStringSchema(field: string) {
  return z.string().min(1).refine((value) => {
    try {
      parseSignedRawInteger(value, field);
      return true;
    } catch {
      return false;
    }
  }, "Expected a signed integer string");
}
