import { describe, expect, it, vi } from "vitest";
import {
  TRANSACTION_OBJECT_OWNERSHIP_EVIDENCE_VERSION,
  type TransactionObjectOwnershipEvidence
} from "../src/core/action/transactionObjectOwnershipEvidence.js";
import {
  createSwapQuotePolicyEvidence
} from "../src/core/action/swapQuotePolicyEvidence.js";
import {
  publicHumanReadableReviewFromEvidence
} from "../src/core/action/humanReadableReviewEvidence.js";
import {
  createReviewTimeSimulationProducer,
  publicTransactionSimulationSummaryFromEvidence
} from "../src/core/action/reviewTimeSimulationEvidence.js";
import { deriveDeepbookSwapQuotePolicy } from "../src/adapters/deepbook/deepbookQuotePolicy.js";
import {
  DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGES,
  deepbookSwapReviewLifecycleSchema
} from "../src/adapters/deepbook/deepbookReviewLifecycle.js";
import { validateSupportedAdapterLifecycle } from "../src/adapters/adapterLifecycleValidators.js";
import type { ActionPlan, ReviewState } from "../src/core/action/types.js";
import type { EventLogRecord } from "../src/core/eventlog/sink.js";
import {
  InMemorySessionStore,
  LocalSessionStore,
  SessionStoreError,
  type InMemorySessionStoreOptions
} from "../src/core/session/sessionStore.js";
import { InMemoryLocalTransactionMaterialStore } from "../src/core/session/transactionMaterialStore.js";
import Database from "better-sqlite3";
import {
  configureDatabase,
  initializeDatabase
} from "../src/core/activity/sqliteActivityStoreSchema.js";
import {
  SqlitePrivateReviewArtifactStore,
  SqliteSessionRecordStore,
  createSqliteWalletIdentityRecordStore,
  createSqliteSettingsRecordStore
} from "../src/core/session/sqliteSessionStore.js";
import type { SessionRecordStore } from "../src/core/session/sessionRecordStore.js";
import type { PrivateReviewArtifactStore } from "../src/core/session/privateReviewArtifacts.js";
import type { KeyedRecordStore } from "../src/core/session/keyedRecordStore.js";
import type { WalletIdentitySession } from "../src/core/session/walletIdentity.js";
import type { SettingsSession } from "../src/core/session/settingsSession.js";
import { InMemoryActivityStore } from "./fixtures/inMemoryActivityStore.js";
import { deepbookDisplayQuote } from "./fixtures/deepbookQuote.js";
import {
  chainReceiptDigest,
  chainReceiptFixture,
  otherChainReceiptDigest
} from "./fixtures/chainReceipt.js";
import { createTestSwapHumanReadableReviewEvidence } from "./fixtures/humanReadableReview.js";
import { recordTestTransactionMaterial } from "./fixtures/transactionMaterial.js";
import { createSuccessfulReviewTimeSimulationClient } from "./fixtures/reviewTimeSimulation.js";

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
const suiCoinObjectType = "0x2::coin::Coin<0x2::sui::SUI>";
const nonCoinObjectType = "0x2::object::UID";
const sharedObjectType = "0x2::clock::Clock";
const testLogger = { error() {} };
type SessionRecordStores = {
  sessions: SessionRecordStore;
  artifacts: PrivateReviewArtifactStore;
  walletIdentityStore: KeyedRecordStore<WalletIdentitySession>;
  settingsStore: KeyedRecordStore<SettingsSession>;
};

// Run the full session-store contract against both backends. The orchestration is
// shared (LocalSessionStore); only the record/artifact storage differs, so the SQLite
// case proves the persistence layer upholds every behaviour the in-memory case does.
const SESSION_STORE_BACKENDS: Array<[string, () => SessionRecordStores | undefined]> = [
  ["in-memory", () => undefined],
  [
    "sqlite",
    () => {
      const db = new Database(":memory:");
      configureDatabase(db);
      initializeDatabase(db);
      return {
        sessions: new SqliteSessionRecordStore(db),
        artifacts: new SqlitePrivateReviewArtifactStore(db),
        walletIdentityStore: createSqliteWalletIdentityRecordStore(db),
        settingsStore: createSqliteSettingsRecordStore(db)
      };
    }
  ]
];

function deepbookLifecycle(completedCount: number) {
  return deepbookSwapReviewLifecycleSchema.parse({
    stageCatalogId: "deepbook_swap_review_v1",
    adapterId: "deepbook-swap",
    protocol: "DeepBookV3",
    actionKind: "swap",
    completedStages: DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGES.slice(0, completedCount),
    missingStages: DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGES.slice(completedCount)
  });
}

async function openAndConnectReview(
  store: LocalSessionStore,
  sessionId: string,
  account = walletAccount,
  now = new Date()
) {
  await connectWalletIdentity(store, account, now);
  await store.recordReviewPageOpened(sessionId, now);
  return store.recordWalletConnected(sessionId, account, now);
}

async function connectWalletIdentity(
  store: LocalSessionStore,
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

async function recordReadyReviewStateWithPrivateMaterial(input: {
  store: LocalSessionStore;
  materialStore: InMemoryLocalTransactionMaterialStore;
  sessionId: string;
  account?: string | undefined;
}) {
  const account = input.account ?? walletAccount;
  const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
  const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
  const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
    materialStore: input.materialStore,
    reviewSessionId: input.sessionId,
    planId: plan.id,
    account,
    now: materialCreatedAt,
    computedAt: stateRecordedAt,
    expiresAt: new Date("2026-06-06T00:30:00.000Z")
  });
  await input.store.recordReviewStateWithArtifacts(
    input.sessionId,
    {
      planId: plan.id,
      reviewSessionId: input.sessionId,
      account,
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: stateRecordedAt.toISOString()
    },
    {
      transactionMaterial: materialHandle,
      transactionMaterialDigest: digest
    },
    stateRecordedAt
  );
  return { materialHandle, digest };
}

function testObjectOwnershipEvidence(input: {
  materialId: string;
  reviewSessionId: string;
  transactionDigest: string;
  verifiedAt: string;
  expiresAt: string;
  objectType?: string | undefined;
}): TransactionObjectOwnershipEvidence {
  return {
    evidenceVersion: TRANSACTION_OBJECT_OWNERSHIP_EVIDENCE_VERSION,
    materialId: input.materialId,
    reviewSessionId: input.reviewSessionId,
    planId: plan.id,
    account: walletAccount,
    transactionDigest: input.transactionDigest,
    objectCount: 2,
    objects: [
      {
        objectId: `0x${"b".repeat(64)}`,
        roles: ["gas_object"],
        ownership: "owned_by_account",
        ownerKind: "AddressOwner",
        ownerAccount: walletAccount,
        objectType: input.objectType ?? suiCoinObjectType,
        source: "stored_transaction_data_and_mainnet_object_read"
      },
      {
        objectId: `0x${"c".repeat(64)}`,
        roles: ["shared_object"],
        ownership: "shared_object",
        ownerKind: "Shared",
        objectType: sharedObjectType,
        source: "stored_transaction_data_and_mainnet_object_read"
      }
    ],
    verifiedAt: input.verifiedAt,
    expiresAt: input.expiresAt
  };
}

function testSwapQuotePolicyEvidence(input: {
  materialHandle: Awaited<ReturnType<typeof recordTestTransactionMaterial>>["handle"];
  fetchedAt: string;
  derivedAt: Date;
}) {
  const quote = deepbookDisplayQuote({ fetchedAt: input.fetchedAt });
  const policy = deriveDeepbookSwapQuotePolicy({
    rawQuote: quote.rawQuote,
    fetchedAt: quote.fetchedAt,
    maxSlippageBps: 50,
    now: input.derivedAt
  });
  if (policy.status !== "ok") {
    throw new Error("quote fixture unexpectedly requires refresh");
  }
  const amount = (rawAmount: typeof quote.rawQuote.inputAmount) => ({
    raw: rawAmount.raw,
    asset: {
      symbol: rawAmount.symbol,
      coinType: rawAmount.coinType,
      decimals: rawAmount.decimals,
      unitSource: rawAmount.unitSource
    }
  });
  return createSwapQuotePolicyEvidence({
    materialHandle: input.materialHandle,
    adapterId: plan.adapterId,
    protocol: plan.protocol,
    actionKind: plan.actionKind,
    quoteEvidenceId: `deepbook_raw_quote:${input.materialHandle.materialId}`,
    quoteSource: {
      provider: plan.protocol,
      poolKey: quote.pool.poolKey,
      direction: policy.direction,
      fetchedAt: policy.fetchedAt,
      sourceMoveFunction: quote.rawQuote.sourceMoveFunction
    },
    maxSlippageBps: policy.maxSlippageBps,
    staleAfterMs: policy.staleAfterMs,
    sourceAmount: amount(quote.rawQuote.inputAmount),
    expectedOutput: amount(quote.rawQuote.directionalOutput),
    minimumOutput: {
      raw: policy.minOutRaw,
      asset: amount(quote.rawQuote.directionalOutput).asset
    },
    protocolFee: amount(quote.rawQuote.deepRequired),
    derivedAt: input.derivedAt
  });
}

function testHumanReadableReviewEvidence(input: {
  materialHandle: Awaited<ReturnType<typeof recordTestTransactionMaterial>>["handle"];
  digest: Awaited<ReturnType<typeof recordTestTransactionMaterial>>["digest"];
  swapQuotePolicy: ReturnType<typeof testSwapQuotePolicyEvidence>;
  transactionObjectOwnership: TransactionObjectOwnershipEvidence;
  derivedAt: Date;
}) {
  return createTestSwapHumanReadableReviewEvidence({
    plan,
    account: walletAccount,
    materialHandle: input.materialHandle,
    digest: input.digest,
    swapQuotePolicy: input.swapQuotePolicy,
    transactionObjectOwnership: input.transactionObjectOwnership,
    derivedAt: input.derivedAt,
    displayAmount: "1"
  });
}

async function testReviewTimeSimulationEvidence(input: {
  materialStore: InMemoryLocalTransactionMaterialStore;
  materialHandle: Awaited<ReturnType<typeof recordTestTransactionMaterial>>["handle"];
  digest: Awaited<ReturnType<typeof recordTestTransactionMaterial>>["digest"];
  simulatedAt: Date;
}) {
  const producer = createReviewTimeSimulationProducer({
    client: createSuccessfulReviewTimeSimulationClient(walletAccount),
    materialStore: input.materialStore,
    network: "mainnet",
    chainIdentifier: "mainnet-chain",
    expectedChainIdentifier: "mainnet-chain"
  });
  const outcome = await producer({
    transactionMaterial: input.materialHandle,
    transactionMaterialDigest: input.digest,
    now: input.simulatedAt
  });
  if (outcome.status !== "completed") {
    throw new Error("test review-time simulation evidence was not produced");
  }
  return outcome.evidence;
}

describe.each(SESSION_STORE_BACKENDS)("LocalSessionStore (%s)", (_backendLabel, makeRecordStores) => {
  function createSessionStore(options: Partial<InMemorySessionStoreOptions> = {}): LocalSessionStore {
    const base = {
      ...options,
      activityStore: options.activityStore ?? new InMemoryActivityStore(),
      logger: options.logger ?? testLogger,
      validateAdapterLifecycle: options.validateAdapterLifecycle ?? validateSupportedAdapterLifecycle
    };
    const recordStores = makeRecordStores();
    return recordStores
      ? new LocalSessionStore({
          ...base,
          sessions: recordStores.sessions,
          artifacts: recordStores.artifacts,
          walletIdentityStore: recordStores.walletIdentityStore,
          settingsStore: recordStores.settingsStore
        })
      : new InMemorySessionStore(base);
  }

  it("creates sessions with token validation", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan], new Date(0));

    expect(session.plans).toHaveLength(1);
    expect(session.createdAt).toBe(new Date(0).toISOString());
    expect(session.lastActivityAt).toBe(new Date(0).toISOString());
    expect(await store.validateReviewToken(session.id, token, new Date(1))).toBe(true);
    expect(await store.validateReviewToken(session.id, "wrong", new Date(1))).toBe(false);
  });

  it("does not expire sessions while validating wrong tokens", async () => {
    const store = createSessionStore({ ttlMs: 1 });
    const { session } = await store.createReviewSession([plan], new Date(0));

    await expect(store.validateReviewToken(session.id, "wrong", new Date(5))).resolves.toBe(false);
    await expect(store.getReviewSession(session.id, new Date(0))).resolves.toMatchObject({
      status: "proposed"
    });

    const { session: walletSession } = await store.createWalletIdentitySession(new Date(0));
    await expect(store.validateWalletIdentityToken(walletSession.id, "wrong", new Date(5))).resolves.toBe(false);
    await expect(store.getWalletIdentitySession(walletSession.id, new Date(0))).resolves.toMatchObject({
      status: "pending"
    });
  });

  it("records review page opening before wallet connection", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));

    const opened = await store.recordReviewPageOpened(session.id, new Date(1));
    expect(opened.status).toBe("awaiting_wallet");
    expect(opened.lastActivityAt).toBe(new Date(1).toISOString());

    const reopened = await store.recordReviewPageOpened(session.id, new Date(2));
    expect(reopened.status).toBe("awaiting_wallet");
    expect(reopened.lastActivityAt).toBe(new Date(2).toISOString());

    await connectWalletIdentity(store, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Date(3));
    const connected = await store.recordWalletConnected(session.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Date(3));
    expect(connected.status).toBe("wallet_connected");
    expect(connected.lastActivityAt).toBe(new Date(3).toISOString());
  });

  it("binds the account directly from proposed when wallet identity is already persisted", async () => {
    // Persisted wallet identity lets the review page skip the wallet prompt, so
    // the session is still "proposed" (never recordReviewPageOpened) when it
    // binds the account. This must succeed instead of failing closed.
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));
    await connectWalletIdentity(store, walletAccount, new Date(1));

    const connected = await store.recordWalletConnected(session.id, walletAccount, new Date(2));
    expect(connected.status).toBe("wallet_connected");
    expect(connected.account).toBe(walletAccount);
  });

  it("requires active wallet identity before review account binding", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));
    await store.recordReviewPageOpened(session.id, new Date(1));

    await expect(
      store.recordWalletConnected(session.id, walletAccount, new Date(2))
    ).rejects.toMatchObject({ code: "active_account_not_set" } satisfies Partial<SessionStoreError>);
  });

  it("keeps review session mutable when wallet-connected activity persistence fails", async () => {
    const activityStore = new InMemoryActivityStore();
    const store = createSessionStore({ activityStore });
    const { session } = await store.createReviewSession([plan], new Date(0));
    await store.recordReviewPageOpened(session.id, new Date(1));
    await connectWalletIdentity(store, walletAccount, new Date(2));
    const recordReviewTransition = vi
      .spyOn(activityStore, "recordReviewTransition")
      .mockRejectedValueOnce(new Error("review transition store unavailable"));

    await expect(
      store.recordWalletConnected(session.id, walletAccount, new Date(3))
    ).rejects.toThrow("review transition store unavailable");
    await expect(store.getReviewSession(session.id, new Date(3))).resolves.toMatchObject({
      status: "awaiting_wallet"
    });

    await expect(
      store.recordWalletConnected(session.id, walletAccount, new Date(4))
    ).resolves.toMatchObject({
      status: "wallet_connected",
      account: walletAccount,
      lastActivityAt: new Date(4).toISOString()
    });

    recordReviewTransition.mockRestore();
  });

  it("records wallet identity lifecycle and requires terminal reasons", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createWalletIdentitySession(new Date(0));

    expect(session.status).toBe("pending");
    expect(session.lastActivityAt).toBe(new Date(0).toISOString());
    await expect(store.validateWalletIdentityToken(session.id, token, new Date(1))).resolves.toBe(true);

    const opened = await store.recordWalletIdentityOpened(session.id, new Date(2));
    expect(opened.status).toBe("opened");
    expect(opened.lastActivityAt).toBe(new Date(2).toISOString());

    const connecting = await store.recordWalletIdentityConnecting(session.id, new Date(3));
    expect(connecting.status).toBe("connecting");

    await expect(
      store.recordWalletIdentityResult(
        session.id,
        { status: "failed", failureReason: "user_rejected" } as never,
        new Date(4)
      )
    ).rejects.toMatchObject({ code: "input_invalid" } satisfies Partial<SessionStoreError>);

    const connected = await store.recordWalletIdentityResult(
      session.id,
      { status: "connected", account: walletAccount.toUpperCase(), chain: "sui:mainnet", walletName: "Test Wallet" },
      new Date(5)
    );
    expect(connected).toMatchObject({
      status: "connected",
      account: walletAccount,
      chain: "sui:mainnet",
      walletName: "Test Wallet",
      lastActivityAt: new Date(5).toISOString()
    });
    await expect(
      store.recordWalletIdentityConnecting(session.id, new Date(6))
    ).rejects.toMatchObject({ code: "invalid_session_transition" } satisfies Partial<SessionStoreError>);
  });

  it("keeps wallet identity session mutable when active account persistence fails", async () => {
    const activityStore = new InMemoryActivityStore();
    const setActiveAccount = vi
      .spyOn(activityStore, "setActiveAccount")
      .mockRejectedValueOnce(new Error("active account store unavailable"));
    const store = createSessionStore({ activityStore });
    const { session } = await store.createWalletIdentitySession(new Date(0));
    await store.recordWalletIdentityOpened(session.id, new Date(1));
    await store.recordWalletIdentityConnecting(session.id, new Date(2));

    await expect(
      store.recordWalletIdentityResult(
        session.id,
        { status: "connected", account: walletAccount, chain: "sui:mainnet" },
        new Date(3)
      )
    ).rejects.toThrow("active account store unavailable");
    await expect(store.getWalletIdentitySession(session.id, new Date(3))).resolves.toMatchObject({
      status: "connecting"
    });
    await expect(activityStore.getActiveAccount()).resolves.toBeUndefined();

    await expect(
      store.recordWalletIdentityResult(
        session.id,
        { status: "connected", account: walletAccount, chain: "sui:mainnet" },
        new Date(4)
      )
    ).resolves.toMatchObject({
      status: "connected",
      account: walletAccount,
      lastActivityAt: new Date(4).toISOString()
    });
    await expect(activityStore.getActiveAccount()).resolves.toMatchObject({
      address: walletAccount,
      setAt: new Date(4).toISOString()
    });

    setActiveAccount.mockRestore();
  });

  it("rejects wallet identity connection progress before the wallet page is opened", async () => {
    const store = createSessionStore();
    const { session } = await store.createWalletIdentitySession(new Date(0));

    await expect(
      store.recordWalletIdentityConnecting(session.id, new Date(1))
    ).rejects.toMatchObject({ code: "invalid_session_transition" } satisfies Partial<SessionStoreError>);
  });

  it("rejects malformed wallet identity account addresses", async () => {
    const store = createSessionStore();
    const { session } = await store.createWalletIdentitySession(new Date(0));
    await store.recordWalletIdentityOpened(session.id, new Date(1));
    await store.recordWalletIdentityConnecting(session.id, new Date(2));

    await expect(
      store.recordWalletIdentityResult(
        session.id,
        { status: "connected", account: "not-an-address", chain: "sui:mainnet" },
        new Date(3)
      )
    ).rejects.toMatchObject({ code: "input_invalid" } satisfies Partial<SessionStoreError>);
  });

  it("rejects malformed review wallet addresses before recording review state", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));
    await store.recordReviewPageOpened(session.id, new Date(1));

    await expect(
      store.recordWalletConnected(session.id, "not-an-address", new Date(2))
    ).rejects.toMatchObject({ code: "input_invalid" } satisfies Partial<SessionStoreError>);
  });

  it("expires non-terminal wallet identity sessions without mutating terminal sessions", async () => {
    const events: EventLogRecord[] = [];
    const store = createSessionStore({
      ttlMs: 1,
      eventLog: { append: async (record) => { events.push(record); } }
    });
    const { session } = await store.createWalletIdentitySession(new Date(0));

    const expired = await store.getWalletIdentitySession(session.id, new Date(2));
    expect(expired?.status).toBe("expired");
    expect(expired?.lastActivityAt).toBe(new Date(0).toISOString());
    expect(events.map((event) => event.type)).toContain("wallet_identity.expired");

    const finalStore = createSessionStore({ ttlMs: 1 });
    const { session: finalSession } = await finalStore.createWalletIdentitySession(new Date(0));
    await finalStore.recordWalletIdentityOpened(finalSession.id, new Date(0));
    await finalStore.recordWalletIdentityConnecting(finalSession.id, new Date(0));
    await finalStore.recordWalletIdentityResult(
      finalSession.id,
      { status: "rejected", failureReason: "user_rejected" },
      new Date(0)
    );
    const finalRead = await finalStore.getWalletIdentitySession(finalSession.id, new Date(2));
    expect(finalRead?.status).toBe("rejected");
  });

  it("lists review and wallet identity sessions through lazy expiry", async () => {
    const store = createSessionStore({ ttlMs: 1 });
    const { session: reviewSession } = await store.createReviewSession([plan], new Date(0));
    const { session: walletSession } = await store.createWalletIdentitySession(new Date(0));

    await expect(store.listReviewSessions(new Date(2))).resolves.toEqual([
      expect.objectContaining({
        id: reviewSession.id,
        status: "expired"
      })
    ]);
    await expect(store.listWalletIdentitySessions(new Date(2))).resolves.toEqual([
      expect.objectContaining({
        id: walletSession.id,
        status: "expired"
      })
    ]);

    const emptyStore = createSessionStore();
    await expect(emptyStore.listReviewSessions(new Date(0))).resolves.toEqual([]);
    await expect(emptyStore.listWalletIdentitySessions(new Date(0))).resolves.toEqual([]);
  });

  it("records wallet identity expiry before rejecting mutable wallet identity operations", async () => {
    const events: EventLogRecord[] = [];
    const store = createSessionStore({
      ttlMs: 1,
      eventLog: { append: async (record) => { events.push(record); } }
    });
    const { session } = await store.createWalletIdentitySession(new Date(0));
    await store.recordWalletIdentityOpened(session.id, new Date(0));

    await expect(
      store.recordWalletIdentityConnecting(session.id, new Date(2))
    ).rejects.toMatchObject({ code: "session_expired" } satisfies Partial<SessionStoreError>);

    const expired = await store.getWalletIdentitySession(session.id, new Date(2));
    expect(expired?.status).toBe("expired");
    expect(events.map((event) => event.type)).toContain("wallet_identity.expired");
  });

  it("keeps review opened reads non-mutating for final and expired sessions", async () => {
    const store = createSessionStore({ ttlMs: 1 });
    const { session } = await store.createReviewSession([plan], new Date(0));

    const expired = await store.recordReviewPageOpened(session.id, new Date(2));
    expect(expired.status).toBe("expired");
    expect(expired.lastActivityAt).toBe(new Date(0).toISOString());

    const finalStore = createSessionStore();
    const { session: finalSession } = await finalStore.createReviewSession([plan], new Date(0));
    await openAndConnectReview(finalStore, finalSession.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Date(1));
    await finalStore.recordReviewState(
      finalSession.id,
      {
        planId: plan.id,
        reviewSessionId: finalSession.id,
        account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "ready_for_wallet_review",
        checks: [],
        updatedAt: new Date(2).toISOString()
      },
      new Date(2)
    );
    await finalStore.recordExecutionResult(
      finalSession.id,
      {
        reviewSessionId: finalSession.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: chainReceiptDigest,
        recordedAt: new Date(3).toISOString()
      },
      new Date(3)
    );
    await finalStore.recordChainExecutionResult(
      finalSession.id,
      {
        reviewSessionId: finalSession.id,
        planId: plan.id,
        status: "success",
        txDigest: chainReceiptDigest,
        chainReceipt: chainReceiptFixture(),
        recordedAt: new Date(4).toISOString()
      },
      new Date(4)
    );

    const reopenedFinal = await finalStore.recordReviewPageOpened(finalSession.id, new Date(5));
    expect(reopenedFinal.status).toBe("success");
    expect(reopenedFinal.lastActivityAt).toBe(new Date(4).toISOString());
  });

  it("rejects unsupported multi-plan review sessions", async () => {
    const store = createSessionStore();
    await expect(
      store.createReviewSession([plan, { ...plan, id: "plan_2" }])
    ).rejects.toMatchObject({ code: "input_invalid" } satisfies Partial<SessionStoreError>);
  });

  it("enforces state transitions", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));
    await expect(
      store.recordExecutionResult(
        session.id,
        {
          reviewSessionId: session.id,
          planId: plan.id,
          status: "success",
          txDigest: chainReceiptDigest,
          chainReceipt: chainReceiptFixture(),
          recordedAt: new Date(2).toISOString()
        },
        new Date(2)
      )
    ).rejects.toMatchObject({ code: "input_invalid" } satisfies Partial<SessionStoreError>);

    await openAndConnectReview(store, session.id, walletAccount, new Date(2));
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount.toUpperCase(),
      status: "blocked",
      blockedReason: "adapter_not_implemented",
      checks: [],
      updatedAt: new Date(3).toISOString()
    };
    const updated = await store.recordReviewState(session.id, reviewState, new Date(3));
    expect(updated.status).toBe("blocked");
    expect(updated.reviewState?.account).toBe(walletAccount);
  });

  it("rejects non-canonical adapter lifecycle at the session boundary", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));

    await expect(
      store.recordReviewState(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: session.id,
          account: walletAccount,
          status: "blocked",
          blockedReason: "producer_stage_missing",
          checks: [],
          adapterLifecycle: {
            stageCatalogId: "deepbook_swap_review_v1",
            adapterId: "deepbook-swap",
            protocol: "DeepBookV3",
            actionKind: "swap",
            completedStages: ["intent_normalized", "quote_evidence_fetched"],
            missingStages: [
              "pool_resolved",
              "quote_policy_derived",
              "transaction_material_build_or_verify",
              "digest_commitment",
              "object_ownership",
              "human_readable_review",
              "review_time_simulation"
            ]
          },
          updatedAt: "2026-06-06T00:00:02.000Z"
        },
        new Date("2026-06-06T00:00:02.000Z")
      )
    ).rejects.toMatchObject({ code: "input_invalid" } satisfies Partial<SessionStoreError>);
  });

  it("stores private review artifacts separately and clears stale material on recompute", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: stateRecordedAt,
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "producer_stage_missing",
      adapterLifecycle: deepbookLifecycle(7),
      checks: [],
      updatedAt: stateRecordedAt.toISOString()
    };

    const updated = await store.recordReviewStateWithArtifacts(
      session.id,
      reviewState,
      {
        transactionMaterial: materialHandle,
        transactionMaterialDigest: digest,
        transactionObjectOwnership: testObjectOwnershipEvidence({
          materialId: materialHandle.materialId,
          reviewSessionId: session.id,
          transactionDigest: digest.transactionDigest,
          verifiedAt: stateRecordedAt.toISOString(),
          expiresAt: materialHandle.expiresAt
        })
      },
      stateRecordedAt
    );

    expect(JSON.stringify(updated)).not.toContain(materialHandle.materialId);
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toMatchObject({
      transactionMaterial: { materialId: materialHandle.materialId },
      transactionMaterialDigest: {
        materialId: materialHandle.materialId,
        transactionDigest: digest.transactionDigest
      },
      transactionObjectOwnership: {
        materialId: materialHandle.materialId,
        transactionDigest: digest.transactionDigest,
        objectCount: 2,
        objects: expect.arrayContaining([
          expect.objectContaining({
            objectId: `0x${"b".repeat(64)}`,
            roles: ["gas_object"],
            ownership: "owned_by_account"
          }),
          expect.objectContaining({
            objectId: `0x${"c".repeat(64)}`,
            roles: ["shared_object"],
            ownership: "shared_object"
          })
        ])
      }
    });
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:01:00.000Z"))).toBeDefined();

    await store.recordReviewState(session.id, reviewState, new Date("2026-06-06T00:00:05.000Z"));

    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:06.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:01:00.000Z"))).toBeUndefined();
  });

  it("stores private swap quote policy evidence outside public review state", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: stateRecordedAt,
      expiresAt: new Date("2026-06-06T00:00:30.000Z")
    });
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "producer_stage_missing",
      adapterLifecycle: deepbookLifecycle(6),
      checks: [],
      updatedAt: stateRecordedAt.toISOString()
    };

    const updated = await store.recordReviewStateWithArtifacts(
      session.id,
      reviewState,
      {
        transactionMaterial: materialHandle,
        transactionMaterialDigest: digest,
        swapQuotePolicy: testSwapQuotePolicyEvidence({
          materialHandle,
          fetchedAt: "2026-06-06T00:00:00.000Z",
          derivedAt: stateRecordedAt
        })
      },
      stateRecordedAt
    );

    expect(JSON.stringify(updated)).not.toContain(materialHandle.materialId);
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toMatchObject({
      transactionMaterial: { materialId: materialHandle.materialId },
      transactionMaterialDigest: { materialId: materialHandle.materialId },
      swapQuotePolicy: {
        materialId: materialHandle.materialId,
        quoteSource: {
          poolKey: "SUI_USDC",
          fetchedAt: "2026-06-06T00:00:00.000Z"
        },
        minimumOutput: {
          raw: "122839505"
        }
      }
    });
  });

  it("rejects private swap quote policy evidence that no longer matches the quote policy formula", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: stateRecordedAt,
      expiresAt: new Date("2026-06-06T00:00:30.000Z")
    });
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "producer_stage_missing",
      adapterLifecycle: deepbookLifecycle(6),
      checks: [],
      updatedAt: stateRecordedAt.toISOString()
    };
    const swapQuotePolicy = testSwapQuotePolicyEvidence({
      materialHandle,
      fetchedAt: "2026-06-06T00:00:00.000Z",
      derivedAt: stateRecordedAt
    });

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        reviewState,
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: digest,
          swapQuotePolicy: {
            ...swapQuotePolicy,
            minimumOutput: {
              ...swapQuotePolicy.minimumOutput,
              raw: "122839504"
            }
          }
        },
        stateRecordedAt
      )
    ).rejects.toMatchObject({ code: "session_mismatch" });
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
  });

  it("rejects private object ownership evidence that does not match stored material digest", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: stateRecordedAt,
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "producer_stage_missing",
      adapterLifecycle: deepbookLifecycle(7),
      checks: [],
      updatedAt: stateRecordedAt.toISOString()
    };

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        reviewState,
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: digest,
          transactionObjectOwnership: testObjectOwnershipEvidence({
            materialId: materialHandle.materialId,
            reviewSessionId: session.id,
            transactionDigest: "1".repeat(32),
            verifiedAt: stateRecordedAt.toISOString(),
            expiresAt: materialHandle.expiresAt
          })
        },
        stateRecordedAt
      )
    ).rejects.toMatchObject({ code: "session_mismatch" });
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:01:00.000Z"))).toBeUndefined();
  });

  it("rejects private object ownership evidence that is not contract-mappable", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: stateRecordedAt,
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "producer_stage_missing",
      adapterLifecycle: deepbookLifecycle(7),
      checks: [],
      updatedAt: stateRecordedAt.toISOString()
    };

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        reviewState,
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: digest,
          transactionObjectOwnership: testObjectOwnershipEvidence({
            materialId: materialHandle.materialId,
            reviewSessionId: session.id,
            transactionDigest: digest.transactionDigest,
            verifiedAt: stateRecordedAt.toISOString(),
            expiresAt: materialHandle.expiresAt,
            objectType: nonCoinObjectType
          })
        },
        stateRecordedAt
      )
    ).rejects.toMatchObject({ code: "session_mismatch" });
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:01:00.000Z"))).toBeUndefined();
  });

  it("stores private human-readable review evidence while public state exposes only the safe review summary", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: stateRecordedAt,
      expiresAt: new Date("2026-06-06T00:00:30.000Z")
    });
    const swapQuotePolicy = testSwapQuotePolicyEvidence({
      materialHandle,
      fetchedAt: "2026-06-06T00:00:00.000Z",
      derivedAt: stateRecordedAt
    });
    const transactionObjectOwnership = testObjectOwnershipEvidence({
      materialId: materialHandle.materialId,
      reviewSessionId: session.id,
      transactionDigest: digest.transactionDigest,
      verifiedAt: stateRecordedAt.toISOString(),
      expiresAt: materialHandle.expiresAt
    });
    const humanReadableReview = testHumanReadableReviewEvidence({
      materialHandle,
      digest,
      swapQuotePolicy,
      transactionObjectOwnership,
      derivedAt: stateRecordedAt
    });
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "producer_stage_missing",
      checks: [],
      adapterLifecycle: deepbookLifecycle(8),
      humanReadableReview: publicHumanReadableReviewFromEvidence(humanReadableReview),
      updatedAt: stateRecordedAt.toISOString()
    };

    const updated = await store.recordReviewStateWithArtifacts(
      session.id,
      reviewState,
      {
        transactionMaterial: materialHandle,
        transactionMaterialDigest: digest,
        swapQuotePolicy,
        transactionObjectOwnership,
        humanReadableReview
      },
      stateRecordedAt
    );

    expect(JSON.stringify(updated)).not.toContain(materialHandle.materialId);
    expect(JSON.stringify(updated)).not.toContain(digest.transactionDigest);
    expect(updated.reviewState?.humanReadableReview).toMatchObject({
      kind: "swap_human_readable_review",
      proposedAction: { adapterId: "deepbook-swap" },
      missingEvidence: [expect.objectContaining({ id: "review_time_simulation" })]
    });
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toMatchObject({
      humanReadableReview: {
        materialId: materialHandle.materialId,
        transactionDigest: digest.transactionDigest,
        boundToCommitment: digest.transactionDigest
      }
    });
  });

  it("stores private review-time simulation evidence while exposing only its public projection", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const humanReviewAt = new Date("2026-06-06T00:00:03.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:04.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: humanReviewAt,
      expiresAt: new Date("2026-06-06T00:00:30.000Z")
    });
    const swapQuotePolicy = testSwapQuotePolicyEvidence({
      materialHandle,
      fetchedAt: "2026-06-06T00:00:00.000Z",
      derivedAt: humanReviewAt
    });
    const transactionObjectOwnership = testObjectOwnershipEvidence({
      materialId: materialHandle.materialId,
      reviewSessionId: session.id,
      transactionDigest: digest.transactionDigest,
      verifiedAt: humanReviewAt.toISOString(),
      expiresAt: materialHandle.expiresAt
    });
    const humanReadableReview = testHumanReadableReviewEvidence({
      materialHandle,
      digest,
      swapQuotePolicy,
      transactionObjectOwnership,
      derivedAt: humanReviewAt
    });
    const reviewTimeSimulation = await testReviewTimeSimulationEvidence({
      materialStore,
      materialHandle,
      digest,
      simulatedAt: stateRecordedAt
    });
    const publicSimulation = publicTransactionSimulationSummaryFromEvidence(reviewTimeSimulation);
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "wallet_review_contract_emit_missing",
      checks: [],
      adapterLifecycle: deepbookLifecycle(9),
      humanReadableReview: publicHumanReadableReviewFromEvidence(humanReadableReview),
      simulation: publicSimulation,
      updatedAt: stateRecordedAt.toISOString()
    };

    const updated = await store.recordReviewStateWithArtifacts(
      session.id,
      reviewState,
      {
        transactionMaterial: materialHandle,
        transactionMaterialDigest: digest,
        swapQuotePolicy,
        transactionObjectOwnership,
        humanReadableReview,
        reviewTimeSimulation
      },
      stateRecordedAt
    );

    expect(updated.reviewState?.simulation).toEqual(publicSimulation);
    expect(JSON.stringify(updated)).not.toContain(materialHandle.materialId);
    expect(JSON.stringify(updated)).not.toContain(digest.transactionDigest);
    expect(JSON.stringify(updated)).not.toContain("transactionBytes");
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:05.000Z"))).toMatchObject({
      reviewTimeSimulation: {
        materialId: materialHandle.materialId,
        transactionDigest: digest.transactionDigest,
        status: "success"
      }
    });
  });

  it("rejects public review-time simulation state that is not projected from private evidence", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:04.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: new Date("2026-06-06T00:00:03.000Z"),
      expiresAt: new Date("2026-06-06T00:00:30.000Z")
    });
    const swapQuotePolicy = testSwapQuotePolicyEvidence({
      materialHandle,
      fetchedAt: "2026-06-06T00:00:00.000Z",
      derivedAt: stateRecordedAt
    });
    const transactionObjectOwnership = testObjectOwnershipEvidence({
      materialId: materialHandle.materialId,
      reviewSessionId: session.id,
      transactionDigest: digest.transactionDigest,
      verifiedAt: stateRecordedAt.toISOString(),
      expiresAt: materialHandle.expiresAt
    });
    const humanReadableReview = testHumanReadableReviewEvidence({
      materialHandle,
      digest,
      swapQuotePolicy,
      transactionObjectOwnership,
      derivedAt: stateRecordedAt
    });
    const reviewTimeSimulation = await testReviewTimeSimulationEvidence({
      materialStore,
      materialHandle,
      digest,
      simulatedAt: stateRecordedAt
    });
    const publicSimulation = publicTransactionSimulationSummaryFromEvidence(reviewTimeSimulation);
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "wallet_review_contract_emit_missing",
      checks: [],
      adapterLifecycle: deepbookLifecycle(9),
      humanReadableReview: publicHumanReadableReviewFromEvidence(humanReadableReview),
      simulation: {
        ...publicSimulation,
        gasCostSummary: {
          computationCostRaw: "1",
          storageCostRaw: "50",
          storageRebateRaw: "20",
          nonRefundableStorageFeeRaw: "0"
        }
      },
      updatedAt: stateRecordedAt.toISOString()
    };

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        reviewState,
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: digest,
          swapQuotePolicy,
          transactionObjectOwnership,
          humanReadableReview,
          reviewTimeSimulation
        },
        stateRecordedAt
      )
    ).rejects.toMatchObject({ code: "session_mismatch" });
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:05.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:00:05.000Z"))).toBeUndefined();
  });

  it("rejects unsupported private human-readable review projections at the session boundary", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: stateRecordedAt,
      expiresAt: new Date("2026-06-06T00:00:30.000Z")
    });
    const swapQuotePolicy = testSwapQuotePolicyEvidence({
      materialHandle,
      fetchedAt: "2026-06-06T00:00:00.000Z",
      derivedAt: stateRecordedAt
    });
    const transactionObjectOwnership = testObjectOwnershipEvidence({
      materialId: materialHandle.materialId,
      reviewSessionId: session.id,
      transactionDigest: digest.transactionDigest,
      verifiedAt: stateRecordedAt.toISOString(),
      expiresAt: materialHandle.expiresAt
    });
    const humanReadableReview = testHumanReadableReviewEvidence({
      materialHandle,
      digest,
      swapQuotePolicy,
      transactionObjectOwnership,
      derivedAt: stateRecordedAt
    });
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "producer_stage_missing",
      checks: [],
      adapterLifecycle: deepbookLifecycle(8),
      humanReadableReview: publicHumanReadableReviewFromEvidence(humanReadableReview),
      updatedAt: stateRecordedAt.toISOString()
    };
    const unsupportedHumanReadableReview = {
      ...humanReadableReview,
      review: {
        ...humanReadableReview.review,
        kind: "unsupported_human_readable_review"
      }
    } as unknown as typeof humanReadableReview;

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        reviewState,
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: digest,
          swapQuotePolicy,
          transactionObjectOwnership,
          humanReadableReview: unsupportedHumanReadableReview
        },
        stateRecordedAt
      )
    ).rejects.toMatchObject({ code: "session_mismatch" });
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:01:00.000Z"))).toBeUndefined();
  });

  it("marks private-derived human-readable review state refresh-required after material expiry", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
    const materialExpiresAt = new Date("2026-06-06T00:00:30.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: stateRecordedAt,
      expiresAt: materialExpiresAt
    });
    const swapQuotePolicy = testSwapQuotePolicyEvidence({
      materialHandle,
      fetchedAt: "2026-06-06T00:00:00.000Z",
      derivedAt: stateRecordedAt
    });
    const transactionObjectOwnership = testObjectOwnershipEvidence({
      materialId: materialHandle.materialId,
      reviewSessionId: session.id,
      transactionDigest: digest.transactionDigest,
      verifiedAt: stateRecordedAt.toISOString(),
      expiresAt: materialHandle.expiresAt
    });
    const humanReadableReview = testHumanReadableReviewEvidence({
      materialHandle,
      digest,
      swapQuotePolicy,
      transactionObjectOwnership,
      derivedAt: stateRecordedAt
    });
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "producer_stage_missing",
      checks: [],
      adapterLifecycle: deepbookLifecycle(8),
      humanReadableReview: publicHumanReadableReviewFromEvidence(humanReadableReview),
      updatedAt: stateRecordedAt.toISOString()
    };
    await store.recordReviewStateWithArtifacts(
      session.id,
      reviewState,
      {
        transactionMaterial: materialHandle,
        transactionMaterialDigest: digest,
        swapQuotePolicy,
        transactionObjectOwnership,
        humanReadableReview
      },
      stateRecordedAt
    );

    const staleSession = await store.getReviewSession(session.id, new Date("2026-06-06T00:00:31.000Z"));

    expect(staleSession).toMatchObject({
      status: "refresh_required",
      reviewState: {
        status: "refresh_required",
        refreshReason: "quote_stale",
        checks: [expect.objectContaining({ id: "private_review_artifacts_refresh_required", status: "fail" })]
      }
    });
    expect(staleSession?.reviewState?.humanReadableReview).toBeUndefined();
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:31.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:00:31.000Z"))).toBeUndefined();
  });

  it("rejects public human-readable review state that is not projected from private evidence", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: stateRecordedAt,
      expiresAt: new Date("2026-06-06T00:00:30.000Z")
    });
    const swapQuotePolicy = testSwapQuotePolicyEvidence({
      materialHandle,
      fetchedAt: "2026-06-06T00:00:00.000Z",
      derivedAt: stateRecordedAt
    });
    const transactionObjectOwnership = testObjectOwnershipEvidence({
      materialId: materialHandle.materialId,
      reviewSessionId: session.id,
      transactionDigest: digest.transactionDigest,
      verifiedAt: stateRecordedAt.toISOString(),
      expiresAt: materialHandle.expiresAt
    });
    const humanReadableReview = testHumanReadableReviewEvidence({
      materialHandle,
      digest,
      swapQuotePolicy,
      transactionObjectOwnership,
      derivedAt: stateRecordedAt
    });
    const publicReview = publicHumanReadableReviewFromEvidence(humanReadableReview);
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "producer_stage_missing",
      checks: [],
      adapterLifecycle: deepbookLifecycle(8),
      humanReadableReview: {
        ...publicReview,
        assetFlow: {
          ...publicReview.assetFlow,
          expectedIncoming: [
            {
              ...publicReview.assetFlow.expectedIncoming[0]!,
              rawAmount: "1"
            }
          ]
        }
      },
      updatedAt: stateRecordedAt.toISOString()
    };

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        reviewState,
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: digest,
          swapQuotePolicy,
          transactionObjectOwnership,
          humanReadableReview
        },
        stateRecordedAt
      )
    ).rejects.toMatchObject({ code: "session_mismatch" });
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:01:00.000Z"))).toBeUndefined();
  });

  it("rejects public human-readable review state recorded without private evidence", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: stateRecordedAt,
      expiresAt: new Date("2026-06-06T00:00:30.000Z")
    });
    const swapQuotePolicy = testSwapQuotePolicyEvidence({
      materialHandle,
      fetchedAt: "2026-06-06T00:00:00.000Z",
      derivedAt: stateRecordedAt
    });
    const transactionObjectOwnership = testObjectOwnershipEvidence({
      materialId: materialHandle.materialId,
      reviewSessionId: session.id,
      transactionDigest: digest.transactionDigest,
      verifiedAt: stateRecordedAt.toISOString(),
      expiresAt: materialHandle.expiresAt
    });
    const humanReadableReview = testHumanReadableReviewEvidence({
      materialHandle,
      digest,
      swapQuotePolicy,
      transactionObjectOwnership,
      derivedAt: stateRecordedAt
    });
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "producer_stage_missing",
      checks: [],
      adapterLifecycle: deepbookLifecycle(8),
      humanReadableReview: publicHumanReadableReviewFromEvidence(humanReadableReview),
      updatedAt: stateRecordedAt.toISOString()
    };

    await expect(
      store.recordReviewState(session.id, reviewState, stateRecordedAt)
    ).rejects.toMatchObject({ code: "session_mismatch" });
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:01:00.000Z"))).toBeUndefined();
  });

  it("rejects private human-readable review evidence when its transaction digest does not match stored material", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const createdAt = new Date("2026-06-06T00:00:00.000Z");
    const connectedAt = new Date("2026-06-06T00:00:01.000Z");
    const materialCreatedAt = new Date("2026-06-06T00:00:02.000Z");
    const stateRecordedAt = new Date("2026-06-06T00:00:03.000Z");
    const { session } = await store.createReviewSession([plan], createdAt);
    await openAndConnectReview(store, session.id, walletAccount, connectedAt);
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: materialCreatedAt,
      computedAt: stateRecordedAt,
      expiresAt: new Date("2026-06-06T00:00:30.000Z")
    });
    const swapQuotePolicy = testSwapQuotePolicyEvidence({
      materialHandle,
      fetchedAt: "2026-06-06T00:00:00.000Z",
      derivedAt: stateRecordedAt
    });
    const transactionObjectOwnership = testObjectOwnershipEvidence({
      materialId: materialHandle.materialId,
      reviewSessionId: session.id,
      transactionDigest: digest.transactionDigest,
      verifiedAt: stateRecordedAt.toISOString(),
      expiresAt: materialHandle.expiresAt
    });
    const humanReadableReview = testHumanReadableReviewEvidence({
      materialHandle,
      digest,
      swapQuotePolicy,
      transactionObjectOwnership,
      derivedAt: stateRecordedAt
    });
    const reviewState: ReviewState = {
      planId: plan.id,
      reviewSessionId: session.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "producer_stage_missing",
      checks: [],
      adapterLifecycle: deepbookLifecycle(8),
      humanReadableReview: publicHumanReadableReviewFromEvidence(humanReadableReview),
      updatedAt: stateRecordedAt.toISOString()
    };

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        reviewState,
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: digest,
          swapQuotePolicy,
          transactionObjectOwnership,
          humanReadableReview: {
            ...humanReadableReview,
            transactionDigest: "1".repeat(32),
            boundToCommitment: "1".repeat(32)
          }
        },
        stateRecordedAt
      )
    ).rejects.toMatchObject({ code: "session_mismatch" });
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
  });

  it("clears private review artifacts when their local material expires while the session is still live", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore, ttlMs: 60_000 });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: new Date("2026-06-06T00:00:02.000Z"),
      computedAt: new Date("2026-06-06T00:00:03.000Z"),
      expiresAt: new Date("2026-06-06T00:00:10.000Z")
    });
    await store.recordReviewStateWithArtifacts(
      session.id,
      {
        planId: plan.id,
        reviewSessionId: session.id,
        account: walletAccount,
        status: "blocked",
        blockedReason: "producer_stage_missing",
        adapterLifecycle: deepbookLifecycle(6),
        checks: [],
        updatedAt: "2026-06-06T00:00:03.000Z"
      },
      {
        transactionMaterial: materialHandle,
        transactionMaterialDigest: digest
      },
      new Date("2026-06-06T00:00:03.000Z")
    );

    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:09.000Z"))).toBeDefined();
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:10.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:00:11.000Z"))).toBeUndefined();
  });

  it("clears private transaction material when execution enters signed pending result", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    const { materialHandle } = await recordReadyReviewStateWithPrivateMaterial({
      store,
      materialStore,
      sessionId: session.id
    });

    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:00:04.000Z"))).toBeDefined();

    const updated = await store.recordExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: "digest",
        recordedAt: "2026-06-06T00:00:04.000Z"
      },
      new Date("2026-06-06T00:00:04.000Z")
    );

    expect(updated.executionResult).toMatchObject({ status: "signed_pending_result", txDigest: "digest" });
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:00:05.000Z"))).toBeUndefined();
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:05.000Z"))).toBeUndefined();
  });

  it("clears legacy stale private material on duplicate signed pending results", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    await recordReadyReviewStateWithPrivateMaterial({
      store,
      materialStore,
      sessionId: session.id
    });
    await store.recordExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: "digest",
        recordedAt: "2026-06-06T00:00:04.000Z"
      },
      new Date("2026-06-06T00:00:04.000Z")
    );
    const stale = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: new Date("2026-06-06T00:00:05.000Z"),
      computedAt: new Date("2026-06-06T00:00:05.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });

    await expect(
      store.recordExecutionResult(
        session.id,
        {
          reviewSessionId: session.id,
          planId: plan.id,
          status: "signed_pending_result",
          txDigest: "digest",
          recordedAt: "2026-06-06T00:00:06.000Z"
        },
        new Date("2026-06-06T00:00:06.000Z")
      )
    ).resolves.toMatchObject({
      executionResult: { status: "signed_pending_result", txDigest: "digest" },
      lastActivityAt: "2026-06-06T00:00:04.000Z"
    });
    expect(materialStore.getTransactionMaterial(stale.handle, new Date("2026-06-06T00:00:07.000Z"))).toBeUndefined();
  });

  it("clears legacy stale private material before rejecting finalized execution result writes", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    await recordReadyReviewStateWithPrivateMaterial({
      store,
      materialStore,
      sessionId: session.id
    });
    await store.recordExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: chainReceiptDigest,
        recordedAt: "2026-06-06T00:00:04.000Z"
      },
      new Date("2026-06-06T00:00:04.000Z")
    );
    await store.recordChainExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "success",
        txDigest: chainReceiptDigest,
        chainReceipt: chainReceiptFixture(),
        recordedAt: "2026-06-06T00:00:05.000Z"
      },
      new Date("2026-06-06T00:00:05.000Z")
    );
    const stale = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: new Date("2026-06-06T00:00:06.000Z"),
      computedAt: new Date("2026-06-06T00:00:06.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });

    await expect(
      store.recordChainExecutionResult(
        session.id,
        {
          reviewSessionId: session.id,
          planId: plan.id,
          status: "success",
          txDigest: otherChainReceiptDigest,
          chainReceipt: chainReceiptFixture({ txDigest: otherChainReceiptDigest }),
          recordedAt: "2026-06-06T00:00:07.000Z"
        },
        new Date("2026-06-06T00:00:07.000Z")
      )
    ).rejects.toThrow("already finalized");
    expect(materialStore.getTransactionMaterial(stale.handle, new Date("2026-06-06T00:00:08.000Z"))).toBeUndefined();
  });

  it("rejects private review artifacts when the local material is missing at storage time", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: new Date("2026-06-06T00:00:02.000Z"),
      computedAt: new Date("2026-06-06T00:00:03.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    materialStore.deleteReviewSessionTransactionMaterials(session.id);

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: session.id,
          account: walletAccount,
          status: "blocked",
          blockedReason: "producer_stage_missing",
          adapterLifecycle: deepbookLifecycle(6),
          checks: [],
          updatedAt: "2026-06-06T00:00:03.000Z"
        },
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: digest
        },
        new Date("2026-06-06T00:00:03.000Z")
      )
    ).rejects.toMatchObject({ code: "session_mismatch" } satisfies Partial<SessionStoreError>);
  });

  it("rejects invalid private digest artifacts before storage", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: new Date("2026-06-06T00:00:02.000Z"),
      computedAt: new Date("2026-06-06T00:00:03.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: session.id,
          account: walletAccount,
          status: "blocked",
          blockedReason: "producer_stage_missing",
          adapterLifecycle: deepbookLifecycle(6),
          checks: [],
          updatedAt: "2026-06-06T00:00:03.000Z"
        },
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: {
            ...digest,
            transactionDigest: "not-a-digest",
          }
        },
        new Date("2026-06-06T00:00:03.000Z")
      )
    ).rejects.toMatchObject({ code: "session_mismatch" } satisfies Partial<SessionStoreError>);
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
  });

  it("rejects private digest artifacts that do not match the stored local bytes", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    const first = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: new Date("2026-06-06T00:00:02.000Z"),
      computedAt: new Date("2026-06-06T00:00:03.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });
    const second = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "other_review",
      planId: "other_plan",
      account: `0x${"c".repeat(64)}`,
      now: new Date("2026-06-06T00:00:02.000Z"),
      computedAt: new Date("2026-06-06T00:00:03.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: session.id,
          account: walletAccount,
          status: "blocked",
          blockedReason: "producer_stage_missing",
          adapterLifecycle: deepbookLifecycle(6),
          checks: [],
          updatedAt: "2026-06-06T00:00:03.000Z"
        },
        {
          transactionMaterial: first.handle,
          transactionMaterialDigest: {
            ...first.digest,
            transactionDigest: second.digest.transactionDigest
          }
        },
        new Date("2026-06-06T00:00:03.000Z")
      )
    ).rejects.toMatchObject({ code: "session_mismatch" } satisfies Partial<SessionStoreError>);
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(first.handle, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
  });

  it("rejects private digest timestamps outside the material lifecycle", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: new Date("2026-06-06T00:00:02.000Z"),
      computedAt: new Date("2026-06-06T00:00:03.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: session.id,
          account: walletAccount,
          status: "blocked",
          blockedReason: "producer_stage_missing",
          adapterLifecycle: deepbookLifecycle(6),
          checks: [],
          updatedAt: "2026-06-06T00:00:03.000Z"
        },
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: {
            ...digest,
            computedAt: "2026-06-06T00:31:00.000Z",
          }
        },
        new Date("2026-06-06T00:00:03.000Z")
      )
    ).rejects.toMatchObject({ code: "session_mismatch" } satisfies Partial<SessionStoreError>);
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
  });

  it("rejects private review artifacts when no local material store is configured", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: new Date("2026-06-06T00:00:02.000Z"),
      computedAt: new Date("2026-06-06T00:00:03.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: session.id,
          account: walletAccount,
          status: "blocked",
          blockedReason: "producer_stage_missing",
          adapterLifecycle: deepbookLifecycle(6),
          checks: [],
          updatedAt: "2026-06-06T00:00:03.000Z"
        },
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: digest
        },
        new Date("2026-06-06T00:00:03.000Z")
      )
    ).rejects.toMatchObject({ code: "session_mismatch" } satisfies Partial<SessionStoreError>);
  });

  it("rejects private review artifacts that do not match the review state identity", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: new Date("2026-06-06T00:00:02.000Z"),
      computedAt: new Date("2026-06-06T00:00:03.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: session.id,
          account: walletAccount,
          status: "blocked",
          blockedReason: "producer_stage_missing",
          adapterLifecycle: deepbookLifecycle(6),
          checks: [],
          updatedAt: "2026-06-06T00:00:03.000Z"
        },
        {
          transactionMaterial: { ...materialHandle, planId: "wrong_plan" },
          transactionMaterialDigest: digest
        },
        new Date("2026-06-06T00:00:03.000Z")
      )
    ).rejects.toMatchObject({ code: "session_mismatch" } satisfies Partial<SessionStoreError>);

    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:01:00.000Z"))).toBeUndefined();
  });

  it("does not update activity for read-only access or token validation", async () => {
    const store = createSessionStore();
    const { session, token } = await store.createReviewSession([plan], new Date(0));

    await expect(store.validateReviewToken(session.id, token, new Date(5))).resolves.toBe(true);
    const afterToken = await store.getReviewSession(session.id, new Date(6));
    expect(afterToken?.lastActivityAt).toBe(new Date(0).toISOString());
  });

  it("keeps optional event log failures from changing lifecycle semantics", async () => {
    const logger = { error: vi.fn() };
    const store = createSessionStore({
      eventLog: { append: async () => { throw new Error("event log unavailable"); } },
      logger
    });

    const { session } = await store.createReviewSession([plan], new Date(0));
    expect(session.status).toBe("proposed");

    const opened = await store.recordReviewPageOpened(session.id, new Date(1));
    expect(opened.status).toBe("awaiting_wallet");

    const wallet = await store.createWalletIdentitySession(new Date(2));
    const walletOpened = await store.recordWalletIdentityOpened(wallet.session.id, new Date(3));
    expect(walletOpened.status).toBe("opened");
    expect(logger.error).toHaveBeenCalledWith("event log append failed", {
      eventType: "session.created",
      error: "event log unavailable"
    });
  });

  it("records review evidence lifecycle calls through the activity store", async () => {
    const activityStore = new InMemoryActivityStore();
    const store = createSessionStore({ activityStore });
    const { session } = await store.createReviewSession([plan], new Date(0));
    await openAndConnectReview(store, session.id, walletAccount, new Date(1));
    await store.recordReviewState(
      session.id,
      {
        planId: plan.id,
        reviewSessionId: session.id,
        account: walletAccount,
        status: "ready_for_wallet_review",
        checks: [],
        updatedAt: new Date(2).toISOString()
      },
      new Date(2)
    );

    expect(activityStore.reviewSessions).toHaveLength(1);
    expect(activityStore.reviewSessions[0]).toMatchObject({
      reviewSessionId: session.id,
      currentStatus: "proposed"
    });
    expect(activityStore.reviewTransitions.map((transition) => transition.event)).toEqual([
      "created",
      "opened",
      "wallet_connected",
      "state_computed"
    ]);
    expect(activityStore.reviewStateSnapshots).toHaveLength(1);
    expect(activityStore.reviewStateSnapshots[0]?.state.status).toBe("ready_for_wallet_review");
  });

  it("rejects execution results for plans outside the session", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));
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

    await expect(
      store.recordExecutionResult(
        session.id,
        {
          reviewSessionId: session.id,
          planId: "not_in_session",
          status: "signed_pending_result",
          txDigest: "digest",
          recordedAt: new Date(3).toISOString()
        },
        new Date(3)
      )
    ).rejects.toThrow("Action plan not found");
  });

  it("rejects review states for another session or a plan outside the session", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));
    await openAndConnectReview(store, session.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Date(1));

    await expect(
      store.recordReviewState(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: "other_session",
          account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "blocked",
          blockedReason: "adapter_not_implemented",
          checks: [],
          updatedAt: new Date(2).toISOString()
        },
        new Date(2)
      )
    ).rejects.toThrow("Review state session mismatch");

    await expect(
      store.recordReviewState(
        session.id,
        {
          planId: "not_in_session",
          reviewSessionId: session.id,
          account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "blocked",
          blockedReason: "adapter_not_implemented",
          checks: [],
          updatedAt: new Date(2).toISOString()
        },
        new Date(2)
      )
    ).rejects.toThrow("Action plan not found");

    await expect(
      store.recordReviewState(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: session.id,
          account: "not-an-address",
          status: "blocked",
          blockedReason: "adapter_not_implemented",
          checks: [],
          updatedAt: new Date(2).toISOString()
        } as never,
        new Date(2)
      )
    ).rejects.toMatchObject({ code: "input_invalid" } satisfies Partial<SessionStoreError>);
  });

  it("rejects execution results for another session", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));
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

    await expect(
      store.recordExecutionResult(
        session.id,
        {
          reviewSessionId: "other_session",
          planId: plan.id,
          status: "signed_pending_result",
          txDigest: "digest",
          recordedAt: new Date(3).toISOString()
        },
        new Date(3)
      )
    ).rejects.toThrow("Execution result session mismatch");
  });

  it("requires deterministic reasons for blocked review and failed execution results", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));
    await openAndConnectReview(store, session.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Date(1));

    await expect(
      store.recordReviewState(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: session.id,
          account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "blocked",
          checks: [],
          updatedAt: new Date(2).toISOString()
        } as unknown as ReviewState,
        new Date(2)
      )
    ).rejects.toMatchObject({ code: "input_invalid" } satisfies Partial<SessionStoreError>);

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

    await expect(
      store.recordExecutionResult(
        session.id,
        {
          reviewSessionId: session.id,
          planId: plan.id,
          status: "failure",
          recordedAt: new Date(3).toISOString()
        } as never,
        new Date(3)
      )
    ).rejects.toMatchObject({ code: "input_invalid" } satisfies Partial<SessionStoreError>);
  });

  it("rejects execution results when account-bound review state is missing", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));
    await openAndConnectReview(store, session.id, walletAccount, new Date(1));
    const sessions = (store as unknown as { sessions: Map<string, { status: string }> }).sessions;
    const mutableSession = sessions.get(session.id);
    if (!mutableSession) {
      throw new Error("test setup failed");
    }
    mutableSession.status = "ready_for_wallet_review";

    await expect(
      store.recordExecutionResult(
        session.id,
        {
          reviewSessionId: session.id,
          planId: plan.id,
          status: "signed_pending_result",
          txDigest: "digest",
          recordedAt: new Date(2).toISOString()
        },
        new Date(2)
      )
    ).rejects.toMatchObject({ code: "invalid_session_transition" } satisfies Partial<SessionStoreError>);
  });

  it("does not mutate review state when activity evidence persistence fails", async () => {
    class FailingSnapshotStore extends InMemoryActivityStore {
      override async recordReviewStateSnapshot(): Promise<void> {
        throw new Error("snapshot failed");
      }
    }

    const store = createSessionStore({ activityStore: new FailingSnapshotStore() });
    const { session } = await store.createReviewSession([plan], new Date(0));
    await openAndConnectReview(store, session.id, walletAccount, new Date(1));

    await expect(
      store.recordReviewState(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: session.id,
          account: walletAccount,
          status: "ready_for_wallet_review",
          checks: [],
          updatedAt: new Date(2).toISOString()
        },
        new Date(2)
      )
    ).rejects.toThrow("snapshot failed");

    const stored = await store.getReviewSession(session.id, new Date(3));
    expect(stored).toMatchObject({
      status: "wallet_connected",
      lastActivityAt: new Date(1).toISOString()
    });
    expect(stored?.reviewState).toBeUndefined();
  });

  it("cleans private transaction material when review state persistence fails after artifact verification", async () => {
    class FailingSnapshotStore extends InMemoryActivityStore {
      override async recordReviewStateSnapshot(): Promise<void> {
        throw new Error("snapshot failed");
      }
    }

    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({
      activityStore: new FailingSnapshotStore(),
      transactionMaterialStore: materialStore
    });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    const { handle: materialHandle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: new Date("2026-06-06T00:00:02.000Z"),
      computedAt: new Date("2026-06-06T00:00:03.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });

    await expect(
      store.recordReviewStateWithArtifacts(
        session.id,
        {
          planId: plan.id,
          reviewSessionId: session.id,
          account: walletAccount,
          status: "blocked",
          blockedReason: "producer_stage_missing",
          adapterLifecycle: deepbookLifecycle(6),
          checks: [],
          updatedAt: "2026-06-06T00:00:03.000Z"
        },
        {
          transactionMaterial: materialHandle,
          transactionMaterialDigest: digest
        },
        new Date("2026-06-06T00:00:03.000Z")
      )
    ).rejects.toThrow("snapshot failed");

    const stored = await store.getReviewSession(session.id, new Date("2026-06-06T00:00:04.000Z"));
    expect(stored).toMatchObject({
      status: "wallet_connected",
      lastActivityAt: "2026-06-06T00:00:01.000Z"
    });
    expect(stored?.reviewState).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:04.000Z"))).toBeUndefined();
  });

  it("does not mutate execution result when activity evidence persistence fails", async () => {
    class FailingExecutionStore extends InMemoryActivityStore {
      override async recordReviewExecution(): Promise<never> {
        throw new Error("execution evidence failed");
      }
    }

    const store = createSessionStore({ activityStore: new FailingExecutionStore() });
    const { session } = await store.createReviewSession([plan], new Date(0));
    await openAndConnectReview(store, session.id, walletAccount, new Date(1));
    await store.recordReviewState(
      session.id,
      {
        planId: plan.id,
        reviewSessionId: session.id,
        account: walletAccount,
        status: "ready_for_wallet_review",
        checks: [],
        updatedAt: new Date(2).toISOString()
      },
      new Date(2)
    );

    await expect(
      store.recordExecutionResult(
        session.id,
        {
          reviewSessionId: session.id,
          planId: plan.id,
          status: "signed_pending_result",
          txDigest: "digest",
          recordedAt: new Date(3).toISOString()
        },
        new Date(3)
      )
    ).rejects.toThrow("execution evidence failed");

    const stored = await store.getReviewSession(session.id, new Date(4));
    expect(stored).toMatchObject({
      status: "ready_for_wallet_review",
      lastActivityAt: new Date(2).toISOString()
    });
    expect(stored?.executionResult).toBeUndefined();
  });

  it("cleans private transaction material when execution persistence fails after review validation", async () => {
    class FailingExecutionStore extends InMemoryActivityStore {
      override async recordReviewExecution(): Promise<never> {
        throw new Error("execution evidence failed");
      }
    }

    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({
      activityStore: new FailingExecutionStore(),
      transactionMaterialStore: materialStore
    });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    const { materialHandle } = await recordReadyReviewStateWithPrivateMaterial({
      store,
      materialStore,
      sessionId: session.id
    });

    await expect(
      store.recordExecutionResult(
        session.id,
        {
          reviewSessionId: session.id,
          planId: plan.id,
          status: "signed_pending_result",
          txDigest: "digest",
          recordedAt: "2026-06-06T00:00:04.000Z"
        },
        new Date("2026-06-06T00:00:04.000Z")
      )
    ).rejects.toThrow("execution evidence failed");

    const stored = await store.getReviewSession(session.id, new Date("2026-06-06T00:00:05.000Z"));
    expect(stored).toMatchObject({
      status: "ready_for_wallet_review",
      lastActivityAt: "2026-06-06T00:00:03.000Z"
    });
    expect(stored?.executionResult).toBeUndefined();
    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:00:05.000Z"))).toBeUndefined();
    expect(await store.getReviewSessionPrivateArtifacts(session.id, new Date("2026-06-06T00:00:05.000Z"))).toBeUndefined();
  });

  it("does not mutate terminal success sessions to expired on read", async () => {
    const t0 = new Date(0);
    const tAfterTtl = new Date(10);
    const store = createSessionStore({ ttlMs: 1 });
    const { session } = await store.createReviewSession([plan], t0);
    await openAndConnectReview(store, session.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", t0);
    await store.recordReviewState(
      session.id,
      {
        planId: plan.id,
        reviewSessionId: session.id,
        account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "ready_for_wallet_review",
        checks: [],
        updatedAt: t0.toISOString()
      },
      t0
    );
    await store.recordExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: chainReceiptDigest,
        recordedAt: t0.toISOString()
      },
      t0
    );
    await store.recordChainExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "success",
        txDigest: chainReceiptDigest,
        chainReceipt: chainReceiptFixture(),
        recordedAt: t0.toISOString()
      },
      t0
    );

    const expiredRead = await store.getReviewSession(session.id, tAfterTtl);
    expect(expiredRead?.status).toBe("success");
  });

  it("does not append duplicate expired transitions after a review session is already expired", async () => {
    const activityStore = new InMemoryActivityStore();
    const store = createSessionStore({ ttlMs: 1, activityStore });
    const { session } = await store.createReviewSession([plan], new Date(0));

    const first = await store.getReviewSession(session.id, new Date(2));
    const second = await store.getReviewSession(session.id, new Date(3));

    expect(first?.status).toBe("expired");
    expect(second?.status).toBe("expired");
    expect(activityStore.reviewTransitions.filter((transition) => transition.event === "expired")).toHaveLength(1);
  });

  it("cleans private transaction material when review expiry persistence fails", async () => {
    const activityStore = new InMemoryActivityStore();
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({
      ttlMs: 10_000,
      activityStore,
      transactionMaterialStore: materialStore
    });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    const { materialHandle } = await recordReadyReviewStateWithPrivateMaterial({
      store,
      materialStore,
      sessionId: session.id
    });
    const recordReviewTransition = vi
      .spyOn(activityStore, "recordReviewTransition")
      .mockRejectedValueOnce(new Error("expired transition failed"));

    await expect(
      store.getReviewSession(session.id, new Date("2026-06-06T00:01:00.000Z"))
    ).rejects.toThrow("expired transition failed");

    expect(materialStore.getTransactionMaterial(materialHandle, new Date("2026-06-06T00:01:00.000Z"))).toBeUndefined();
    recordReviewTransition.mockRestore();
  });

  it("does not allow finalized execution results to be overwritten", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan]);
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

    await expect(
      store.recordChainExecutionResult(session.id, {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "success",
        txDigest: otherChainReceiptDigest,
        chainReceipt: chainReceiptFixture({ txDigest: otherChainReceiptDigest }),
        recordedAt: new Date().toISOString()
      })
    ).rejects.toThrow("already finalized");
  });

  it("keeps token validation separate from terminal session lifecycle", async () => {
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

    await expect(store.validateReviewToken(session.id, token)).resolves.toBe(true);
  });

  it("treats duplicate signed_pending_result as idempotent only for the same digest", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));
    await openAndConnectReview(store, session.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Date(1));
    await store.recordReviewState(session.id, {
      planId: plan.id,
      reviewSessionId: session.id,
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "ready_for_wallet_review",
      checks: [],
      updatedAt: new Date(2).toISOString()
    }, new Date(2));
    await store.recordExecutionResult(session.id, {
      reviewSessionId: session.id,
      planId: plan.id,
      status: "signed_pending_result",
      txDigest: "digest",
      recordedAt: new Date(3).toISOString()
    }, new Date(3));

    await expect(
      store.recordExecutionResult(session.id, {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: "digest",
        recordedAt: new Date(4).toISOString()
      }, new Date(4))
    ).resolves.toMatchObject({
      executionResult: { txDigest: "digest" },
      lastActivityAt: new Date(3).toISOString()
    });

    await expect(
      store.recordExecutionResult(session.id, {
        reviewSessionId: session.id,
        planId: "not_in_session",
        status: "signed_pending_result",
        txDigest: "digest",
        recordedAt: new Date().toISOString()
      }, new Date(5))
    ).rejects.toThrow("Action plan not found");

    await expect(
      store.recordExecutionResult(session.id, {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: "different",
        recordedAt: new Date().toISOString()
      }, new Date(5))
    ).rejects.toThrow("Signed pending result already recorded");
  });

  it("cleans legacy private material before rejecting conflicting signed pending results", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const store = createSessionStore({ transactionMaterialStore: materialStore });
    const { session } = await store.createReviewSession([plan], new Date("2026-06-06T00:00:00.000Z"));
    await openAndConnectReview(store, session.id, walletAccount, new Date("2026-06-06T00:00:01.000Z"));
    await recordReadyReviewStateWithPrivateMaterial({
      store,
      materialStore,
      sessionId: session.id
    });
    await store.recordExecutionResult(
      session.id,
      {
        reviewSessionId: session.id,
        planId: plan.id,
        status: "signed_pending_result",
        txDigest: "digest",
        recordedAt: "2026-06-06T00:00:04.000Z"
      },
      new Date("2026-06-06T00:00:04.000Z")
    );
    const stale = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: session.id,
      planId: plan.id,
      account: walletAccount,
      now: new Date("2026-06-06T00:00:05.000Z"),
      computedAt: new Date("2026-06-06T00:00:05.000Z"),
      expiresAt: new Date("2026-06-06T00:30:00.000Z")
    });

    await expect(
      store.recordExecutionResult(
        session.id,
        {
          reviewSessionId: session.id,
          planId: plan.id,
          status: "signed_pending_result",
          txDigest: "different",
          recordedAt: "2026-06-06T00:00:06.000Z"
        },
        new Date("2026-06-06T00:00:06.000Z")
      )
    ).rejects.toThrow("Signed pending result already recorded");

    expect(materialStore.getTransactionMaterial(stale.handle, new Date("2026-06-06T00:00:07.000Z"))).toBeUndefined();
  });

  it("rejects wallet reconnection to a different account while review state is recomputed", async () => {
    const store = createSessionStore();
    const { session } = await store.createReviewSession([plan], new Date(0));
    await openAndConnectReview(store, session.id, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", new Date(1));
    await store.recordReviewState(
      session.id,
      {
        planId: plan.id,
        reviewSessionId: session.id,
        account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "blocked",
        blockedReason: "adapter_not_implemented",
        checks: [],
        updatedAt: new Date(2).toISOString()
      },
      new Date(2)
    );

    await expect(
      store.recordWalletConnected(session.id, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", new Date(3))
    ).rejects.toMatchObject({ code: "invalid_session_transition" } satisfies Partial<SessionStoreError>);
  });
});
