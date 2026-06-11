import { afterEach, describe, expect, it, vi } from "vitest";
import { validateSupportedAdapterLifecycle } from "../src/adapters/adapterLifecycleValidators.js";
import type { ActionPlan, ReviewSession } from "../src/core/action/types.js";
import { InMemorySessionStore, type SessionStore } from "../src/core/session/sessionStore.js";
import { SessionStoreError } from "../src/core/session/sessionStore.js";
import type { WalletIdentitySession } from "../src/core/session/walletIdentity.js";
import {
  WaitRequestAbortedError,
  waitForExecutionResult,
  waitForWalletIdentitySession
} from "../src/core/session/wait.js";
import { InMemoryActivityStore } from "./fixtures/inMemoryActivityStore.js";

const walletPending: WalletIdentitySession = {
  id: "wallet_1",
  tokenHash: "hash",
  status: "pending",
  createdAt: "2026-05-12T00:00:00.000Z",
  expiresAt: "2026-05-12T00:30:00.000Z",
  lastActivityAt: "2026-05-12T00:00:00.000Z"
};

const walletConnected: WalletIdentitySession = {
  ...walletPending,
  status: "connected",
  account: `0x${"a".repeat(64)}`,
  chain: "sui:mainnet"
};

const reviewPending: ReviewSession = {
  id: "review_1",
  tokenHash: "hash",
  status: "awaiting_wallet",
  plans: [],
  createdAt: "2026-05-12T00:00:00.000Z",
  expiresAt: "2026-05-12T00:30:00.000Z",
  lastActivityAt: "2026-05-12T00:00:00.000Z"
};

const reviewPlan: ActionPlan = {
  id: "plan_wait_test",
  actionKind: "swap",
  adapterId: "deepbook-swap",
  protocol: "DeepBookV3",
  title: "Wait test swap",
  summary: "Wait test swap",
  assetFlowPreview: {
    outgoing: [{ symbol: "SUI", amount: "1", amountKind: "display_intent" }],
    expectedIncoming: [{ symbol: "USDC", amount: "unknown", amountKind: "display_intent", approx: true }]
  },
  adapterData: {
    requestedIntent: {
      from: "SUI",
      to: "USDC",
      amount: "1"
    }
  },
  createdAt: "2026-05-12T00:00:00.000Z"
};

const reviewBlocked: ReviewSession = {
  ...reviewPending,
  status: "blocked"
};

const reviewRefreshRequired: ReviewSession = {
  ...reviewPending,
  status: "refresh_required"
};

const reviewSignedPending: ReviewSession = {
  ...reviewPending,
  status: "signed_pending_result",
  account: `0x${"b".repeat(64)}`,
  executionResult: {
    reviewSessionId: "review_1",
    planId: "plan_1",
    status: "signed_pending_result",
    txDigest: "digest_1",
    recordedAt: "2026-05-12T00:00:01.000Z"
  }
};

const reviewSuccess: ReviewSession = {
  ...reviewSignedPending,
  status: "success",
  executionResult: {
    reviewSessionId: "review_1",
    planId: "plan_1",
    status: "success",
    txDigest: "digest_1",
    recordedAt: "2026-05-12T00:00:02.000Z"
  }
};

afterEach(() => {
  vi.useRealTimers();
});

describe("session wait helpers", () => {
  it("returns immediately for terminal wallet identity sessions", async () => {
    await expect(
      waitForWalletIdentitySession(walletStore([walletConnected]), "wallet_1")
    ).resolves.toMatchObject({
      waitOutcome: "status_reached",
      statusCategory: "terminal",
      session: { status: "connected" }
    });
  });

  it("times out for non-terminal wallet identity sessions", async () => {
    vi.useFakeTimers();
    const wait = waitForWalletIdentitySession(walletStore([walletPending]), "wallet_1", { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(wait).resolves.toMatchObject({
      waitOutcome: "timed_out",
      statusCategory: "non_terminal",
      session: { status: "pending" }
    });
  });

  it("clears wallet wait timers when the host abort signal is forwarded", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const wait = waitForWalletIdentitySession(walletStore([walletPending]), "wallet_1", {
      timeoutMs: 1000,
      signal: controller.signal
    });

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(wait).rejects.toBeInstanceOf(WaitRequestAbortedError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not read the store when the host abort signal is already forwarded", async () => {
    const controller = new AbortController();
    controller.abort();
    const store = {
      async getWalletIdentitySession() {
        throw new Error("store should not be read after abort");
      }
    } as unknown as SessionStore;

    await expect(
      waitForWalletIdentitySession(store, "wallet_1", { signal: controller.signal })
    ).rejects.toBeInstanceOf(WaitRequestAbortedError);
  });

  it("maps missing wallet sessions to session_not_found", async () => {
    await expect(waitForWalletIdentitySession(walletStore([]), "missing", { timeoutMs: 1 })).rejects.toMatchObject({
      code: "session_not_found",
      details: { reason: "missing" }
    } satisfies Partial<SessionStoreError>);
  });

  it("maps wallet sessions removed during wait to session_not_found with a removal reason", async () => {
    vi.useFakeTimers();
    let current: WalletIdentitySession | undefined = walletPending;
    const store = {
      async getWalletIdentitySession(id: string) {
        return current?.id === id ? current : undefined;
      }
    } as SessionStore;
    const wait = waitForWalletIdentitySession(store, "wallet_1", { timeoutMs: 100 });
    const waitFailure = expect(wait).rejects.toMatchObject({
      code: "session_not_found",
      details: { reason: "session_removed_during_wait" }
    } satisfies Partial<SessionStoreError>);

    current = undefined;
    await vi.advanceTimersByTimeAsync(100);

    await waitFailure;
  });

  it("resolves wallet waits when lazy expiry occurs during the wait", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
    const store = new InMemorySessionStore({
      activityStore: new InMemoryActivityStore(),
      logger: { error() {} },
      validateAdapterLifecycle: validateSupportedAdapterLifecycle,
      ttlMs: 1_000
    });
    const { session } = await store.createWalletIdentitySession(new Date());
    const wait = waitForWalletIdentitySession(store, session.id, {
      timeoutMs: 2_000,
      now: () => new Date()
    });

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(wait).resolves.toMatchObject({
      waitOutcome: "status_reached",
      statusCategory: "terminal",
      session: { status: "expired" }
    });
  });

  it("returns blocked execution status as user-action-required wait stop", async () => {
    await expect(waitForExecutionResult(reviewStore([reviewBlocked]), "review_1")).resolves.toMatchObject({
      waitOutcome: "status_reached",
      status: "blocked",
      session: { status: "blocked" }
    });
  });

  it("returns refresh-required execution status as user-action-required wait stop", async () => {
    await expect(waitForExecutionResult(reviewStore([reviewRefreshRequired]), "review_1")).resolves.toMatchObject({
      waitOutcome: "status_reached",
      status: "refresh_required",
      session: { status: "refresh_required" }
    });
  });

  it("treats signed_pending_result as non-terminal until success or failure appears", async () => {
    vi.useFakeTimers();
    const store = sequenceReviewStore([reviewSignedPending, reviewSuccess]);
    const wait = waitForExecutionResult(store, "review_1", { timeoutMs: 4000 });

    await vi.advanceTimersByTimeAsync(3000);

    await expect(wait).resolves.toMatchObject({
      waitOutcome: "status_reached",
      status: "success",
      session: { status: "success" }
    });
  });

  it("resolves simultaneous execution waiters for the same session from shared state", async () => {
    vi.useFakeTimers();
    let current = reviewSignedPending;
    const store = {
      async getReviewSession(id: string) {
        return current.id === id ? current : undefined;
      }
    } as SessionStore;
    const firstWait = waitForExecutionResult(store, "review_1", { timeoutMs: 4000 });
    const secondWait = waitForExecutionResult(store, "review_1", { timeoutMs: 4000 });

    current = reviewSuccess;
    await vi.advanceTimersByTimeAsync(3000);

    await expect(firstWait).resolves.toMatchObject({ waitOutcome: "status_reached", status: "success" });
    await expect(secondWait).resolves.toMatchObject({ waitOutcome: "status_reached", status: "success" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves execution waits when lazy expiry occurs during the wait", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
    const store = new InMemorySessionStore({
      activityStore: new InMemoryActivityStore(),
      logger: { error() {} },
      validateAdapterLifecycle: validateSupportedAdapterLifecycle,
      ttlMs: 1_000
    });
    const { session } = await store.createReviewSession([reviewPlan], new Date());
    const wait = waitForExecutionResult(store, session.id, {
      timeoutMs: 3_000,
      now: () => new Date()
    });

    await vi.advanceTimersByTimeAsync(3_000);

    await expect(wait).resolves.toMatchObject({
      waitOutcome: "status_reached",
      status: "expired",
      session: { status: "expired" }
    });
  });

  it("clears execution wait timers when a poll iteration throws", async () => {
    vi.useFakeTimers();
    const store = sequenceReviewStore([reviewPending], new Error("activity store failed"));
    const wait = waitForExecutionResult(store, "review_1", { timeoutMs: 4000 });
    const waitFailure = expect(wait).rejects.toThrow("activity store failed");

    await vi.advanceTimersByTimeAsync(3000);

    await waitFailure;
    expect(vi.getTimerCount()).toBe(0);
  });
});

function walletStore(sessions: WalletIdentitySession[]): SessionStore {
  return {
    async getWalletIdentitySession(id: string) {
      return sessions.find((session) => session.id === id);
    }
  } as SessionStore;
}

function reviewStore(sessions: ReviewSession[]): SessionStore {
  return sequenceReviewStore(sessions);
}

function sequenceReviewStore(sessions: ReviewSession[], finalError?: Error): SessionStore {
  let calls = 0;
  return {
    async getReviewSession(id: string) {
      const session = sessions[Math.min(calls, sessions.length - 1)];
      calls += 1;
      if (calls > sessions.length && finalError) {
        throw finalError;
      }
      return session?.id === id ? session : undefined;
    }
  } as SessionStore;
}
