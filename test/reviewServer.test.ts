import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionPlan } from "../src/core/action/types.js";
import { validateSupportedAdapterLifecycle } from "../src/adapters/adapterLifecycleValidators.js";
import { buildSupportedReviewAdapters } from "../src/adapters/reviewAdapters.js";
import type { LocalDataEnvelope, LocalDataService } from "../src/core/activity/localDataService.js";
import { InMemorySessionStore, type InMemorySessionStoreOptions } from "../src/core/session/sessionStore.js";
import { InMemoryLocalTransactionMaterialStore } from "../src/core/session/transactionMaterialStore.js";
import { recordTestTransactionMaterial } from "./fixtures/transactionMaterial.js";
import { createReviewHttpServer } from "../src/review-server/server.js";
import {
  probeReviewServerIdentity,
  startOrDeferReviewServer
} from "../src/runtime/reviewServerAcquire.js";
import type { Logger } from "../src/runtime/logger.js";
import { deepbookDisplayQuote } from "./fixtures/deepbookQuote.js";
import { InMemoryActivityStore } from "./fixtures/inMemoryActivityStore.js";
import { InMemoryLocalSettingsService, InMemoryPreferencesRepository } from "./fixtures/inMemoryLocalSettings.js";
import { DEFAULT_SUI_GRAPHQL_URL, DEFAULT_SUI_GRPC_URL } from "../src/runtime/config.js";
import {
  chainReceiptDigest,
  chainReceiptFixture,
  otherChainReceiptDigest
} from "./fixtures/chainReceipt.js";

const logger: Logger = {
  info() {},
  warn() {},
  error() {}
};

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
  adapterData: {},
  createdAt: new Date(0).toISOString()
};

const walletAccount = `0x${"a".repeat(64)}`;

function createSessionStore(options: Partial<InMemorySessionStoreOptions> = {}): InMemorySessionStore {
  return new InMemorySessionStore({
    ...options,
    activityStore: options.activityStore ?? new InMemoryActivityStore(),
    logger: options.logger ?? logger,
    validateAdapterLifecycle: options.validateAdapterLifecycle ?? validateSupportedAdapterLifecycle
  });
}

async function openReview(store: InMemorySessionStore, sessionId: string, now = new Date()) {
  return store.recordReviewPageOpened(sessionId, now);
}

async function connectWalletIdentity(
  store: InMemorySessionStore,
  account = walletAccount,
  now = new Date()
) {
  const { session } = await store.createWalletIdentitySession(now);
  await store.recordWalletIdentityOpened(session.id, now);
  await store.recordWalletIdentityConnecting(session.id, now);
  return store.recordWalletIdentityResult(
    session.id,
    { status: "connected", account, chain: "sui:mainnet", walletName: "Test Wallet" },
    now
  );
}

async function openAndConnectReview(
  store: InMemorySessionStore,
  sessionId: string,
  account = walletAccount,
  now = new Date()
) {
  await connectWalletIdentity(store, account, now);
  await openReview(store, sessionId, now);
  return store.recordWalletConnected(sessionId, account, now);
}

function attachReviewedCommitment(
  store: InMemorySessionStore,
  sessionId: string,
  transactionMaterialCommitment = chainReceiptDigest
) {
  const recordStore = (store as unknown as {
    sessions: {
      get(id: string): unknown;
      commitReviewSessionTransition(id: string, expected: unknown, next: unknown): boolean;
    };
  }).sessions;
  const session = recordStore.get(sessionId) as {
    reviewState?: Record<string, unknown>;
  } | undefined;
  if (!session?.reviewState) {
    throw new Error("test setup requires review state");
  }
  const committed = recordStore.commitReviewSessionTransition(sessionId, session, {
    ...session,
    reviewState: {
      ...session.reviewState,
      walletReviewAdapterContract: { transactionMaterialCommitment }
    }
  });
  if (!committed) {
    throw new Error("test setup could not attach reviewed commitment");
  }
}

async function createDefaultLocalSettings(): Promise<InMemoryLocalSettingsService> {
  const repository = new InMemoryPreferencesRepository();
  await repository.ensureDefaultLocalSettings({
    suiGrpcUrl: DEFAULT_SUI_GRPC_URL,
    suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL
  });
  return new InMemoryLocalSettingsService(repository);
}

function createLocalDataFixture(): LocalDataService {
  const counts = {
    accounts: 0,
    reviewSessions: 0,
    reviewStateSnapshots: 0,
    reviewStatusTransitions: 0,
    reviewExecutions: 0,
    externalActivityScans: 0,
    externalActivityTransactions: 0,
    localSettings: 2
  };
  const envelope: LocalDataEnvelope = {
    format: "say-ur-intent.local-data",
    network: "mainnet",
    exportedAt: "2026-05-11T00:00:00.000Z",
    data: {
      accounts: [],
      activeAccountContext: [],
      reviewSessions: [],
      reviewStateSnapshots: [],
      reviewStatusTransitions: [],
      reviewExecutions: [],
      externalActivityScans: [],
      externalActivityTransactions: [],
      localSettings: [
        {
          key: "suiGrpcUrl",
          value_json: JSON.stringify(DEFAULT_SUI_GRPC_URL),
          updated_at: "2026-05-11T00:00:00.000Z"
        },
        {
          key: "suiGraphqlUrl",
          value_json: JSON.stringify(DEFAULT_SUI_GRAPHQL_URL),
          updated_at: "2026-05-11T00:00:00.000Z"
        }
      ]
    }
  };
  return {
    async getDataCounts() {
      return counts;
    },
    async exportLocalData() {
      return envelope;
    },
    async previewImportLocalData() {
      return {
        status: "valid",
        format: "say-ur-intent.local-data",
        network: "mainnet",
        exportedAt: "2026-05-11T00:00:00.000Z",
        currentCounts: counts,
        incomingCounts: counts,
        willReplace: true,
        activeAccountChange: "unchanged",
        restartRequiredAfterImport: true,
        defaultsInjected: []
      };
    },
    async importLocalDataReplace() {
      return { status: "imported", dataCounts: counts, sessionsInvalidated: true };
    },
    async resetLocalData() {
      return { status: "reset", dataCounts: counts, sessionsInvalidated: true };
    }
  };
}

async function createSettingsServer(options: { localSettings?: InMemoryLocalSettingsService } = {}) {
  const activityStore = new InMemoryActivityStore();
  const store = createSessionStore({ activityStore });
  const localSettings = options.localSettings ?? await createDefaultLocalSettings();
  const localData = createLocalDataFixture();
  const created = await store.createSettingsSession();
  const server = await createReviewHttpServer({
    host: "127.0.0.1",
    store,
    logger,
    activityStore,
    localSettings,
    localData,
    serverInfo: { name: "say-ur-intent", version: "0.0.0-test", network: "mainnet" }
  }).start(0);
  return { server, store, activityStore, localSettings, created };
}

describe("review HTTP server", () => {
  it("requires review token for state-changing endpoints", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const missingToken = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ planId: plan.id, account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
      });
      expect(missingToken.status).toBe(401);
      const bodyToken = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ planId: plan.id, account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", token })
      });
      expect(bodyToken.status).toBe(401);
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);

      const withToken = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, account: walletAccount.toUpperCase() })
      });
      expect(withToken.status).toBe(200);
      const json = (await withToken.json()) as { reviewState: { account: string; status: string; blockedReason: string } };
      expect(json.reviewState.account).toBe(walletAccount);
      expect(json.reviewState.status).toBe("blocked");
      expect(json.reviewState.blockedReason).toBe("adapter_not_implemented");

      const stored = await store.getReviewSession(session.id);
      expect(stored?.reviewState?.account).toBe(walletAccount);
    } finally {
      await server.close();
    }
  });

  it("returns DeepBook account-bound adapter lifecycle stages from review state computation", async () => {
    const store = createSessionStore();
    const deepbookPlan: ActionPlan = {
      ...plan,
      adapterData: {
        requestedIntent: {
          type: "swap",
          from: { symbol: "SUI", amountDisplay: "1" },
          to: { symbol: "USDC" },
          maxSlippageBps: 50
        }
      }
    };
    const { session, token } = await store.createReviewSession([deepbookPlan]);
    let materialDigest: Awaited<ReturnType<typeof recordTestTransactionMaterial>>["digest"] | undefined;
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      reviewComputationDeps: {
        validateAdapterLifecycle: validateSupportedAdapterLifecycle,
        adapters: buildSupportedReviewAdapters({ deepbook: {
          deepbookQuoteSource: {
            quoteDeepbookDisplayAmount: async () =>
              deepbookDisplayQuote({ fetchedAt: new Date(Date.now() - 1_000).toISOString() })
          }
        } })
      }
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);

      const response = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: deepbookPlan.id, account: walletAccount })
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        reviewState: {
          status: string;
          blockedReason: string;
          adapterLifecycle?: { stageCatalogId: string; completedStages: string[]; missingStages: string[] };
        };
      };
      expect(json.reviewState.status).toBe("blocked");
      expect(json.reviewState.blockedReason).toBe("producer_stage_missing");
      expect(json.reviewState.adapterLifecycle).toMatchObject({
        stageCatalogId: "deepbook_swap_review_v1",
        completedStages: [
          "intent_normalized",
          "pool_resolved",
          "quote_evidence_fetched",
          "quote_policy_derived"
        ],
        missingStages: expect.arrayContaining(["transaction_material_build_or_verify"])
      });
    } finally {
      await server.close();
    }
  });

  it("stores private DeepBook material artifacts without returning them from review state API", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const deepbookPlan: ActionPlan = {
      ...plan,
      adapterData: {
        requestedIntent: {
          type: "swap",
          from: { symbol: "SUI", amountDisplay: "1" },
          to: { symbol: "USDC" },
          maxSlippageBps: 50
        }
      }
    };
    const { session, token } = await store.createReviewSession([deepbookPlan]);
    let materialDigest: Awaited<ReturnType<typeof recordTestTransactionMaterial>>["digest"] | undefined;
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      reviewComputationDeps: {
        validateAdapterLifecycle: validateSupportedAdapterLifecycle,
        adapters: buildSupportedReviewAdapters({ deepbook: {
        deepbookQuoteSource: {
          quoteDeepbookDisplayAmount: async () =>
            deepbookDisplayQuote({ fetchedAt: new Date(Date.now() - 1_000).toISOString() })
        },
        deepbookTransactionMaterialProducer: async (input) => {
          const expiresAt = new Date(Date.parse(input.quotePolicy.fetchedAt) + input.quotePolicy.staleAfterMs);
          const material = await recordTestTransactionMaterial({
            materialStore,
            reviewSessionId: session.id,
            planId: input.plan.id,
            account: input.account,
            now: input.now,
            expiresAt
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
        }
        } })
      }
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);

      const response = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: deepbookPlan.id, account: walletAccount })
      });

      expect(response.status).toBe(200);
      const bodyText = await response.text();
      const json = JSON.parse(bodyText) as {
        reviewState: { adapterLifecycle?: { completedStages: string[] } };
      };
      if (!materialDigest) {
        throw new Error("test material digest was not produced");
      }
      expect(json.reviewState.adapterLifecycle?.completedStages).toEqual([
        "intent_normalized",
        "pool_resolved",
        "quote_evidence_fetched",
        "quote_policy_derived",
        "transaction_material_build_or_verify",
        "digest_commitment"
      ]);
      expect(bodyText).not.toContain("transactionBytes");
      expect(bodyText).not.toContain("txmat_");
      expect(bodyText).not.toContain(materialDigest.transactionDigest);
      expect(await store.getReviewSessionPrivateArtifacts(session.id)).toMatchObject({
        transactionMaterialDigest: {
          transactionDigest: materialDigest.transactionDigest
        }
      });
    } finally {
      await server.close();
    }
  });

  it("fails closed for malformed DeepBook plan identity during review state computation", async () => {
    const store = createSessionStore();
    const malformedDeepbookPlan: ActionPlan = {
      ...plan,
      protocol: "WrongProtocol",
      adapterData: {
        requestedIntent: {
          type: "swap",
          from: { symbol: "SUI", amountDisplay: "1" },
          to: { symbol: "USDC" },
          maxSlippageBps: 50
        }
      }
    };
    const { session, token } = await store.createReviewSession([malformedDeepbookPlan]);
    let quoteCalled = false;
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      reviewComputationDeps: {
        validateAdapterLifecycle: validateSupportedAdapterLifecycle,
        adapters: buildSupportedReviewAdapters({ deepbook: {
          deepbookQuoteSource: {
            quoteDeepbookDisplayAmount: async () => {
              quoteCalled = true;
              return deepbookDisplayQuote();
            }
          }
        } })
      }
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);

      const response = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: malformedDeepbookPlan.id, account: walletAccount })
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        reviewState: {
          status: string;
          blockedReason: string;
          adapterLifecycle?: unknown;
          checks: Array<{ id: string; status: string; source: string }>;
        };
      };
      expect(json.reviewState.status).toBe("blocked");
      expect(json.reviewState.blockedReason).toBe("unsupported_action");
      expect(json.reviewState.adapterLifecycle).toBeUndefined();
      expect(json.reviewState.checks).toContainEqual(expect.objectContaining({
        id: "deepbook_swap_plan_identity_invalid",
        status: "fail",
        source: "adapter"
      }));
      expect(quoteCalled).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("validates POST tokens before parsing request bodies", async () => {
    const store = createSessionStore();
    const { session: reviewSession } = await store.createReviewSession([plan]);
    const { session: walletSession } = await store.createWalletIdentitySession();
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const cases = [
        { path: `/api/review/${reviewSession.id}/opened`, error: "invalid_review_token" },
        { path: `/api/review/${reviewSession.id}/state`, error: "invalid_review_token" },
        { path: `/api/review/${reviewSession.id}/result`, error: "invalid_review_token" },
        { path: `/api/wallet/${walletSession.id}/opened`, error: "invalid_wallet_token" },
        { path: `/api/wallet/${walletSession.id}/connecting`, error: "invalid_wallet_token" },
        { path: `/api/wallet/${walletSession.id}/result`, error: "invalid_wallet_token" }
      ];

      for (const item of cases) {
        const response = await fetch(`${base}${item.path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-say-ur-intent-token": "wrong",
            origin: base
          },
          body: "{"
        });
        expect(response.status, item.path).toBe(401);
        await expect(response.json(), item.path).resolves.toMatchObject({ error: item.error });
      }
    } finally {
      await server.close();
    }
  });

  it("serves review HTML as a bundled review app shell", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const badOrigin = await fetch(`${base}/review/${session.id}`, {
        headers: { origin: "http://evil.example" }
      });
      expect(badOrigin.status).toBe(403);

      const response = await fetch(`${base}/review/${session.id}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(response.headers.get("content-security-policy")).toContain("style-src 'self' 'unsafe-inline'");
      expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
      const html = await response.text();
      expect(html).toContain("/review-assets/review.js");
      expect(html).toContain("/review-assets/review.css");
      expect(html).toContain(`data-review-session-id="${session.id}"`);
      expect(html).not.toContain("x-say-ur-intent-token");
      expect(html).not.toContain("console.log");
    } finally {
      await server.close();
    }
  });

  it("serves review execution analysis HTML as a separate bundled app shell", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const badOrigin = await fetch(`${base}/review/${session.id}/analysis`, {
        headers: { origin: "http://evil.example" }
      });
      expect(badOrigin.status).toBe(403);

      const queryToken = await fetch(`${base}/review/${session.id}/analysis?token=secret`);
      expect(queryToken.status).toBe(400);
      expect(await queryToken.json()).toEqual({ error: "token_query_not_supported" });

      const response = await fetch(`${base}/review/${session.id}/analysis`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
      expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
      const html = await response.text();
      expect(html).toContain("/review-assets/reviewExecutionAnalysis.js");
      expect(html).toContain("/review-assets/reviewExecutionAnalysis.css");
      expect(html).toContain(`data-review-session-id="${session.id}"`);
      expect(html).not.toContain("/review-assets/analysis.js");
      expect(html).not.toContain("data-wallet-session-id");
      expect(html).not.toContain("x-say-ur-intent-token");
    } finally {
      await server.close();
    }
  });

  it("creates wallet identity sessions from token-authorized review sessions", async () => {
    const activityStore = new InMemoryActivityStore();
    const store = createSessionStore({ activityStore });
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      activityStore
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const missingToken = await fetch(`${base}/api/review/${session.id}/wallet-identity`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: "{}"
      });
      expect(missingToken.status).toBe(401);

      await fetch(`${base}/api/review/${session.id}/opened`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": token, origin: base },
        body: "{}"
      });
      const created = await fetch(`${base}/api/review/${session.id}/wallet-identity`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": token, origin: base },
        body: "{}"
      });
      expect(created.status).toBe(200);
      const walletJson = (await created.json()) as { walletSessionId: string; walletUrl: string; openTarget: string };
      expect(walletJson.openTarget).toBe("system_browser");
      expect(walletJson.walletUrl).toContain(`/analysis/${walletJson.walletSessionId}#`);

      await store.recordWalletIdentityOpened(walletJson.walletSessionId);
      await store.recordWalletIdentityConnecting(walletJson.walletSessionId);
      await store.recordWalletIdentityResult(walletJson.walletSessionId, {
        status: "connected",
        account: walletAccount,
        chain: "sui:mainnet",
        walletName: "Test Wallet"
      });

      const status = await fetch(`${base}/api/review/${session.id}`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      expect(status.status).toBe(200);
      await expect(status.json()).resolves.toMatchObject({
        activeAccount: {
          account: walletAccount,
          source: "wallet_identity"
        }
      });
    } finally {
      await server.close();
    }
  });

  it("rejects review wallet identity sessions outside mutable review states", async () => {
    const store = createSessionStore();
    const { session: proposedSession, token: proposedToken } = await store.createReviewSession([plan]);
    const { session: expiredSession, token: expiredToken } = await store.createReviewSession(
      [{ ...plan, id: "plan_expired" }],
      new Date(0)
    );
    const { session: pendingSession, token: pendingToken } = await store.createReviewSession(
      [{ ...plan, id: "plan_pending" }]
    );
    await openAndConnectReview(store, pendingSession.id);
    await store.recordReviewState(pendingSession.id, {
      planId: "plan_pending",
      reviewSessionId: pendingSession.id,
      account: walletAccount,
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    await store.recordExecutionResult(pendingSession.id, {
      reviewSessionId: pendingSession.id,
      planId: "plan_pending",
      status: "signed_pending_result",
      txDigest: "digest_pending",
      recordedAt: new Date().toISOString()
    });
    const { session: successSession, token: successToken } = await store.createReviewSession(
      [{ ...plan, id: "plan_success" }]
    );
    await openAndConnectReview(store, successSession.id);
    await store.recordReviewState(successSession.id, {
      planId: "plan_success",
      reviewSessionId: successSession.id,
      account: walletAccount,
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    await store.recordExecutionResult(successSession.id, {
      reviewSessionId: successSession.id,
      planId: "plan_success",
      status: "signed_pending_result",
      txDigest: chainReceiptDigest,
      recordedAt: new Date().toISOString()
    });
    await store.recordChainExecutionResult(successSession.id, {
      reviewSessionId: successSession.id,
      planId: "plan_success",
      status: "success",
      txDigest: chainReceiptDigest,
      chainReceipt: chainReceiptFixture(),
      recordedAt: new Date().toISOString()
    });
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const cases = [
        { sessionId: proposedSession.id, token: proposedToken, status: 409, error: "invalid_session_transition" },
        { sessionId: expiredSession.id, token: expiredToken, status: 410, error: "session_expired" },
        { sessionId: pendingSession.id, token: pendingToken, status: 409, error: "invalid_session_transition" },
        { sessionId: successSession.id, token: successToken, status: 409, error: "invalid_session_transition" }
      ];

      for (const item of cases) {
        const before = (await store.listWalletIdentitySessions()).length;
        const response = await fetch(`${base}/api/review/${item.sessionId}/wallet-identity`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-say-ur-intent-token": item.token, origin: base },
          body: "{}"
        });
        expect(response.status, item.error).toBe(item.status);
        await expect(response.json()).resolves.toMatchObject({ error: item.error });
        await expect(store.listWalletIdentitySessions()).resolves.toHaveLength(before);
      }
    } finally {
      await server.close();
    }
  });

  it("records review page opening with token and origin checks", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const missingToken = await fetch(`${base}/api/review/${session.id}/opened`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: "{}"
      });
      expect(missingToken.status).toBe(401);

      const badOrigin = await fetch(`${base}/api/review/${session.id}/opened`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: "http://evil.example"
        },
        body: "{}"
      });
      expect(badOrigin.status).toBe(403);

      const opened = await fetch(`${base}/api/review/${session.id}/opened`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: "{}"
      });
      expect(opened.status).toBe(200);
      const json = (await opened.json()) as {
        internalStatus: string;
        pollingStatus: string;
        lastActivityAt: string;
      };
      expect(json.internalStatus).toBe("awaiting_wallet");
      expect(json.pollingStatus).toBe("awaiting_wallet");
      expect(typeof json.lastActivityAt).toBe("string");
    } finally {
      await server.close();
    }
  });

  it("serves wallet identity shell and records wallet identity lifecycle", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createWalletIdentitySession();
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const shell = await fetch(`${base}/analysis/${session.id}`);
      expect(shell.status).toBe(200);
      expect(shell.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(shell.headers.get("content-security-policy")).toContain("style-src 'self' 'unsafe-inline'");
      expect(shell.headers.get("content-security-policy")).toContain("img-src 'self' data:");
      expect(shell.headers.get("content-security-policy")).not.toContain("script-src 'self' 'unsafe-inline'");
      const html = await shell.text();
      expect(html).toContain("/review-assets/analysis.js");
      expect(html).toContain("/review-assets/analysis.css");
      expect(html).not.toMatch(/sign/i);

      const missingToken = await fetch(`${base}/api/wallet/${session.id}/opened`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: "{}"
      });
      expect(missingToken.status).toBe(401);
      const queryToken = await fetch(`${base}/api/wallet/${session.id}/opened?token=${token}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: "{}"
      });
      expect(queryToken.status).toBe(401);

      const opened = await fetch(`${base}/api/wallet/${session.id}/opened`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: "{}"
      });
      expect(opened.status).toBe(200);
      expect(await opened.json()).toMatchObject({ status: "opened", walletSessionId: session.id });

      const connecting = await fetch(`${base}/api/wallet/${session.id}/connecting`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: "{}"
      });
      expect(connecting.status).toBe(200);
      expect(await connecting.json()).toMatchObject({ status: "connecting" });

      const connected = await fetch(`${base}/api/wallet/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ status: "connected", account: walletAccount, chain: "sui:mainnet" })
      });
      expect(connected.status).toBe(200);
      expect(await connected.json()).toMatchObject({
        status: "connected",
        account: walletAccount,
        chain: "sui:mainnet",
        expiresAt: expect.any(String)
      });
    } finally {
      await server.close();
    }
  });

  it("serves the local settings shell with external assets and rejects query tokens", async () => {
    const { server, created } = await createSettingsServer();
    try {
      const base = `http://${server.host}:${server.port}`;
      const queryToken = await fetch(`${base}/settings/${created.session.id}?token=${created.token}`);
      expect(queryToken.status).toBe(400);
      expect(await queryToken.json()).toMatchObject({ error: "token_query_not_supported" });

      const shell = await fetch(`${base}/settings/${created.session.id}`);
      expect(shell.status).toBe(200);
      expect(shell.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(shell.headers.get("content-security-policy")).toContain("style-src 'self' 'unsafe-inline'");
      expect(shell.headers.get("content-security-policy")).not.toContain("script-src 'self' 'unsafe-inline'");
      const html = await shell.text();
      expect(html).toContain("/review-assets/settings.js");
      expect(html).toContain("/review-assets/settings.css");
      expect(html).toContain(`data-settings-session-id="${created.session.id}"`);
    } finally {
      await server.close();
    }
  });

  it("serves local settings status and creates wallet identity sessions through settings APIs", async () => {
    const { server, created } = await createSettingsServer();
    try {
      const base = `http://${server.host}:${server.port}`;
      const status = await fetch(`${base}/api/settings/${created.session.id}`, {
        headers: { "x-say-ur-intent-token": created.token, origin: base }
      });
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({
        server: { name: "say-ur-intent", network: "mainnet" },
        localSettings: {
          suiGrpcUrl: {
            storedValue: DEFAULT_SUI_GRPC_URL,
            effectiveValue: DEFAULT_SUI_GRPC_URL
          },
          suiGraphqlUrl: {
            storedValue: DEFAULT_SUI_GRAPHQL_URL,
            effectiveValue: DEFAULT_SUI_GRAPHQL_URL
          }
        },
        dataCounts: { localSettings: 2 }
      });

      const wallet = await fetch(`${base}/api/settings/${created.session.id}/wallet-identity`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: "{}"
      });
      expect(wallet.status).toBe(200);
      const walletJson = (await wallet.json()) as { walletSessionId: string; walletUrl: string; openTarget: string };
      expect(walletJson.openTarget).toBe("system_browser");
      expect(walletJson.walletUrl).toContain(`/analysis/${walletJson.walletSessionId}#`);
    } finally {
      await server.close();
    }
  });

  it("updates and restores the GraphQL endpoint through settings APIs", async () => {
    const { server, created } = await createSettingsServer();
    try {
      const base = `http://${server.host}:${server.port}`;
      const save = await fetch(`${base}/api/settings/${created.session.id}/sui-graphql-url`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: JSON.stringify({ url: "https://example.graphql.provider/graphql" })
      });
      expect(save.status).toBe(200);
      await expect(save.json()).resolves.toMatchObject({
        status: "saved",
        storedValue: "https://example.graphql.provider/graphql",
        appliesAfter: "mcp_server_restart"
      });

      const status = await fetch(`${base}/api/settings/${created.session.id}`, {
        headers: { "x-say-ur-intent-token": created.token, origin: base }
      });
      expect(status.status).toBe(200);
      await expect(status.json()).resolves.toMatchObject({
        localSettings: {
          suiGraphqlUrl: {
            storedValue: "https://example.graphql.provider/graphql",
            effectiveValue: DEFAULT_SUI_GRAPHQL_URL,
            pendingStoredValue: "https://example.graphql.provider/graphql",
            appliesAfter: "mcp_server_restart"
          }
        },
        restartRequired: true
      });

      const missingUrl = await fetch(`${base}/api/settings/${created.session.id}/sui-graphql-url`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: "{}"
      });
      expect(missingUrl.status).toBe(400);
      await expect(missingUrl.json()).resolves.toMatchObject({ error: "input_invalid" });

      const invalidUrl = await fetch(`${base}/api/settings/${created.session.id}/sui-graphql-url`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: JSON.stringify({ url: "http://example.graphql.provider/graphql" })
      });
      expect(invalidUrl.status).toBe(400);
      await expect(invalidUrl.json()).resolves.toMatchObject({ error: "input_invalid" });

      const restore = await fetch(`${base}/api/settings/${created.session.id}/sui-graphql-url/restore-default`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: "{}"
      });
      expect(restore.status).toBe(200);
      await expect(restore.json()).resolves.toMatchObject({
        status: "reset",
        storedValue: DEFAULT_SUI_GRAPHQL_URL,
        appliesAfter: "mcp_server_restart"
      });
    } finally {
      await server.close();
    }
  });

  it("maps GraphQL endpoint validation errors through settings APIs", async () => {
    const repository = new InMemoryPreferencesRepository();
    await repository.ensureDefaultLocalSettings({
      suiGrpcUrl: DEFAULT_SUI_GRPC_URL,
      suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL
    });
    const localSettings = new InMemoryLocalSettingsService(repository, {
      verifyGraphqlEndpoint: async () => {
        throw new Error("provider unavailable");
      }
    });
    const { server, created } = await createSettingsServer({ localSettings });
    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/settings/${created.session.id}/sui-graphql-url`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-say-ur-intent-token": created.token, origin: base },
        body: JSON.stringify({ url: "https://example.graphql.provider/graphql" })
      });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({ error: "internal_error" });
    } finally {
      await server.close();
    }
  });

  it("validates settings API token before parsing request bodies", async () => {
    const { server, created } = await createSettingsServer();
    try {
      const base = `http://${server.host}:${server.port}`;
      const badOrigin = await fetch(`${base}/api/settings/${created.session.id}`, {
        headers: {
          "x-say-ur-intent-token": created.token,
          origin: "http://evil.example"
        }
      });
      expect(badOrigin.status).toBe(403);

      const response = await fetch(`${base}/api/settings/${created.session.id}/local-data/import/preview`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": "wrong",
          origin: base
        },
        body: "{"
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: "invalid_settings_token" });

      const queryToken = await fetch(`${base}/api/settings/${created.session.id}/local-data/import/preview?token=${created.token}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: "{}"
      });
      expect(queryToken.status).toBe(400);
      expect(await queryToken.json()).toMatchObject({ error: "token_query_not_supported" });

      const oversizedSettingsBody = await fetch(`${base}/api/settings/${created.session.id}/clear-active-account`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": created.token,
          origin: base
        },
        body: JSON.stringify({ padding: "x".repeat(64 * 1024) })
      });
      expect(oversizedSettingsBody.status).toBe(413);
      expect(await oversizedSettingsBody.json()).toMatchObject({ error: "payload_too_large" });
    } finally {
      await server.close();
    }
  });

  it("enforces the local data import body limit", async () => {
    const { server, created } = await createSettingsServer();
    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/settings/${created.session.id}/local-data/import/preview`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": created.token,
          origin: base
        },
        body: JSON.stringify({ padding: "x".repeat(16 * 1024 * 1024) })
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: "payload_too_large" });
    } finally {
      await server.close();
    }
  });

  it("invalidates local sessions after reset through settings APIs", async () => {
    const { server, created, store } = await createSettingsServer();
    const review = await store.createReviewSession([plan]);
    const wallet = await store.createWalletIdentitySession();
    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/settings/${created.session.id}/local-data/reset`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": created.token,
          origin: base
        },
        body: "{}"
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "reset", sessionsInvalidated: true });
      await expect(store.getReviewSession(review.session.id)).resolves.toBeUndefined();
      await expect(store.getWalletIdentitySession(wallet.session.id)).resolves.toBeUndefined();
      await expect(store.getSettingsSession(created.session.id)).resolves.toBeUndefined();
      const afterReset = await store.createWalletIdentitySession();
      expect(afterReset.session.status).toBe("pending");
    } finally {
      await server.close();
    }
  });

  it("serves built review assets and rejects traversal paths", async () => {
    const assetsDir = mkdtempSync(join(tmpdir(), "say-ur-intent-assets-"));
    writeFileSync(join(assetsDir, "review.js"), "export const review = true;\n", "utf8");
    writeFileSync(join(assetsDir, "review.css"), ".review-shell { color: #15201b; }\n", "utf8");
    writeFileSync(join(assetsDir, "reviewExecutionAnalysis.js"), "export const reviewAnalysis = true;\n", "utf8");
    writeFileSync(join(assetsDir, "reviewExecutionAnalysis.css"), ".analysis-shell { color: #15201b; }\n", "utf8");
    writeFileSync(join(assetsDir, "analysis.js"), "export const wallet = true;\n", "utf8");
    writeFileSync(join(assetsDir, "analysis.css"), ".wallet-shell { color: #15201b; }\n", "utf8");
    writeFileSync(join(assetsDir, "settings.js"), "export const settings = true;\n", "utf8");
    writeFileSync(join(assetsDir, "settings.css"), ".settings-shell { color: #15201b; }\n", "utf8");
    const store = createSessionStore();
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      reviewAssetsDir: assetsDir
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const asset = await fetch(`${base}/review-assets/analysis.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(await asset.text()).toContain("wallet = true");

      const css = await fetch(`${base}/review-assets/analysis.css`);
      expect(css.status).toBe(200);
      expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
      expect(await css.text()).toContain(".wallet-shell");

      const reviewAsset = await fetch(`${base}/review-assets/review.js`);
      expect(reviewAsset.status).toBe(200);
      expect(reviewAsset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(await reviewAsset.text()).toContain("review = true");

      const reviewCss = await fetch(`${base}/review-assets/review.css`);
      expect(reviewCss.status).toBe(200);
      expect(reviewCss.headers.get("content-type")).toBe("text/css; charset=utf-8");
      expect(await reviewCss.text()).toContain(".review-shell");

      const reviewAnalysisAsset = await fetch(`${base}/review-assets/reviewExecutionAnalysis.js`);
      expect(reviewAnalysisAsset.status).toBe(200);
      expect(reviewAnalysisAsset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(await reviewAnalysisAsset.text()).toContain("reviewAnalysis = true");

      const reviewAnalysisCss = await fetch(`${base}/review-assets/reviewExecutionAnalysis.css`);
      expect(reviewAnalysisCss.status).toBe(200);
      expect(reviewAnalysisCss.headers.get("content-type")).toBe("text/css; charset=utf-8");
      expect(await reviewAnalysisCss.text()).toContain(".analysis-shell");

      const settingsAsset = await fetch(`${base}/review-assets/settings.js`);
      expect(settingsAsset.status).toBe(200);
      expect(settingsAsset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(await settingsAsset.text()).toContain("settings = true");

      const missing = await fetch(`${base}/review-assets/missing.js`);
      expect(missing.status).toBe(404);

      const traversal = await fetch(`${base}/review-assets/..%2Fwallet.js`);
      expect(traversal.status).toBe(404);
    } finally {
      await server.close();
      rmSync(assetsDir, { recursive: true, force: true });
    }
  });

  it("rejects non-mainnet wallet identity result chains", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createWalletIdentitySession();
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/wallet/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ status: "connected", account: walletAccount, chain: "sui:testnet" })
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "input_invalid" });
    } finally {
      await server.close();
    }
  });

  it("returns client errors for invalid JSON and invalid transitions", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const invalidJson = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: "{"
      });
      expect(invalidJson.status).toBe(400);

      const invalidTokenWithInvalidJson = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": "wrong",
          origin: base
        },
        body: "{"
      });
      expect(invalidTokenWithInvalidJson.status).toBe(401);

      const invalidBodyShape = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify([plan.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])
      });
      expect(invalidBodyShape.status).toBe(400);
      const invalidBodyJson = (await invalidBodyShape.json()) as { error: string };
      expect(invalidBodyJson.error).toBe("invalid_body_shape");

      const invalidTransition = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "success", txDigest: "digest" })
      });
      expect(invalidTransition.status).toBe(400);
      expect(await invalidTransition.json()).toMatchObject({ error: "input_invalid" });

      const planMismatch = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: "missing_plan", status: "signed_pending_result", txDigest: "digest" })
      });
      expect(planMismatch.status).toBe(400);
      const mismatchJson = (await planMismatch.json()) as { error: string };
      expect(mismatchJson.error).toBe("plan_not_in_session");
    } finally {
      await server.close();
    }
  });

  it("exposes expired status in result polling", async () => {
    const store = createSessionStore({ ttlMs: 1 });
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const base = `http://${server.host}:${server.port}`;
      const unauthenticated = await fetch(`${base}/api/result/${session.id}`);
      expect(unauthenticated.status).toBe(401);

      const result = await fetch(`${base}/api/result/${session.id}`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      expect(result.status).toBe(200);
      const json = (await result.json()) as { status: string };
      expect(json.status).toBe("expired");
    } finally {
      await server.close();
    }
  });

  it("serves review execution analysis payload through token-authorized lazy finalization", async () => {
    const store = createSessionStore();
    const now = new Date();
    const { session, token } = await store.createReviewSession([plan], now);
    await openAndConnectReview(store, session.id, walletAccount, now);
    await store.recordReviewState(
      session.id,
      {
        planId: plan.id,
        reviewSessionId: session.id,
        account: walletAccount,
        status: "ready_for_wallet_review",
        checks: [],
        updatedAt: now.toISOString()
      },
      now
    );
    attachReviewedCommitment(store, session.id);
    await store.recordExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: chainReceiptDigest,
        recordedAt: now.toISOString()
      },
      now
    );
    const verifierCalls: unknown[] = [];
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      chainReceiptVerifier: async (input) => {
        verifierCalls.push(input);
        return { status: "verified_success", receipt: chainReceiptFixture() };
      }
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const unauthenticated = await fetch(`${base}/api/review/${session.id}/analysis`);
      expect(unauthenticated.status).toBe(401);

      const response = await fetch(`${base}/api/review/${session.id}/analysis`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as {
        kind: string;
        reviewedRequest?: { planId: string; adapterData?: unknown };
        execution: { state: string; chainReceipt?: { sender?: string } };
        labeledSessionFacts: Array<{ id: string; value: string; source: string }>;
      };
      expect(json.kind).toBe("review_execution_analysis_v1");
      expect(json.reviewedRequest).toEqual(expect.objectContaining({ planId: plan.id }));
      expect(json.reviewedRequest).not.toHaveProperty("adapterData");
      expect(json.execution).toEqual(expect.objectContaining({
        state: "success",
        chainReceipt: expect.objectContaining({ sender: walletAccount })
      }));
      expect(json.labeledSessionFacts).toContainEqual(
        expect.objectContaining({
          id: "chain-effects-status",
          value: "success",
          source: "chain_receipt"
        })
      );
      expect(verifierCalls).toEqual([
        expect.objectContaining({
          txDigest: chainReceiptDigest,
          reviewedTransactionDigest: chainReceiptDigest,
          account: walletAccount
        })
      ]);
    } finally {
      await server.close();
    }
  });

  it("reports expired when a signed pending result outlives the session", async () => {
    const store = createSessionStore({ ttlMs: 20 });
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    await store.recordExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: "digest",
      recordedAt: new Date().toISOString()
    });
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const base = `http://${server.host}:${server.port}`;
      const result = await fetch(`${base}/api/result/${session.id}`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      expect(result.status).toBe(200);
      const json = (await result.json()) as { status: string };
      expect(json.status).toBe("expired");
    } finally {
      await server.close();
    }
  });

  it("allows review opened on final or expired sessions without mutating activity", async () => {
    const store = createSessionStore({ ttlMs: 20 });
    const { session, token } = await store.createReviewSession([plan], new Date(0));
    await openAndConnectReview(store, session.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Date(1));
    await store.recordReviewState(
      session.id,
      {
        planId: plan.id,
        reviewSessionId: session.id,
        account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "ready_for_wallet_review",
        checks: [],
        updatedAt: new Date(2).toISOString()
      },
      new Date(2)
    );
    await store.recordExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: chainReceiptDigest,
        recordedAt: new Date(3).toISOString()
      },
      new Date(3)
    );
    await store.recordChainExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "success",
        txDigest: chainReceiptDigest,
        chainReceipt: chainReceiptFixture(),
        recordedAt: new Date(4).toISOString()
      },
      new Date(4)
    );
    const { session: expiredSession, token: expiredToken } = await store.createReviewSession(
      [{ ...plan, id: "plan_2" }],
      new Date(10)
    );
    await openAndConnectReview(store, expiredSession.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Date(11));
    await store.recordReviewState(
      expiredSession.id,
      {
        planId: "plan_2",
        reviewSessionId: expiredSession.id,
        account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "ready_for_wallet_review",
        checks: [],
        updatedAt: new Date(12).toISOString()
      },
      new Date(12)
    );
    await store.recordExecutionResult(
      expiredSession.id,
      {
        reviewSessionId: expiredSession.id,
        planId: "plan_2",
        status: "signed_pending_result",
        txDigest: "digest_2",
        recordedAt: new Date(13).toISOString()
      },
      new Date(13)
    );
    await store.getReviewSession(expiredSession.id, new Date(31));
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/review/${session.id}/opened`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: "{}"
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as { internalStatus: string; lastActivityAt: string };
      expect(json.internalStatus).toBe("success");
      expect(json.lastActivityAt).toBe(new Date(4).toISOString());

      const expiredResponse = await fetch(`${base}/api/review/${expiredSession.id}/opened`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": expiredToken,
          origin: base
        },
        body: "{}"
      });
      expect(expiredResponse.status).toBe(200);
      const expiredJson = (await expiredResponse.json()) as { internalStatus: string; lastActivityAt: string };
      expect(expiredJson.internalStatus).toBe("expired");
      expect(expiredJson.lastActivityAt).toBe(new Date(13).toISOString());
    } finally {
      await server.close();
    }
  });

  it("rejects expired result POST with a lifecycle error after token validation", async () => {
    const store = createSessionStore({ ttlMs: 1 });
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "signed_pending_result", txDigest: "late" })
      });
      expect(response.status).toBe(410);
      const json = (await response.json()) as { error: string };
      expect(json.error).toBe("session_expired");
    } finally {
      await server.close();
    }
  });

  it("reports blocked status for blocked review sessions", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);
      await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
      });

      const result = await fetch(`${base}/api/result/${session.id}`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      const json = (await result.json()) as { status: string };
      expect(json.status).toBe("blocked");
    } finally {
      await server.close();
    }
  });

  it("rejects review state recomputation for a different account", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const headers = {
        "content-type": "application/json",
        "x-say-ur-intent-token": token,
        origin: base
      };
      await connectWalletIdentity(store, walletAccount);
      await openReview(store, session.id);
      const first = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: plan.id, account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
      });
      expect(first.status).toBe(200);

      const second = await fetch(`${base}/api/review/${session.id}/state`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: plan.id, account: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })
      });
      expect(second.status).toBe(409);
      const json = (await second.json()) as { error: string };
      expect(json.error).toBe("invalid_session_transition");
    } finally {
      await server.close();
    }
  });

  it("rejects page-submitted success even when the session is already finalized", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    await store.recordExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: chainReceiptDigest,
      recordedAt: new Date().toISOString()
    });
    await store.recordChainExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "success",
      txDigest: chainReceiptDigest,
      chainReceipt: chainReceiptFixture(),
      recordedAt: new Date().toISOString()
    });

    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const overwrite = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "success", txDigest: otherChainReceiptDigest })
      });
      expect(overwrite.status).toBe(400);
      const json = (await overwrite.json()) as { error: string };
      expect(json.error).toBe("input_invalid");
    } finally {
      await server.close();
    }
  });

  it("returns stored execution result for idempotent signed pending retries", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    await store.recordExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: "same",
      recordedAt: "stored-recorded-at"
    });

    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const retry = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "signed_pending_result", txDigest: "same" })
      });
      expect(retry.status).toBe(200);
      const json = (await retry.json()) as { executionResult: { recordedAt: string } };
      expect(json.executionResult.recordedAt).toBe("stored-recorded-at");
    } finally {
      await server.close();
    }
  });

  it("reports signed pending result conflicts through HTTP", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    await store.recordExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: "first",
      recordedAt: new Date().toISOString()
    });

    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const conflict = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({
          planId: plan.id,
          status: "signed_pending_result",
          txDigest: "second"
        })
      });
      expect(conflict.status).toBe(409);
      const json = (await conflict.json()) as { error: string };
      expect(json.error).toBe("signed_pending_result_conflict");

      const finalConflict = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({
          planId: plan.id,
          status: "success",
          txDigest: "second"
        })
      });
      expect(finalConflict.status).toBe(400);
      expect((await finalConflict.json()) as { error: string }).toMatchObject({
        error: "input_invalid"
      });
    } finally {
      await server.close();
    }
  });

  it("requires failureReason for failed execution result posts", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });

    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const headers = {
        "content-type": "application/json",
        "x-say-ur-intent-token": token,
        origin: base
      };
      const pending = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: plan.id, status: "signed_pending_result", txDigest: "digest" })
      });
      expect(pending.status).toBe(200);

      const missingReason = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: plan.id, status: "failure" })
      });
      expect(missingReason.status).toBe(400);
      expect((await missingReason.json()) as { error: string }).toMatchObject({ error: "input_invalid" });

      const failureAfterPending = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: plan.id, status: "failure", failureReason: "network_error" })
      });
      expect(failureAfterPending.status).toBe(409);
      expect((await failureAfterPending.json()) as { error: string }).toMatchObject({
        error: "signed_pending_result_conflict"
      });
    } finally {
      await server.close();
    }
  });

  it("records local pre-chain failures from the page before a signed digest exists", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });

    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "failure", failureReason: "wallet_rejected" })
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        executionResult: {
          status: "failure",
          failureReason: "wallet_rejected"
        }
      });
    } finally {
      await server.close();
    }
  });

  it("verifies signed pending result posts through server-owned chain receipt finalization", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date().toISOString()
    });
    attachReviewedCommitment(store, session.id);
    const chainReceiptVerifier = async () => ({
      status: "verified_success" as const,
      receipt: chainReceiptFixture()
    });
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      chainReceiptVerifier
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/review/${session.id}/result`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-say-ur-intent-token": token,
          origin: base
        },
        body: JSON.stringify({ planId: plan.id, status: "signed_pending_result", txDigest: chainReceiptDigest })
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as { executionResult: { status: string; chainReceipt?: unknown } };
      expect(json.executionResult).toMatchObject({
        status: "success",
        txDigest: chainReceiptDigest,
        chainReceipt: { kind: "sui_chain_receipt_v1" }
      });
    } finally {
      await server.close();
    }
  });

  it("lazy-verifies pending result reads and closes unavailable receipts after the lookup window", async () => {
    const store = createSessionStore({ ttlMs: 100 * 365 * 24 * 60 * 60 * 1000 });
    const { session, token } = await store.createReviewSession([plan], new Date("2026-06-25T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-25T00:00:01.000Z"));
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: "2026-06-25T00:00:02.000Z"
    }, new Date("2026-06-25T00:00:02.000Z"));
    attachReviewedCommitment(store, session.id);
    await store.recordExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: chainReceiptDigest,
      recordedAt: "2026-06-25T00:00:03.000Z"
    }, new Date("2026-06-25T00:00:03.000Z"));
    const chainReceiptVerifier = async () => ({
      status: "not_found" as const,
      failureReason: "chain_receipt_unavailable" as const,
      message: "not indexed"
    });
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      chainReceiptVerifier
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/api/result/${session.id}`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "failure",
        executionResult: {
          status: "failure",
          failureReason: "chain_receipt_unavailable",
          txDigest: chainReceiptDigest
        }
      });
    } finally {
      await server.close();
    }
  });

  it("exposes internal and polling status separately in review lookup", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan]);
    await openAndConnectReview(store, session.id);
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const missingToken = await fetch(`${base}/api/review/${session.id}`);
      expect(missingToken.status).toBe(401);

      const response = await fetch(`${base}/api/review/${session.id}`, {
        headers: { "x-say-ur-intent-token": token, origin: base }
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as { internalStatus: string; pollingStatus: string };
      expect(json.internalStatus).toBe("wallet_connected");
      expect(json.pollingStatus).toBe("awaiting_signature");
    } finally {
      await server.close();
    }
  });
});

describe("review server port takeover", () => {
  it("serves a loopback identity endpoint with no token and no session data", async () => {
    const store = createSessionStore();
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      serverInfo: { name: "say-ur-intent", version: "9.9.9-test", network: "mainnet" }
    }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/__identity`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        service: string;
        role: string;
        version: string;
        pid: number;
      };
      expect(body.service).toBe("say-ur-intent");
      expect(body.role).toBe("review-server");
      expect(body.version).toBe("9.9.9-test");
      expect(body.pid).toBe(process.pid);
    } finally {
      await server.close();
    }
  });

  it("identifies our own running server through the probe", async () => {
    const store = createSessionStore();
    const server = await createReviewHttpServer({
      host: "127.0.0.1",
      store,
      logger,
      serverInfo: { name: "say-ur-intent", version: "0.0.0-test", network: "mainnet" }
    }).start(0);

    try {
      const identity = await probeReviewServerIdentity(server.port);
      expect(identity?.service).toBe("say-ur-intent");
      expect(identity?.role).toBe("review-server");
      expect(identity?.pid).toBe(process.pid);
    } finally {
      await server.close();
    }
  });

  it("defers to a healthy peer review server already holding the fixed port", async () => {
    const store = createSessionStore();
    const serverInfo = { name: "say-ur-intent" as const, version: "0.0.0-test", network: "mainnet" as const };
    const peer = await createReviewHttpServer({ host: "127.0.0.1", store, logger, serverInfo }).start(0);
    const port = peer.port;

    const factory = createReviewHttpServer({ host: "127.0.0.1", store, logger, serverInfo });
    let releaseDelay: (() => void) | undefined;
    const lifecycle = await startOrDeferReviewServer((bindPort) => factory.start(bindPort), port, {
      probeIdentity: (probePort) => probeReviewServerIdentity(probePort),
      // Park the watch loop so it never retries during the test (no real timer leaks).
      delay: () => new Promise<void>((resolve) => {
        releaseDelay = resolve;
      }),
      // Pretend a different process so the live peer is "ours but not us".
      currentPid: process.pid + 1,
      serviceName: "say-ur-intent",
      logger
    });

    try {
      // A healthy peer owns the port, so we defer instead of taking it over.
      expect(lifecycle.deferred).toBe(true);
      // The peer is untouched and still serving the shared origin.
      const identity = await probeReviewServerIdentity(port);
      expect(identity?.service).toBe("say-ur-intent");
    } finally {
      await lifecycle.close();
      releaseDelay?.();
      await peer.close();
    }
  });

  it("errors instead of touching a port held by a non-say-ur-intent server", async () => {
    const foreign = createServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ service: "some-other-dev-server" }));
    });
    await new Promise<void>((resolve) => foreign.listen(0, "127.0.0.1", resolve));
    const port = (foreign.address() as AddressInfo).port;

    const store = createSessionStore();
    const serverInfo = { name: "say-ur-intent" as const, version: "0.0.0-test", network: "mainnet" as const };
    const factory = createReviewHttpServer({ host: "127.0.0.1", store, logger, serverInfo });

    try {
      await expect(
        startOrDeferReviewServer((bindPort) => factory.start(bindPort), port, {
          probeIdentity: (probePort) => probeReviewServerIdentity(probePort),
          delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          currentPid: process.pid + 1,
          serviceName: "say-ur-intent",
          logger
        })
      ).rejects.toThrow(/not a separate say-ur-intent review server/);
    } finally {
      await new Promise<void>((resolve, reject) =>
        foreign.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});

describe("review page content security policy", () => {
  it("allows browser-side signed-transaction submission to the Sui fullnode", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan]);
    const server = await createReviewHttpServer({ host: "127.0.0.1", store, logger }).start(0);

    try {
      const base = `http://${server.host}:${server.port}`;
      const response = await fetch(`${base}/review/${session.id}`);
      expect(response.status).toBe(200);
      const csp = response.headers.get("content-security-policy") ?? "";
      const connectSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("connect-src"));
      expect(connectSrc).toBeDefined();
      expect(connectSrc).toContain("'self'");
      // The page signs then submits to the fullnode directly; without this the
      // submission is blocked by CSP. Host must be port-less to match the
      // browser's default-port (443) request.
      expect(connectSrc).toContain("https://fullnode.mainnet.sui.io");
      expect(connectSrc).not.toContain("fullnode.mainnet.sui.io:443");
    } finally {
      await server.close();
    }
  });
});
