import { describe, expect, it } from "vitest";
import { parseReceipt } from "../review-app/src/receiptFacts.js";

// A well-formed response WITH real nested entries, mutated per case below. Each
// case asserts that a specific shape drift — top-level OR inside a balance
// change / Move call / object-type entry — fails closed (returns null → the page
// shows an error) instead of rendering a partial or "undefined ..." receipt.
function validReceipt(): Record<string, unknown> {
  return {
    txDigest: "DhZ8kuDhDm32iJ8Rqd5eY4EwrFn8ga9ob4nAMM7bBJLq",
    sender: "0xea016e020478a34bdb8e2a8400166e5d54a4132e747bf085c37ca71f3d46e3a0",
    effectsStatus: { success: true },
    packageCalls: [
      {
        commandIndex: 0,
        packageId: "0x0000000000000000000000000000000000000000000000000000000000000002",
        module: "coin",
        function: "zero",
        target: "0x0000000000000000000000000000000000000000000000000000000000000002::coin::zero"
      }
    ],
    balanceChanges: [
      {
        index: 0,
        address: "0xea016e020478a34bdb8e2a8400166e5d54a4132e747bf085c37ca71f3d46e3a0",
        coinType: "0x2::sui::SUI",
        amountRaw: "1193043120",
        direction: "increase"
      }
    ],
    objectTypes: {
      "0x00c958f578c4544acba1b894246855b91678dc4a25c0f67d508d8da3e51d9022":
        "0x2::coin::Coin<0x2::sui::SUI>"
    },
    chainIdentifier: "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S",
    fetchedAt: "2026-06-28T03:49:37.181Z"
  };
}

describe("parseReceipt", () => {
  it("accepts a well-formed receipt with real entries and returns the validated shape", () => {
    const parsed = parseReceipt(validReceipt());
    expect(parsed).not.toBeNull();
    // It returns the validated, typed facts the page renders.
    expect(parsed?.balanceChanges[0]).toEqual({
      index: 0,
      address: "0xea016e020478a34bdb8e2a8400166e5d54a4132e747bf085c37ca71f3d46e3a0",
      coinType: "0x2::sui::SUI",
      amountRaw: "1193043120",
      direction: "increase"
    });
    expect(parsed?.packageCalls[0]?.target).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000002::coin::zero"
    );
  });

  it("accepts a failed-effects receipt and a missing sender (both legitimate, not drift)", () => {
    expect(parseReceipt({ ...validReceipt(), effectsStatus: { success: false, errorMessage: "Move abort" } })).not.toBeNull();
    const noSender = validReceipt();
    delete noSender.sender;
    expect(parseReceipt(noSender)).not.toBeNull();
  });

  // --- top-level drift ---
  it("rejects a non-object response", () => {
    expect(parseReceipt(null)).toBeNull();
    expect(parseReceipt("a string")).toBeNull();
  });

  it("rejects a missing/non-string txDigest, chainIdentifier, or fetchedAt", () => {
    for (const field of ["txDigest", "chainIdentifier", "fetchedAt"]) {
      const dropped = validReceipt();
      delete dropped[field];
      expect(parseReceipt(dropped), `missing ${field}`).toBeNull();
      expect(parseReceipt({ ...validReceipt(), [field]: 123 }), `numeric ${field}`).toBeNull();
    }
  });

  it("rejects a non-boolean effectsStatus.success (the drift that showed success as 'failure')", () => {
    expect(parseReceipt({ ...validReceipt(), effectsStatus: { success: "true" } })).toBeNull();
    expect(parseReceipt({ ...validReceipt(), effectsStatus: {} })).toBeNull();
    // A non-string error message on a failed status is also drift.
    expect(parseReceipt({ ...validReceipt(), effectsStatus: { success: false, errorMessage: 7 } })).toBeNull();
  });

  it("rejects non-array balanceChanges / packageCalls and non-object objectTypes", () => {
    expect(parseReceipt({ ...validReceipt(), balanceChanges: { 0: "x" } })).toBeNull();
    expect(parseReceipt({ ...validReceipt(), packageCalls: "swap" })).toBeNull();
    expect(parseReceipt({ ...validReceipt(), objectTypes: "0x2::coin::Coin" })).toBeNull();
    expect(parseReceipt({ ...validReceipt(), objectTypes: [] })).toBeNull();
  });

  // --- nested entry drift (the round-3 finding: top-level arrays were fine but
  // entries were trusted and could render "undefined ...") ---
  it("rejects a balance change entry with a missing or wrong-typed field", () => {
    const missingAddress = validReceipt();
    (missingAddress.balanceChanges as Array<Record<string, unknown>>)[0] = {
      index: 0,
      coinType: "0x2::sui::SUI",
      amountRaw: "1",
      direction: "increase"
    };
    expect(parseReceipt(missingAddress)).toBeNull();

    expect(
      parseReceipt({
        ...validReceipt(),
        balanceChanges: [{ index: 0, address: "0xabc", coinType: "0x2::sui::SUI", amountRaw: 1, direction: "increase" }]
      }),
      "numeric amountRaw"
    ).toBeNull();

    expect(
      parseReceipt({
        ...validReceipt(),
        balanceChanges: [{ index: 0, address: "0xabc", coinType: "0x2::sui::SUI", amountRaw: "1", direction: "sideways" }]
      }),
      "invalid direction"
    ).toBeNull();
  });

  it("rejects a Move call entry with a missing or wrong-typed target", () => {
    expect(
      parseReceipt({
        ...validReceipt(),
        packageCalls: [{ commandIndex: 0, packageId: "0x2", module: "coin", function: "zero" }]
      }),
      "missing target"
    ).toBeNull();
    expect(
      parseReceipt({
        ...validReceipt(),
        packageCalls: [{ commandIndex: 0, packageId: "0x2", module: "coin", function: "zero", target: 5 }]
      }),
      "numeric target"
    ).toBeNull();
  });

  it("rejects an object-type entry whose value is not a string", () => {
    expect(parseReceipt({ ...validReceipt(), objectTypes: { "0xobj": 42 } })).toBeNull();
  });
});
