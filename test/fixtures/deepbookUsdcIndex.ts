import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  deepbookUsdcIndexRegistrySchema,
  deepbookUsdcIndexWeeklyBarsSchema,
  type DeepbookUsdcIndexRegistry,
  type DeepbookUsdcIndexWeeklyBars
} from "../../src/core/read/deepbookUsdcIndexSource.js";

export const PUBLIC_DEEPBOOK_USDC_INDEX_FIXTURE_REF = "5213731e096a9e1c3b337fd4438b0d53242a1f43";
export const PUBLIC_DEEPBOOK_USDC_INDEX_REGISTRY_FIXTURE_SHA256 =
  "09c1994fce793ba964a9888a6774c9fd99d1824a7772b21a20eac29c0880b9e6";
export const PUBLIC_DEEPBOOK_USDC_INDEX_SUI_W26_FIXTURE_SHA256 =
  "a632fc6a83332650fbc74fd3fa2a8e3c586a20eb5bbbeb037924a31b958aeb9d";

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
  return readFileSync(new URL("./deepbook-usdc-index/5213731/registry/pairs.json", import.meta.url), "utf8");
}

function publicDeepbookUsdcIndexSuiW26Text(): string {
  return readFileSync(new URL("./deepbook-usdc-index/5213731/data/SUI_USDC/bars/2026/W26.json", import.meta.url), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
