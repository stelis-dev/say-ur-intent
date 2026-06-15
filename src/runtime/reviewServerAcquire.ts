import type { Logger } from "./logger.js";

// The review server is a single-origin singleton per machine: the loopback origin
// (scheme://127.0.0.1:port) stays constant so the browser wallet autoconnect can
// silently restore the signer. All live session state lives in the shared local
// database, so whichever single process owns the fixed port serves every client.
// When the port is already held by a healthy peer of our own review server, a new
// instance therefore DEFERS (runs no local HTTP server, relying on the peer) instead
// of taking the port over — no process is ever signalled. A deferring instance
// watches the port and takes the origin over only if the owner exits (failover). A
// port held by anything that is not a separate instance of our review server is never
// touched, and is never silently reassigned.

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

export type ReviewServerLifecycle = {
  // true when a healthy peer owns the port and this instance is deferring to it.
  deferred: boolean;
  // Stop serving (owner) or stop watching for takeover (deferring), closing the
  // server if a deferring instance acquired the port in the meantime.
  close(): Promise<void>;
};

export type StartOrDeferReviewServerDeps = {
  // Identify the current port holder over loopback. Returns null for a foreign
  // process or no answer, in which case we never defer to it.
  probeIdentity: (port: number) => Promise<ReviewServerIdentity | null>;
  delay: (ms: number) => Promise<void>;
  currentPid: number;
  serviceName: string;
  logger: Pick<Logger, "info" | "warn">;
  // How often a deferring instance retries binding to detect that the owner exited.
  reacquireIntervalMs?: number;
};

const DEFAULT_REACQUIRE_INTERVAL_MS = 3000;

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

// Bind the port: returns the server on success, undefined when the port is already
// in use, and rethrows any other (non-EADDRINUSE) startup error.
async function tryStart<T extends StartedReviewServerLike>(
  start: (port: number) => Promise<T>,
  port: number
): Promise<T | undefined> {
  try {
    return await start(port);
  } catch (error) {
    if (errorCode(error) === "EADDRINUSE") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Bind the review server to its fixed port, or defer to a healthy peer already
 * serving it.
 *
 * - Port free → bind and own the single review origin.
 * - Port held by a separate healthy instance of our review server → defer (run no
 *   local server; the peer serves the shared database for every client) and watch for
 *   the owner to exit, then take the origin over. No process is ever signalled.
 * - Port held by anything else (foreign, no identity answer, or our own pid) → clear
 *   error; the origin is never silently reassigned.
 */
export async function startOrDeferReviewServer<T extends StartedReviewServerLike>(
  start: (port: number) => Promise<T>,
  port: number,
  deps: StartOrDeferReviewServerDeps
): Promise<ReviewServerLifecycle> {
  const owned = await tryStart(start, port);
  if (owned) {
    deps.logger.info("review server bound; owning the review origin", { port });
    return { deferred: false, close: () => owned.close() };
  }

  const holder = await deps.probeIdentity(port);
  if (!holder || holder.service !== deps.serviceName || holder.pid === deps.currentPid) {
    throw new Error(
      `Review server port ${port} is already in use by a process that is not a separate ${deps.serviceName} review server. ` +
        `Set SAY_UR_INTENT_REVIEW_PORT to a free port. The port is not reassigned automatically so the wallet autoconnect origin stays stable.`
    );
  }

  deps.logger.info("review port owned by a healthy peer; deferring and watching for takeover", {
    port,
    ownerPid: holder.pid,
    ...(holder.version ? { ownerVersion: holder.version } : {})
  });

  const reacquireIntervalMs = deps.reacquireIntervalMs ?? DEFAULT_REACQUIRE_INTERVAL_MS;
  let stopped = false;
  let acquired: T | undefined;
  const watch = (async () => {
    while (!stopped && !acquired) {
      await deps.delay(reacquireIntervalMs);
      if (stopped || acquired) {
        break;
      }
      const next = await tryStart(start, port);
      if (!next) {
        continue; // a peer still owns the port; keep deferring
      }
      if (stopped) {
        await next.close();
        break;
      }
      acquired = next;
      deps.logger.info("acquired review port after the previous owner exited", { port });
    }
  })();
  watch.catch(() => undefined);

  return {
    deferred: true,
    close: async () => {
      // Stop watching; the loop's stopped-check closes any bind that lands in-flight,
      // so we never await the (possibly mid-delay) watch loop here.
      stopped = true;
      if (acquired) {
        await acquired.close();
      }
    }
  };
}

/**
 * Ask whatever is listening on the loopback review port to identify itself. Only our
 * own review server answers `/__identity`; any other process either returns something
 * else or does not answer, and we report it as "not ours" so the caller never defers
 * to it.
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
