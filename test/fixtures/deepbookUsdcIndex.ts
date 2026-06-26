import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  deepbookUsdcIndexRegistrySchema,
  deepbookUsdcIndexWeeklyBarsSchema,
  type DeepbookUsdcIndexRegistry,
  type DeepbookUsdcIndexWeeklyBars
} from "../../src/core/read/deepbookUsdcIndexSource.js";

export const PUBLIC_DEEPBOOK_USDC_INDEX_FIXTURE_REF = "e47af4886ee835e0941e6af8d446a5473a6682a8";
export const PUBLIC_DEEPBOOK_USDC_INDEX_REGISTRY_FIXTURE_SHA256 =
  "47e73d0fe36241065439aff36e2b3905df3bc5e63e3233340c26788845c79c91";
export const PUBLIC_DEEPBOOK_USDC_INDEX_SUI_W26_FIXTURE_SHA256 =
  "16fcf104bcee6bf203b37af3278888e004026e22f5f920c1953d54fe7a6f8440";

export function publicDeepbookUsdcIndexRegistryJson(): unknown {
  return JSON.parse(publicDeepbookUsdcIndexRegistryText()) as unknown;
}

export function publicDeepbookUsdcIndexSuiW26Json(): unknown {
  return JSON.parse(publicDeepbookUsdcIndexSuiW26Text()) as unknown;
}

export function publicDeepbookUsdcIndexRegistryFixture(): DeepbookUsdcIndexRegistry {
  return deepbookUsdcIndexRegistrySchema.parse(publicDeepbookUsdcIndexRegistryJson());
}

export function publicDeepbookUsdcIndexSuiW26Fixture(): DeepbookUsdcIndexWeeklyBars {
  return deepbookUsdcIndexWeeklyBarsSchema.parse(publicDeepbookUsdcIndexSuiW26Json());
}

export function publicDeepbookUsdcIndexRegistryFixtureSha256(): string {
  return sha256(publicDeepbookUsdcIndexRegistryText());
}

export function publicDeepbookUsdcIndexSuiW26FixtureSha256(): string {
  return sha256(publicDeepbookUsdcIndexSuiW26Text());
}

function publicDeepbookUsdcIndexRegistryText(): string {
  return readFileSync(new URL("./deepbook-usdc-index/e47af4886ee835e0941e6af8d446a5473a6682a8/registry/pairs.json", import.meta.url), "utf8");
}

function publicDeepbookUsdcIndexSuiW26Text(): string {
  return readFileSync(new URL("./deepbook-usdc-index/e47af4886ee835e0941e6af8d446a5473a6682a8/data/SUI_USDC/bars/2026/W26.json", import.meta.url), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
