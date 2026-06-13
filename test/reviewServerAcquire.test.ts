import { describe, expect, it, vi } from "vitest";
import {
  startReviewServerWithTakeover,
  type ProcessTerminationResult,
  type ReviewServerIdentity,
  type StartedReviewServerLike
} from "../src/runtime/reviewServerAcquire.js";

const SERVICE = "say-ur-intent";
const noopLogger = { info() {}, warn() {} };
const noDelay = async () => {};

function startedServer(port = 8765): StartedReviewServerLike {
  return { host: "127.0.0.1", port, close: async () => {} };
}

function addrInUse(): Error {
  return Object.assign(new Error("listen EADDRINUSE 127.0.0.1:8765"), { code: "EADDRINUSE" });
}

function ownIdentity(pid: number): ReviewServerIdentity {
  return { service: SERVICE, role: "review-server", pid };
}

function baseDeps(overrides: Partial<Parameters<typeof startReviewServerWithTakeover>[2]> = {}) {
  return {
    probeIdentity: vi.fn(async () => null as ReviewServerIdentity | null),
    terminate: vi.fn((): ProcessTerminationResult => ({ ok: true })),
    delay: noDelay,
    currentPid: 999,
    serviceName: SERVICE,
    logger: noopLogger,
    ...overrides
  };
}

describe("startReviewServerWithTakeover", () => {
  it("binds immediately and never probes when the port is free", async () => {
    const start = vi.fn(async (port: number) => startedServer(port));
    const deps = baseDeps();

    const server = await startReviewServerWithTakeover(start, 8765, deps);

    expect(server.port).toBe(8765);
    expect(start).toHaveBeenCalledTimes(1);
    expect(deps.probeIdentity).not.toHaveBeenCalled();
    expect(deps.terminate).not.toHaveBeenCalled();
  });

  it("takes over a previous own instance, then rebinds the same port", async () => {
    let freed = false;
    const start = vi.fn(async (port: number) => {
      if (!freed) throw addrInUse();
      return startedServer(port);
    });
    const deps = baseDeps({
      probeIdentity: vi.fn(async () => ownIdentity(4242)),
      terminate: vi.fn((pid: number): ProcessTerminationResult => {
        expect(pid).toBe(4242);
        freed = true;
        return { ok: true };
      })
    });

    const server = await startReviewServerWithTakeover(start, 8765, deps);

    expect(server.port).toBe(8765);
    expect(deps.probeIdentity).toHaveBeenCalledWith(8765);
    expect(deps.terminate).toHaveBeenCalledTimes(1);
    expect(start.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("never signals a process that is not our review server", async () => {
    const start = vi.fn(async () => {
      throw addrInUse();
    });
    const deps = baseDeps({
      probeIdentity: vi.fn(async () => ({ service: "some-other-app", role: "x", pid: 1 }))
    });

    await expect(startReviewServerWithTakeover(start, 8765, deps)).rejects.toThrow(
      /not a say-ur-intent review server/
    );
    expect(deps.terminate).not.toHaveBeenCalled();
  });

  it("never signals when the holder does not answer the identity probe", async () => {
    const start = vi.fn(async () => {
      throw addrInUse();
    });
    const deps = baseDeps({ probeIdentity: vi.fn(async () => null) });

    await expect(startReviewServerWithTakeover(start, 8765, deps)).rejects.toThrow(
      /not a say-ur-intent review server/
    );
    expect(deps.terminate).not.toHaveBeenCalled();
  });

  it("does not signal its own process if it appears to hold the port", async () => {
    const start = vi.fn(async () => {
      throw addrInUse();
    });
    const deps = baseDeps({
      currentPid: 777,
      probeIdentity: vi.fn(async () => ownIdentity(777))
    });

    await expect(startReviewServerWithTakeover(start, 8765, deps)).rejects.toThrow(/EADDRINUSE/);
    expect(deps.terminate).not.toHaveBeenCalled();
  });

  it("surfaces a clear error when the holder is owned by another OS user", async () => {
    const start = vi.fn(async () => {
      throw addrInUse();
    });
    const deps = baseDeps({
      probeIdentity: vi.fn(async () => ownIdentity(4242)),
      terminate: vi.fn((): ProcessTerminationResult => ({ ok: false, reason: "no_permission" }))
    });

    await expect(startReviewServerWithTakeover(start, 8765, deps)).rejects.toThrow(/another OS user/);
  });

  it("surfaces the underlying message when terminating the holder fails", async () => {
    const start = vi.fn(async () => {
      throw addrInUse();
    });
    const deps = baseDeps({
      probeIdentity: vi.fn(async () => ownIdentity(4242)),
      terminate: vi.fn((): ProcessTerminationResult => ({ ok: false, reason: "error", message: "kill blew up" }))
    });

    await expect(startReviewServerWithTakeover(start, 8765, deps)).rejects.toThrow(/kill blew up/);
  });

  it("treats an already-exited holder as freed and rebinds", async () => {
    let freed = false;
    const start = vi.fn(async (port: number) => {
      if (!freed) throw addrInUse();
      return startedServer(port);
    });
    const deps = baseDeps({
      probeIdentity: vi.fn(async () => ownIdentity(4242)),
      terminate: vi.fn((): ProcessTerminationResult => {
        freed = true;
        return { ok: false, reason: "not_found" };
      })
    });

    const server = await startReviewServerWithTakeover(start, 8765, deps);

    expect(server.port).toBe(8765);
  });

  it("gives up with a clear error if the port never frees after takeover", async () => {
    const start = vi.fn(async () => {
      throw addrInUse();
    });
    const deps = baseDeps({
      probeIdentity: vi.fn(async () => ownIdentity(4242)),
      waitForReleaseMs: 30,
      pollIntervalMs: 10
    });

    await expect(startReviewServerWithTakeover(start, 8765, deps)).rejects.toThrow(/did not become free/);
  });

  it("rethrows non-EADDRINUSE bind errors without probing or signalling", async () => {
    const start = vi.fn(async () => {
      throw new Error("verify mainnet endpoint failed");
    });
    const deps = baseDeps();

    await expect(startReviewServerWithTakeover(start, 8765, deps)).rejects.toThrow(
      /verify mainnet endpoint failed/
    );
    expect(deps.probeIdentity).not.toHaveBeenCalled();
    expect(deps.terminate).not.toHaveBeenCalled();
  });
});
