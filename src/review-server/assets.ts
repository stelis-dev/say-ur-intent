import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { sendJson } from "./http.js";

export async function serveReviewAsset(response: ServerResponse, assetsDir: string, requestPath: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  const root = resolve(assetsDir);
  const filePath = resolve(root, decoded);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypeForAsset(filePath),
      // Entry assets keep stable names across rebuilds; never let the browser
      // serve a stale bundle for a loopback dev/review surface.
      "cache-control": "no-store"
    });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: "not_found" });
  }
}

function contentTypeForAsset(filePath: string): string {
  switch (extname(filePath)) {
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

export function defaultReviewAssetsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../review-app");
}
