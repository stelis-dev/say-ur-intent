import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { validateHostOrigin } from "../src/review-server/middleware/hostOrigin.js";

function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("validateHostOrigin", () => {
  it("accepts localhost host without origin", () => {
    expect(
      validateHostOrigin(request({ host: "127.0.0.1:4173" }), {
        allowedHostnames: ["127.0.0.1", "localhost"]
      })
    ).toEqual({ ok: true });
  });

  it("rejects non-localhost host", () => {
    expect(
      validateHostOrigin(request({ host: "evil.test:4173" }), {
        allowedHostnames: ["127.0.0.1", "localhost"]
      })
    ).toEqual({ ok: false, status: 400, reason: "invalid_host" });
  });

  it("rejects malformed host authority components", () => {
    for (const host of ["user@127.0.0.1:4173", "127.0.0.1:4173/path", "127.0.0.1:4173?x=1"]) {
      expect(
        validateHostOrigin(request({ host }), {
          allowedHostnames: ["127.0.0.1", "localhost"]
        })
      ).toEqual({ ok: false, status: 400, reason: "invalid_host" });
    }
  });

  it("rejects non-localhost origin", () => {
    expect(
      validateHostOrigin(request({ host: "127.0.0.1:4173", origin: "https://evil.test" }), {
        allowedHostnames: ["127.0.0.1", "localhost"]
      })
    ).toEqual({ ok: false, status: 403, reason: "invalid_origin" });
  });

  it("rejects malformed origin authority components", () => {
    for (const origin of ["http://user@127.0.0.1:4173", "http://127.0.0.1:4173/path", "http://127.0.0.1:4173?x=1"]) {
      expect(
        validateHostOrigin(request({ host: "127.0.0.1:4173", origin }), {
          allowedHostnames: ["127.0.0.1", "localhost"]
        })
      ).toEqual({ ok: false, status: 403, reason: "invalid_origin" });
    }
  });

  it("compares implicit and explicit origin ports", () => {
    expect(
      validateHostOrigin(request({ host: "127.0.0.1", origin: "http://127.0.0.1" }), {
        allowedHostnames: ["127.0.0.1", "localhost"]
      })
    ).toEqual({ ok: true });

    expect(
      validateHostOrigin(request({ host: "127.0.0.1:4173", origin: "http://127.0.0.1" }), {
        allowedHostnames: ["127.0.0.1", "localhost"]
      })
    ).toEqual({ ok: false, status: 403, reason: "origin_port_mismatch" });
  });
});
