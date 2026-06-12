import { describe, expect, it } from "vitest";
import { Transaction } from "@mysten/sui/transactions";
import type { ActionPlan } from "../src/core/action/types.js";
import { computeReviewStateWithPrivateArtifacts } from "../src/core/review/reviewComputation.js";
import { buildSupportedReviewAdapters } from "../src/adapters/reviewAdapters.js";
import { validateSupportedAdapterLifecycle } from "../src/adapters/adapterLifecycleValidators.js";
import { createDeepbookSwapHumanReadableReviewProducer } from "../src/adapters/deepbook/deepbookHumanReviewProducer.js";
import { createTransactionObjectOwnershipProducer } from "../src/core/action/transactionObjectOwnershipProducer.js";
import { createReviewTimeSimulationProducer } from "../src/core/action/reviewTimeSimulationEvidence.js";
import { producePtbVisualizationArtifact } from "../src/core/action/ptbVisualizationProducer.js";
import { InMemorySessionStore, SessionStoreError } from "../src/core/session/sessionStore.js";
import { InMemoryLocalTransactionMaterialStore } from "../src/core/session/transactionMaterialStore.js";
import { recordTestTransactionMaterial } from "./fixtures/transactionMaterial.js";
import { deepbookDisplayQuote } from "./fixtures/deepbookQuote.js";
import { createSuccessfulReviewTimeSimulationClient } from "./fixtures/reviewTimeSimulation.js";
import { InMemoryActivityStore } from "./fixtures/inMemoryActivityStore.js";
import type { Logger } from "../src/runtime/logger.js";

const logger: Logger = { info() {}, warn() {}, error() {} };
const walletAccount = `0x${"a".repeat(64)}`;
const computeNow = new Date("2026-05-15T00:00:29.000Z");

const plan: ActionPlan = {
  id: "plan_1",
  actionKind: "swap",
  adapterId: "deepbook-swap",
  protocol: "DeepBookV3",
  title: "Review swap",
  summary: "Review a swap",
  assetFlowPreview: {
    outgoing: [{ symbol: "SUI", amount: "1", amountKind: "display_intent" }],
    expectedIncoming: [{ symbol: "USDC", amount: "unknown", amountKind: "display_intent", approx: true }]
  },
  adapterData: {
    requestedIntent: {
      type: "swap",
      from: { symbol: "SUI", amountDisplay: "1" },
      to: { symbol: "USDC" },
      maxSlippageBps: 50
    }
  },
  createdAt: "2026-05-15T00:00:00.000Z"
};

async function readyReviewSession() {
  const materialStore = new InMemoryLocalTransactionMaterialStore();
  const activityStore = new InMemoryActivityStore();
  const store = new InMemorySessionStore({
    activityStore,
    transactionMaterialStore: materialStore,
    logger,
    validateAdapterLifecycle: validateSupportedAdapterLifecycle
  });
  const { session } = await store.createReviewSession([plan], computeNow);
  const { session: walletSession } = await store.createWalletIdentitySession(computeNow);
  await store.recordWalletIdentityOpened(walletSession.id, computeNow);
  await store.recordWalletIdentityConnecting(walletSession.id, computeNow);
  await store.recordWalletIdentityResult(
    walletSession.id,
    { status: "connected", account: walletAccount, chain: "sui:mainnet", walletName: "Test Wallet" },
    computeNow
  );
  await store.recordReviewPageOpened(session.id, computeNow);
  await store.recordWalletConnected(session.id, walletAccount, computeNow);

  let materialDigest: Awaited<ReturnType<typeof recordTestTransactionMaterial>>["digest"] | undefined;
  const computed = await computeReviewStateWithPrivateArtifacts(
    {
      reviewSessionId: session.id,
      plan,
      account: walletAccount,
      now: computeNow
    },
    {
      validateAdapterLifecycle: validateSupportedAdapterLifecycle,
      adapters: buildSupportedReviewAdapters({ deepbook: {
        deepbookQuoteSource: {
          quoteDeepbookDisplayAmount: async () => deepbookDisplayQuote()
        },
        deepbookTransactionMaterialProducer: async (input) => {
          const material = await recordTestTransactionMaterial({
            materialStore,
            reviewSessionId: session.id,
            planId: input.plan.id,
            account: input.account,
            now: input.now,
            expiresAt: new Date("2026-05-15T00:00:30.000Z"),
            includeSharedObject: true
          });
          materialDigest = material.digest;
          return {
            status: "completed",
            evidence: material.handle,
            checks: [
              {
                id: "deepbook_transaction_material_build_or_verify",
                label: "Transaction material build or verify",
                status: "pass",
                message: "Local-only transaction material was produced for the review session.",
                source: "adapter"
              }
            ]
          };
        },
        deepbookTransactionMaterialDigestProducer: async () => {
          if (!materialDigest) {
            throw new Error("test material digest was not produced");
          }
          return {
            status: "completed",
            evidence: materialDigest,
            checks: [
              {
                id: "deepbook_transaction_material_digest_commitment",
                label: "Transaction material digest",
                status: "pass",
                message: "Digest commitment was derived from the stored material.",
                source: "adapter"
              }
            ]
          };
        },
        transactionObjectOwnershipProducer: createTransactionObjectOwnershipProducer({
          materialStore,
          objectSource: {
            async getObject(input) {
              if (input.objectId === `0x${"c".repeat(64)}`) {
                return {
                  object: {
                    objectId: input.objectId,
                    owner: { $kind: "Shared", Shared: { initialSharedVersion: "1" } },
                    type: "0x2::clock::Clock"
                  }
                };
              }
              return {
                object: {
                  objectId: input.objectId,
                  owner: { $kind: "AddressOwner", AddressOwner: walletAccount },
                  type: "0x2::coin::Coin<0x2::sui::SUI>"
                }
              };
            }
          },
          network: "mainnet",
          chainIdentifier: "mainnet-chain",
          expectedChainIdentifier: "mainnet-chain"
        }),
        deepbookHumanReadableReviewProducer: createDeepbookSwapHumanReadableReviewProducer(),
        reviewTimeSimulationProducer: createReviewTimeSimulationProducer({
          client: createSuccessfulReviewTimeSimulationClient(walletAccount),
          materialStore,
          network: "mainnet",
          chainIdentifier: "mainnet-chain",
          expectedChainIdentifier: "mainnet-chain"
        }),
        ptbVisualizationProducer: (vizInput) =>
          producePtbVisualizationArtifact({ materialStore, ...vizInput })
      } })
    }
  );
  if (!computed.privateArtifacts) {
    throw new Error("expected private artifacts for the handoff fixture");
  }
  await store.recordReviewStateWithArtifacts(session.id, computed.state, computed.privateArtifacts, computeNow);
  return { store, materialStore, session, computed };
}

describe("prepareWalletHandoff", () => {
  it("hands over bytes whose recomputed digest equals the reviewed contract commitment", async () => {
    const { store, session, computed } = await readyReviewSession();
    expect(computed.state.status).toBe("ready_for_wallet_review");

    const handoff = await store.prepareWalletHandoff(session.id, plan.id, walletAccount, computeNow);

    const contract = computed.state.walletReviewAdapterContract;
    expect(contract).toBeDefined();
    expect(handoff.transactionMaterialCommitment).toBe(contract?.transactionMaterialCommitment);
    const bytes = Uint8Array.from(Buffer.from(handoff.transactionBytesBase64, "base64"));
    const recomputed = await Transaction.from(bytes).getDigest();
    expect(recomputed).toBe(handoff.transactionMaterialCommitment);
    expect(handoff.account).toBe(walletAccount);
    expect(handoff.planId).toBe(plan.id);
  });

  it("refuses handoff when the session has no ready_for_wallet_review state", async () => {
    const activityStore = new InMemoryActivityStore();
    const store = new InMemorySessionStore({
      activityStore,
      logger,
      validateAdapterLifecycle: validateSupportedAdapterLifecycle
    });
    const { session } = await store.createReviewSession([plan], computeNow);

    await expect(store.prepareWalletHandoff(session.id, plan.id, walletAccount, computeNow)).rejects.toMatchObject({
      code: "invalid_session_transition"
    });
  });

  it("locks the session against recomputes while a handoff is outstanding and releases on result", async () => {
    const { store, session, computed } = await readyReviewSession();
    await store.prepareWalletHandoff(session.id, plan.id, walletAccount, computeNow);

    await expect(
      store.recordReviewStateWithArtifacts(session.id, computed.state, computed.privateArtifacts, computeNow)
    ).rejects.toMatchObject({ code: "invalid_session_transition" });

    await store.recordExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: computed.state.walletReviewAdapterContract!.transactionMaterialCommitment,
        recordedAt: computeNow.toISOString()
      },
      computeNow
    );
    const after = await store.getReviewSession(session.id);
    expect(after?.pendingHandoffDigest).toBeUndefined();
  });

  it("releases the handoff lock on explicit cancel", async () => {
    const { store, session, computed } = await readyReviewSession();
    await store.prepareWalletHandoff(session.id, plan.id, walletAccount, computeNow);
    await store.cancelWalletHandoff(session.id, computeNow);
    await expect(
      store.recordReviewStateWithArtifacts(session.id, computed.state, computed.privateArtifacts, computeNow)
    ).resolves.toMatchObject({ id: session.id });
  });

  it("self-heals the handoff lock when the handed-off material expired", async () => {
    const { store, session } = await readyReviewSession();
    await store.prepareWalletHandoff(session.id, plan.id, walletAccount, computeNow);
    const afterExpiry = new Date("2026-05-15T00:00:31.000Z");
    // After expiry the lock must release; recording a fresh non-derived
    // refresh state (the real recompute outcome) must succeed.
    const refreshState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      checks: [
        {
          id: "deepbook_quote_policy_refresh_required",
          label: "Quote policy",
          status: "fail" as const,
          message: "Quote policy requires refresh: quote_stale.",
          source: "quote" as const
        }
      ],
      status: "refresh_required" as const,
      refreshReason: "quote_stale" as const,
      updatedAt: afterExpiry.toISOString()
    };
    await expect(
      store.recordReviewStateWithArtifacts(session.id, refreshState, undefined, afterExpiry)
    ).resolves.toMatchObject({ id: session.id });
  });

  it("keeps the session signable when material expires during an outstanding handoff", async () => {
    const { store, session, computed } = await readyReviewSession();
    await store.prepareWalletHandoff(session.id, plan.id, walletAccount, computeNow);
    const afterExpiry = new Date("2026-05-15T00:00:31.000Z");
    // Reading the session after material expiry must not demote it while the
    // handoff is outstanding (a slow hardware wallet is still signing).
    const read = await store.getReviewSession(session.id, afterExpiry);
    expect(read?.reviewState?.status).toBe("ready_for_wallet_review");
    // A late wallet failure must still be recordable.
    await expect(
      store.recordExecutionResult(
        session.id,
        {
          reviewSessionId: session.id,
          planId: plan.id,
          status: "failure",
          failureReason: "wallet_provider_error",
          recordedAt: afterExpiry.toISOString()
        },
        afterExpiry
      )
    ).resolves.toMatchObject({ status: "failure" });
    expect(computed.state.status).toBe("ready_for_wallet_review");
  });

  it("refuses handoff when the stored digest does not match the reviewed contract commitment", async () => {
    const { store, materialStore, session, computed } = await readyReviewSession();
    const other = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: computeNow,
      expiresAt: new Date("2026-05-15T00:00:30.000Z"),
      includeSharedObject: false
    });
    const skewed = JSON.parse(JSON.stringify(computed.state)) as typeof computed.state;
    const contract = skewed.walletReviewAdapterContract;
    if (!contract) {
      throw new Error("expected contract on the ready state");
    }
    contract.transactionMaterialCommitment = other.digest.transactionDigest;
    contract.humanReadableReview.boundToCommitment = other.digest.transactionDigest;
    contract.simulation.boundToCommitment = other.digest.transactionDigest;
    if (!computed.privateArtifacts) {
      throw new Error("expected private artifacts");
    }
    await store.recordReviewStateWithArtifacts(session.id, skewed, computed.privateArtifacts, computeNow);

    await expect(
      store.prepareWalletHandoff(session.id, plan.id, walletAccount, computeNow)
    ).rejects.toMatchObject({ code: "handoff_commitment_mismatch" });

    try {
      await store.prepareWalletHandoff(session.id, plan.id, walletAccount, computeNow);
    } catch (error) {
      expect(error).toBeInstanceOf(SessionStoreError);
      expect(JSON.stringify(error)).not.toContain("transactionBytesBase64");
    }
  });
});
