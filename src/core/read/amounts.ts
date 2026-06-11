import { ReadServiceInputError } from "./readServiceTypes.js";

export function sumRawAmounts(rawAmounts: string[], field = "balance"): string {
  let total = 0n;
  for (const rawAmount of rawAmounts) {
    if (!/^\d+$/.test(rawAmount)) {
      throw new ReadServiceInputError("input_invalid", "raw amount must be an unsigned integer string", {
        field,
        value: rawAmount
      });
    }
    total += BigInt(rawAmount);
  }
  return total.toString();
}
