import { describe, expect, it } from "vitest";
import {
  executionResultSchema,
  failureReasonSchema
} from "../src/core/action/schemas.js";
import {
  SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE,
  suiChainReceiptEvidenceSchema
} from "../src/core/action/suiChainReceiptEvidence.js";

const account = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const packageId = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const objectId = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const digest = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const otherDigest = "8yFN1xzFyVHwF4aXJQzLb2Xdh4avWcXWJ4qJGnYSC8kq";

function chainReceiptFixture() {
  return {
    kind: "sui_chain_receipt_v1",
    source: {
      method: "client.core.getTransaction",
      network: "sui:mainnet",
      chainIdentifier: "mainnet-chain",
      fetchedAt: "2026-06-26T00:00:00.000Z",
      include: [...SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE]
    },
    txDigest: digest,
    sender: account,
    effectsStatus: { success: true },
    packageCalls: [
      {
        commandIndex: 0,
        packageId,
        module: "pool",
        function: "swap",
        target: `${packageId}::pool::swap`
      }
    ],
    accountBalanceChanges: [
      {
        index: 0,
        coinType: "0x2::sui::SUI",
        amountRaw: "-1000",
        direction: "decrease"
      },
      {
        index: 1,
        coinType: "0x2::sui::SUI",
        amountRaw: "0",
        direction: "zero"
      }
    ],
    objectTypes: {
      [objectId]: "0x2::coin::Coin<0x2::sui::SUI>"
    }
  };
}

describe("chain receipt schemas", () => {
  it("accepts normalized server-read Sui mainnet receipt facts", () => {
    const parsed = suiChainReceiptEvidenceSchema.parse(chainReceiptFixture());

    expect(parsed).toMatchObject({
      kind: "sui_chain_receipt_v1",
      source: {
        method: "client.core.getTransaction",
        network: "sui:mainnet",
        include: SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE
      },
      txDigest: digest,
      sender: account
    });
  });

  it("rejects BCS and signature material in receipt evidence", () => {
    expect(
      suiChainReceiptEvidenceSchema.safeParse({
        ...chainReceiptFixture(),
        bcs: "forbidden"
      }).success
    ).toBe(false);

    expect(
      suiChainReceiptEvidenceSchema.safeParse({
        ...chainReceiptFixture(),
        signatures: []
      }).success
    ).toBe(false);

    expect(
      suiChainReceiptEvidenceSchema.safeParse({
        ...chainReceiptFixture(),
        source: {
          ...chainReceiptFixture().source,
          include: [...SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE, "bcs"]
        }
      }).success
    ).toBe(false);
  });

  it("rejects balance change owner addresses and inconsistent amount direction", () => {
    const withOwner = chainReceiptFixture();
    withOwner.accountBalanceChanges[0] = {
      ...withOwner.accountBalanceChanges[0],
      owner: account
    } as unknown as (typeof withOwner.accountBalanceChanges)[number];
    expect(suiChainReceiptEvidenceSchema.safeParse(withOwner).success).toBe(false);

    const withUnscopedBalanceChanges = {
      ...chainReceiptFixture(),
      balanceChanges: chainReceiptFixture().accountBalanceChanges
    };
    expect(suiChainReceiptEvidenceSchema.safeParse(withUnscopedBalanceChanges).success).toBe(false);

    const wrongDirection: unknown = {
      ...chainReceiptFixture(),
      accountBalanceChanges: [
        {
          index: 0,
          coinType: "0x2::sui::SUI",
          amountRaw: "-1000",
          direction: "increase"
        }
      ]
    };
    expect(suiChainReceiptEvidenceSchema.safeParse(wrongDirection).success).toBe(false);
  });

  it("adds chain receipt failure reasons without accepting unknown reasons", () => {
    expect(failureReasonSchema.safeParse("chain_receipt_unavailable").success).toBe(true);
    expect(failureReasonSchema.safeParse("receipt_verification_failed").success).toBe(true);
    expect(failureReasonSchema.safeParse("chain_execution_failed").success).toBe(true);
    expect(failureReasonSchema.safeParse("chain_receipt_pending").success).toBe(false);
  });

  it("keeps chain receipts off pending results and binds receipts to final result digests", () => {
    expect(
      executionResultSchema.safeParse({
        reviewSessionId: "session_1",
        planId: "plan_1",
        status: "signed_pending_result",
        txDigest: digest,
        chainReceipt: chainReceiptFixture(),
        recordedAt: "2026-06-26T00:00:00.000Z"
      }).success
    ).toBe(false);

    expect(
      executionResultSchema.safeParse({
        reviewSessionId: "session_1",
        planId: "plan_1",
        status: "success",
        txDigest: digest,
        chainReceipt: chainReceiptFixture(),
        recordedAt: "2026-06-26T00:00:00.000Z"
      }).success
    ).toBe(true);

    expect(
      executionResultSchema.safeParse({
        reviewSessionId: "session_1",
        planId: "plan_1",
        status: "failure",
        txDigest: digest,
        failureReason: "chain_execution_failed",
        chainReceipt: chainReceiptFixture(),
        recordedAt: "2026-06-26T00:00:00.000Z"
      }).success
    ).toBe(true);

    expect(
      executionResultSchema.safeParse({
        reviewSessionId: "session_1",
        planId: "plan_1",
        status: "success",
        txDigest: otherDigest,
        chainReceipt: chainReceiptFixture(),
        recordedAt: "2026-06-26T00:00:00.000Z"
      }).success
    ).toBe(false);
  });

});
