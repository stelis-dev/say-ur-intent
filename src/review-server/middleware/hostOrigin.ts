import type { IncomingMessage } from "node:http";

export type HostOriginPolicy = {
  allowedHostnames: string[];
};

export type HostOriginResult =
  | { ok: true }
  | { ok: false; status: 400 | 403; reason: string };

export function validateHostOrigin(
  request: IncomingMessage,
  policy: HostOriginPolicy
): HostOriginResult {
  const hostHeader = request.headers.host;
  const host = parseHost(hostHeader);
  if (!host || !policy.allowedHostnames.includes(host.hostname)) {
    return { ok: false, status: 400, reason: "invalid_host" };
  }

  const originHeader = request.headers.origin;
  if (!originHeader) {
    return { ok: true };
  }

  try {
    const origin = new URL(originHeader);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
      return { ok: false, status: 403, reason: "invalid_origin" };
    }
    if (origin.protocol !== "http:" && origin.protocol !== "https:") {
      return { ok: false, status: 403, reason: "invalid_origin" };
    }
    if (!policy.allowedHostnames.includes(origin.hostname)) {
      return { ok: false, status: 403, reason: "invalid_origin" };
    }
    if (originPort(origin) !== host.port) {
      return { ok: false, status: 403, reason: "origin_port_mismatch" };
    }
  } catch {
    return { ok: false, status: 403, reason: "invalid_origin" };
  }

  return { ok: true };
}

function parseHost(hostHeader: string | undefined): { hostname: string; port?: string } | undefined {
  if (!hostHeader) {
    return undefined;
  }

  try {
    const url = new URL(`http://${hostHeader}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    return { hostname: url.hostname, port: url.port || "80" };
  } catch {
    return undefined;
  }
}

function originPort(origin: URL): string {
  return origin.port || (origin.protocol === "https:" ? "443" : "80");
}
