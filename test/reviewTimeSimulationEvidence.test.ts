import { describe, expect, it } from "vitest";
import {
  createReviewTimeSimulationProducer,
  publicTransactionSimulationSummaryFromEvidence,
  verifyReviewTimeSimulationEvidence
} from "../src/core/action/reviewTimeSimulationEvidence.js";
import { InMemoryLocalTransactionMaterialStore } from "../src/core/session/transactionMaterialStore.js";
import { recordTestTransactionMaterial } from "./fixtures/transactionMaterial.js";
import {
  createFailedReviewTimeSimulationClient,
  createSuccessfulReviewTimeSimulationClient
} from "./fixtures/reviewTimeSimulation.js";

const account = `0x${"a".repeat(64)}`;
const chainIdentifier = "mainnet-chain";

describe("review-time simulation evidence", () => {
  it("simulates stored transaction material with required fields and keeps public summary redacted", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const material = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "review_1",
      planId: "plan_1",
      account,
      now: new Date("2026-06-06T00:00:00.000Z"),
      computedAt: new Date("2026-06-06T00:00:01.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const client = createSuccessfulReviewTimeSimulationClient(account);
    const producer = createReviewTimeSimulationProducer({
      client,
      materialStore,
      network: "mainnet",
      chainIdentifier,
      expectedChainIdentifier: chainIdentifier
    });

    const outcome = await producer({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      now: new Date("2026-06-06T00:00:02.000Z")
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") {
      throw new Error("simulation producer did not complete");
    }
    expect(client.calls[0]).toMatchObject({
      include: {
        transaction: true,
        effects: true,
        balanceChanges: true,
        objectTypes: true
      },
      checksEnabled: true
    });
    expect(client.calls[0]?.include).not.toHaveProperty("bcs");
    expect(outcome.evidence).toMatchObject({
      evidenceVersion: "review-time-simulation-v1",
      materialId: material.handle.materialId,
      transactionDigest: material.digest.transactionDigest,
      provider: "client.core.simulateTransaction",
      checksEnabled: true,
      status: "success",
      requiredFields: ["effects", "balanceChanges", "objectTypes", "transaction"],
      missingFields: [],
      effects: {
        transactionDigest: material.digest.transactionDigest,
        gasCostSummary: {
          computationCostRaw: "100",
          storageCostRaw: "50",
          storageRebateRaw: "20",
          nonRefundableStorageFeeRaw: "0"
        }
      }
    });
    expect(verifyReviewTimeSimulationEvidence({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      evidence: outcome.evidence,
      now: new Date("2026-06-06T00:00:03.000Z")
    })).toEqual(outcome.evidence);
    const publicSummary = publicTransactionSimulationSummaryFromEvidence(outcome.evidence);
    expect(publicSummary).toMatchObject({
      provider: "client.core.simulateTransaction",
      checksEnabled: true,
      success: true,
      gasCostSummary: {
        computationCostRaw: "100",
        storageCostRaw: "50",
        storageRebateRaw: "20",
        nonRefundableStorageFeeRaw: "0"
      }
    });
    expect(JSON.stringify(publicSummary)).not.toContain("transactionBytes");
    expect(JSON.stringify(publicSummary)).not.toContain(material.handle.materialId);
    expect(JSON.stringify(publicSummary)).not.toContain(material.digest.transactionDigest);
  });

  it("fails closed before simulation when the mainnet identity is not verified", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const material = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "review_1",
      planId: "plan_1",
      account,
      now: new Date("2026-06-06T00:00:00.000Z"),
      computedAt: new Date("2026-06-06T00:00:01.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const client = createSuccessfulReviewTimeSimulationClient(account);
    const producer = createReviewTimeSimulationProducer({
      client,
      materialStore,
      network: "mainnet",
      chainIdentifier: "wrong-chain",
      expectedChainIdentifier: chainIdentifier
    });

    const outcome = await producer({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      now: new Date("2026-06-06T00:00:02.000Z")
    });

    expect(outcome).toMatchObject({
      status: "blocked",
      blockedReason: "network_mismatch",
      checks: [{ id: "review_time_simulation_network_mismatch", status: "fail" }]
    });
    expect(client.calls).toHaveLength(0);
  });

  it("blocks deterministic failed simulation results instead of marking them refreshable", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const material = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "review_1",
      planId: "plan_1",
      account,
      now: new Date("2026-06-06T00:00:00.000Z"),
      computedAt: new Date("2026-06-06T00:00:01.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const producer = createReviewTimeSimulationProducer({
      client: createFailedReviewTimeSimulationClient("MoveAbort stale min-out"),
      materialStore,
      network: "mainnet",
      chainIdentifier,
      expectedChainIdentifier: chainIdentifier
    });

    const outcome = await producer({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      now: new Date("2026-06-06T00:00:02.000Z")
    });

    expect(outcome).toMatchObject({
      status: "blocked",
      blockedReason: "object_resolution_failed",
      checks: [{ id: "review_time_simulation_result_failed", status: "fail" }]
    });
  });

  it("classifies failed simulation gas errors as blocked insufficient gas", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const material = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "review_1",
      planId: "plan_1",
      account,
      now: new Date("2026-06-06T00:00:00.000Z"),
      computedAt: new Date("2026-06-06T00:00:01.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const producer = createReviewTimeSimulationProducer({
      client: createFailedReviewTimeSimulationClient("Insufficient gas payment"),
      materialStore,
      network: "mainnet",
      chainIdentifier,
      expectedChainIdentifier: chainIdentifier
    });

    const outcome = await producer({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      now: new Date("2026-06-06T00:00:02.000Z")
    });

    expect(outcome).toMatchObject({
      status: "blocked",
      blockedReason: "insufficient_gas",
      checks: [{ id: "review_time_simulation_result_failed", status: "fail" }]
    });
  });

  it("marks transport-level thrown simulation calls as transient refresh-required failures", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const material = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "review_1",
      planId: "plan_1",
      account,
      now: new Date("2026-06-06T00:00:00.000Z"),
      computedAt: new Date("2026-06-06T00:00:01.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const producer = createReviewTimeSimulationProducer({
      client: {
        core: {
          async simulateTransaction() {
            throw new Error("gRPC unavailable");
          }
        }
      },
      materialStore,
      network: "mainnet",
      chainIdentifier,
      expectedChainIdentifier: chainIdentifier
    });

    const outcome = await producer({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      now: new Date("2026-06-06T00:00:02.000Z")
    });

    expect(outcome).toMatchObject({
      status: "refresh_required",
      refreshReason: "simulation_transient_failure",
      checks: [{ id: "review_time_simulation_transient_failure", status: "fail" }]
    });
  });

  it("blocks non-transient thrown simulation calls instead of marking them refreshable", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const material = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "review_1",
      planId: "plan_1",
      account,
      now: new Date("2026-06-06T00:00:00.000Z"),
      computedAt: new Date("2026-06-06T00:00:01.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const producer = createReviewTimeSimulationProducer({
      client: {
        core: {
          async simulateTransaction() {
            throw new Error("invalid simulateTransaction request shape");
          }
        }
      },
      materialStore,
      network: "mainnet",
      chainIdentifier,
      expectedChainIdentifier: chainIdentifier
    });

    const outcome = await producer({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      now: new Date("2026-06-06T00:00:02.000Z")
    });

    expect(outcome).toMatchObject({
      status: "blocked",
      blockedReason: "object_resolution_failed",
      checks: [{ id: "review_time_simulation_exception_blocked", status: "fail" }]
    });
  });

  it("rejects successful simulation responses that omit required included fields", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const material = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "review_1",
      planId: "plan_1",
      account,
      now: new Date("2026-06-06T00:00:00.000Z"),
      computedAt: new Date("2026-06-06T00:00:01.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const baseClient = createSuccessfulReviewTimeSimulationClient(account);
    const producer = createReviewTimeSimulationProducer({
      client: {
        core: {
          async simulateTransaction(options) {
            const result = await baseClient.core.simulateTransaction(options);
            if (result.$kind !== "Transaction") {
              return result;
            }
            return {
              ...result,
              Transaction: {
                ...result.Transaction,
                objectTypes: undefined as never
              }
            };
          }
        }
      },
      materialStore,
      network: "mainnet",
      chainIdentifier,
      expectedChainIdentifier: chainIdentifier
    });

    const outcome = await producer({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      now: new Date("2026-06-06T00:00:02.000Z")
    });

    expect(outcome).toMatchObject({
      status: "blocked",
      blockedReason: "object_resolution_failed",
      checks: [{ id: "review_time_simulation_result_invalid", status: "fail" }]
    });
  });

  it("rejects non-canonical signed balance delta amounts from simulation results", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const material = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "review_1",
      planId: "plan_1",
      account,
      now: new Date("2026-06-06T00:00:00.000Z"),
      computedAt: new Date("2026-06-06T00:00:01.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const baseClient = createSuccessfulReviewTimeSimulationClient(account);
    const producer = createReviewTimeSimulationProducer({
      client: {
        core: {
          async simulateTransaction(options) {
            const result = await baseClient.core.simulateTransaction(options);
            if (result.$kind !== "Transaction") {
              return result;
            }
            return {
              ...result,
              Transaction: {
                ...result.Transaction,
                balanceChanges: result.Transaction.balanceChanges.map((change) => ({
                  ...change,
                  amount: "-0"
                }))
              }
            };
          }
        }
      },
      materialStore,
      network: "mainnet",
      chainIdentifier,
      expectedChainIdentifier: chainIdentifier
    });

    const outcome = await producer({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      now: new Date("2026-06-06T00:00:02.000Z")
    });

    expect(outcome).toMatchObject({
      status: "blocked",
      blockedReason: "object_resolution_failed",
      checks: [{ id: "review_time_simulation_result_invalid", status: "fail" }]
    });
  });

  it("rejects simulation evidence whose digest does not match stored material", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const material = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "review_1",
      planId: "plan_1",
      account,
      now: new Date("2026-06-06T00:00:00.000Z"),
      computedAt: new Date("2026-06-06T00:00:01.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const client = createSuccessfulReviewTimeSimulationClient(account);
    const producer = createReviewTimeSimulationProducer({
      client,
      materialStore,
      network: "mainnet",
      chainIdentifier,
      expectedChainIdentifier: chainIdentifier
    });
    const outcome = await producer({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      now: new Date("2026-06-06T00:00:02.000Z")
    });
    if (outcome.status !== "completed") {
      throw new Error("simulation producer did not complete");
    }

    expect(() =>
      verifyReviewTimeSimulationEvidence({
        transactionMaterial: material.handle,
        transactionMaterialDigest: {
          ...material.digest,
          transactionDigest: "1".repeat(32)
        },
        evidence: outcome.evidence,
        now: new Date("2026-06-06T00:00:03.000Z")
      })
    ).toThrow("review-time simulation evidence must match material and digest identity");
  });

  it("rejects simulation evidence whose changed object count does not match object changes", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const material = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "review_1",
      planId: "plan_1",
      account,
      now: new Date("2026-06-06T00:00:00.000Z"),
      computedAt: new Date("2026-06-06T00:00:01.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const producer = createReviewTimeSimulationProducer({
      client: createSuccessfulReviewTimeSimulationClient(account),
      materialStore,
      network: "mainnet",
      chainIdentifier,
      expectedChainIdentifier: chainIdentifier
    });
    const outcome = await producer({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      now: new Date("2026-06-06T00:00:02.000Z")
    });
    if (outcome.status !== "completed") {
      throw new Error("simulation producer did not complete");
    }

    expect(() =>
      verifyReviewTimeSimulationEvidence({
        transactionMaterial: material.handle,
        transactionMaterialDigest: material.digest,
        evidence: {
          ...outcome.evidence,
          effects: {
            ...outcome.evidence.effects,
            changedObjectCount: outcome.evidence.objectChanges.length + 1
          }
        },
        now: new Date("2026-06-06T00:00:03.000Z")
      })
    ).toThrow("simulation changedObjectCount must match objectChanges length");
  });

  it("requires live stored material before simulation", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const material = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "review_1",
      planId: "plan_1",
      account,
      now: new Date("2026-06-06T00:00:00.000Z"),
      computedAt: new Date("2026-06-06T00:00:01.000Z"),
      expiresAt: new Date("2026-06-06T00:00:05.000Z")
    });
    const client = createSuccessfulReviewTimeSimulationClient(account);
    const producer = createReviewTimeSimulationProducer({
      client,
      materialStore,
      network: "mainnet",
      chainIdentifier,
      expectedChainIdentifier: chainIdentifier
    });

    const outcome = await producer({
      transactionMaterial: material.handle,
      transactionMaterialDigest: material.digest,
      now: new Date("2026-06-06T00:00:05.000Z")
    });

    expect(outcome).toMatchObject({
      status: "refresh_required",
      refreshReason: "quote_stale",
      checks: [{ id: "review_time_simulation_material_unavailable", status: "fail" }]
    });
    expect(client.calls).toHaveLength(0);
  });
});
