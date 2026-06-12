import { describe, expect, it } from "vitest";
import { Transaction } from "@mysten/sui/transactions";
import { deriveFlowxSwapQuotePolicy, type FlowxSwapQuotePolicyOk } from "../src/adapters/flowx/flowxSwapQuotePolicy.js";
import { verifyFlowxSwapMaterialBytes } from "../src/adapters/flowx/flowxSwapTransactionMaterialProducer.js";
import { createFlowxSwapActionPlan, isFlowxSwapActionPlanIdentity } from "../src/adapters/flowx/flowxSwapIntent.js";
import { newFlowxSwapReviewLifecycle } from "../src/adapters/flowx/flowxSwapReviewLifecycle.js";
import { FLOWX_CLMM_MAINNET } from "../src/core/read/flowxRegistry.js";

const NOW = new Date("2026-06-12T12:00:00.500Z");
const FETCHED_AT = "2026-06-12T12:00:00.000Z";

function okPolicy(overrides: Partial<Parameters<typeof deriveFlowxSwapQuotePolicy>[0]> = {}): FlowxSwapQuotePolicyOk {
  const policy = deriveFlowxSwapQuotePolicy({
    amountInRaw: "1000000000",
    amountOutRaw: "753052",
    swapXToY: true,
    fetchedAt: FETCHED_AT,
    maxSlippageBps: 50,
    now: NOW,
    ...overrides
  });
  if (policy.status !== "ok") {
    throw new Error(`expected ok policy, got ${policy.status}`);
  }
  return policy;
}

describe("flowx swap quote policy", () => {
  it("derives min-out, router slippage units, and the build deadline", () => {
    const policy = okPolicy();
    // 753052 * (10000 - 50) / 10000 = 749286 (floor)
    expect(policy.minOutRaw).toBe("749286");
    expect(policy.routerSlippageUnits).toBe(5_000);
    expect(policy.deadlineMsEpoch).toBe(Date.parse(FETCHED_AT) + policy.staleAfterMs);
    expect(policy.expectedOutRaw).toBe("753052");
  });

  it("requires refresh for stale quotes and zero outputs", () => {
    const stale = deriveFlowxSwapQuotePolicy({
      amountInRaw: "1",
      amountOutRaw: "2",
      swapXToY: true,
      fetchedAt: FETCHED_AT,
      maxSlippageBps: 50,
      now: new Date(Date.parse(FETCHED_AT) + 31_000)
    });
    expect(stale).toMatchObject({ status: "refresh_required", reason: "quote_stale" });

    const zero = deriveFlowxSwapQuotePolicy({
      amountInRaw: "1",
      amountOutRaw: "0",
      swapXToY: true,
      fetchedAt: FETCHED_AT,
      maxSlippageBps: 50,
      now: NOW
    });
    expect(zero).toMatchObject({ status: "refresh_required", reason: "zero_expected_output" });
  });

  it("rejects out-of-range slippage", () => {
    expect(() => okPolicy({ maxSlippageBps: 0 })).toThrow(/maxSlippageBps/);
    expect(() => okPolicy({ maxSlippageBps: 1001 })).toThrow(/maxSlippageBps/);
  });
});

const ROUTER = FLOWX_CLMM_MAINNET.universalRouter;

async function buildRouterBytes(input: {
  policy: FlowxSwapQuotePolicyOk;
  amountOutOverride?: bigint;
  foreignPackageCall?: boolean;
  foreignSharedObject?: boolean;
}): Promise<Uint8Array> {
  const tx = new Transaction();
  tx.setSender("0x000000000000000000000000000000000000000000000000000000000000a11c");
  tx.setGasPrice(1000n);
  tx.setGasBudget(50_000_000n);
  tx.setGasPayment([
    {
      objectId: "0x00000000000000000000000000000000000000000000000000000000000009a5",
      version: "1",
      digest: "11111111111111111111111111111112"
    }
  ]);
  const shared = (objectId: string) =>
    tx.sharedObjectRef({ objectId, initialSharedVersion: "1", mutable: true });
  tx.moveCall({
    target: `${ROUTER.packageId}::universal_router::build`,
    typeArguments: ["0x2::sui::SUI", "0x2::sui::SUI"],
    arguments: [
      shared(ROUTER.treasuryObjectId),
      shared(ROUTER.tradeIdTrackerObjectId),
      shared(ROUTER.partnerRegistryObjectId),
      tx.pure.u64(1n),
      tx.pure.u64(input.amountOutOverride ?? BigInt(input.policy.expectedOutRaw)),
      tx.pure.u64(BigInt(input.policy.routerSlippageUnits)),
      tx.pure.u64(BigInt(input.policy.deadlineMsEpoch)),
      tx.pure.u64(0n),
      shared(
        input.foreignSharedObject
          ? "0x00000000000000000000000000000000000000000000000000000000000fade5"
          : ROUTER.versionedObjectId
      )
    ]
  });
  if (input.foreignPackageCall) {
    tx.moveCall({
      target: "0x00000000000000000000000000000000000000000000000000000000000fade5::evil::drain",
      arguments: []
    });
  }
  return tx.build();
}

describe("flowx swap material byte verification", () => {
  it("accepts bytes whose router arguments match the derived policy", async () => {
    const policy = okPolicy();
    const bytes = await buildRouterBytes({ policy });
    expect(await verifyFlowxSwapMaterialBytes({ transactionBytes: bytes, quotePolicy: policy })).toEqual({
      status: "ok"
    });
  });

  it("blocks bytes whose expected output disagrees with the policy", async () => {
    const policy = okPolicy();
    const bytes = await buildRouterBytes({ policy, amountOutOverride: 1n });
    expect(await verifyFlowxSwapMaterialBytes({ transactionBytes: bytes, quotePolicy: policy })).toMatchObject({
      status: "failed",
      blockedReason: "amount_mismatch"
    });
  });

  it("blocks bytes that call a package outside the pinned FlowX set", async () => {
    const policy = okPolicy();
    const bytes = await buildRouterBytes({ policy, foreignPackageCall: true });
    expect(await verifyFlowxSwapMaterialBytes({ transactionBytes: bytes, quotePolicy: policy })).toMatchObject({
      status: "failed",
      blockedReason: "object_resolution_failed"
    });
  });

  it("blocks bytes that reference a shared object outside the pinned set", async () => {
    const policy = okPolicy();
    const bytes = await buildRouterBytes({ policy, foreignSharedObject: true });
    expect(await verifyFlowxSwapMaterialBytes({ transactionBytes: bytes, quotePolicy: policy })).toMatchObject({
      status: "failed",
      blockedReason: "object_resolution_failed"
    });
  });

  it("blocks bytes without the universal_router::build call", async () => {
    const policy = okPolicy();
    const tx = new Transaction();
    tx.setSender("0x000000000000000000000000000000000000000000000000000000000000a11c");
    tx.setGasPrice(1000n);
    tx.setGasBudget(50_000_000n);
    tx.setGasPayment([
      {
        objectId: "0x00000000000000000000000000000000000000000000000000000000000009a5",
        version: "1",
        digest: "11111111111111111111111111111112"
      }
    ]);
    tx.moveCall({ target: "0x2::coin::zero", typeArguments: ["0x2::sui::SUI"], arguments: [] });
    const bytes = await tx.build();
    expect(await verifyFlowxSwapMaterialBytes({ transactionBytes: bytes, quotePolicy: policy })).toMatchObject({
      status: "failed",
      blockedReason: "object_resolution_failed"
    });
  });
});

describe("flowx swap plan identity and lifecycle", () => {
  it("creates plans carrying the FlowX identity and display intent", () => {
    const plan = createFlowxSwapActionPlan(
      { type: "swap", from: { symbol: "sui", amount: "1" }, to: { symbol: "usdc" }, maxSlippageBps: 50 },
      NOW
    );
    expect(isFlowxSwapActionPlanIdentity(plan)).toBe(true);
    expect(plan.adapterId).toBe("flowx-swap");
    expect(plan.protocol).toBe("FlowXCLMM");
    expect(plan.adapterData).toMatchObject({
      requestedIntent: { from: { symbol: "SUI", amountDisplay: "1" }, to: { symbol: "USDC" } }
    });
  });

  it("enforces canonical stage order", () => {
    const plan = createFlowxSwapActionPlan(
      { type: "swap", from: { symbol: "SUI", amount: "1" }, to: { symbol: "USDC" }, maxSlippageBps: 50 },
      NOW
    );
    if (!isFlowxSwapActionPlanIdentity(plan)) {
      throw new Error("plan identity expected");
    }
    const lifecycle = newFlowxSwapReviewLifecycle(plan);
    expect(() => lifecycle.complete("pair_resolved")).toThrow(/cannot complete/);
    lifecycle.complete("intent_normalized");
    lifecycle.complete("pair_resolved");
    const snapshot = lifecycle.snapshot();
    expect(snapshot.completedStages).toEqual(["intent_normalized", "pair_resolved"]);
    expect(snapshot.missingStages[0]).toBe("quote_evidence_fetched");
  });
});
