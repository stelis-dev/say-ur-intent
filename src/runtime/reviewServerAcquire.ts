import type { Logger } from "./logger.js";

// The review server is a single-origin singleton per machine: the loopback
// origin (scheme://127.0.0.1:port) must stay constant so the browser wallet
// autoconnect can silently restore the signer instead of prompting again. We
// therefore never fall back to a random port. Instead, when a newer instance
// finds the fixed port already held by a *previous instance of our own review
// server*, it stops that previous instance and takes the port over, so the most
// recently started client owns the one review origin. A port held by anything
// else is never touched.

export type StartedReviewServerLike = {
  host: "127.0.0.1";
  port: number;
  close(): Promise<void>;
};

export type ReviewServerIdentity = {
  service: string;
  role: string;
  pid: number;
  version?: string;
};

export type ProcessTerminationResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "no_permission" | "error"; message?: string };

export type StartReviewServerWithTakeoverDeps = {
  // Confirm who holds the port before we ever signal it. Returns null when the
  // holder does not answer as our own review server (a foreign process, or no
  // response at all) — in that case we never send a signal.
  probeIdentity: (port: number) => Promise<ReviewServerIdentity | null>;
  // Signal a same-user process. Cross-user pids fail with no_permission and we
  // never escalate privileges.
  terminate: (pid: number) => ProcessTerminationResult;
  delay: (ms: number) => Promise<void>;
  currentPid: number;
  serviceName: string;
  logger: Pick<Logger, "info" | "warn">;
  waitForReleaseMs?: number;
  pollIntervalMs?: number;
};

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

/**
 * Bind the review server to its fixed port, taking the port over from a previous
 * instance of our own review server if necessary.
 *
 * Safety: the holder is positively identified over loopback before any signal is
 * sent. A process that is not our review server is never signalled; a same-name
 * instance owned by another OS user surfaces a clear error rather than a kill.
 * The port is never silently reassigned, so the wallet autoconnect origin stays
 * stable.
 */
export async function startReviewServerWithTakeover<T extends StartedReviewServerLike>(
  start: (port: number) => Promise<T>,
  port: number,
  deps: StartReviewServerWithTakeoverDeps
): Promise<T> {
  try {
    return await start(port);
  } catch (error) {
    if (errorCode(error) !== "EADDRINUSE") {
      throw error;
    }

    const holder = await deps.probeIdentity(port);
    if (!holder || holder.service !== deps.serviceName) {
      throw new Error(
        `Review server port ${port} is already in use by a process that is not a ${deps.serviceName} review server. ` +
          `Set SAY_UR_INTENT_REVIEW_PORT to a free port. The port is not reassigned automatically so the wallet autoconnect origin stays stable.`
      );
    }
    if (holder.pid === deps.currentPid) {
      // We appear to hold the port ourselves yet cannot bind it. Never signal
      // our own process; surface the original bind error.
      throw error;
    }

    deps.logger.info("review port held by a previous say-ur-intent instance; taking it over", {
      port,
      previousPid: holder.pid
    });

    const terminated = deps.terminate(holder.pid);
    if (!terminated.ok) {
      if (terminated.reason === "no_permission") {
        throw new Error(
          `Review server port ${port} is held by a ${deps.serviceName} instance owned by another OS user; cannot take it over. ` +
            `Set SAY_UR_INTENT_REVIEW_PORT to a free port for this client.`
        );
      }
      if (terminated.reason === "error") {
        throw new Error(
          `Failed to stop the ${deps.serviceName} instance holding review port ${port}: ${terminated.message ?? "unknown error"}.`
        );
      }
      // not_found: the holder already exited between probe and signal; fall
      // through and rebind.
    }

    const waitForReleaseMs = deps.waitForReleaseMs ?? 3000;
    const pollIntervalMs = deps.pollIntervalMs ?? 100;
    const attempts = Math.max(1, Math.ceil(waitForReleaseMs / pollIntervalMs));
    for (let attempt = 0; attempt < attempts; attempt++) {
      await deps.delay(pollIntervalMs);
      try {
        return await start(port);
      } catch (retryError) {
        if (errorCode(retryError) !== "EADDRINUSE") {
          throw retryError;
        }
      }
    }

    throw new Error(
      `Review server port ${port} did not become free after stopping the previous ${deps.serviceName} instance (pid ${holder.pid}). ` +
        `Set SAY_UR_INTENT_REVIEW_PORT to a free port.`
    );
  }
}

/**
 * Ask whatever is listening on the loopback review port to identify itself. Only
 * our own review server answers `/__identity`; any other process either returns
 * something else or does not answer, and we report it as "not ours" so the
 * caller never signals it.
 */
export async function probeReviewServerIdentity(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 1000
): Promise<ReviewServerIdentity | null> {
  try {
    const response = await fetch(`http://${host}:${port}/__identity`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      typeof (body as { service?: unknown }).service === "string" &&
      typeof (body as { role?: unknown }).role === "string" &&
      typeof (body as { pid?: unknown }).pid === "number"
    ) {
      const typed = body as { service: string; role: string; pid: number; version?: unknown };
      return {
        service: typed.service,
        role: typed.role,
        pid: typed.pid,
        ...(typeof typed.version === "string" ? { version: typed.version } : {})
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Gracefully signal a same-user process. SIGTERM lets the previous instance run
 * its own shutdown handler (close the review server and database, then exit).
 * Killing another OS user's process fails with EPERM, which we report instead of
 * escalating.
 */
export function terminateProcessByPid(pid: number): ProcessTerminationResult {
  try {
    process.kill(pid, "SIGTERM");
    return { ok: true };
  } catch (error) {
    const code = errorCode(error);
    if (code === "ESRCH") {
      return { ok: false, reason: "not_found" };
    }
    if (code === "EPERM") {
      return { ok: false, reason: "no_permission" };
    }
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
