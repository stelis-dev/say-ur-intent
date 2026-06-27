import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEEPBOOK_ANSWER_USE,
  DEEPBOOK_READ_RESPONSE_UNSUPPORTED,
  DEEPBOOK_SOURCE_OWNER_GROUPS
} from "../src/core/read/deepbookSourceOwners.js";
import {
  deepbookAccountInventoryUserAnswerUse,
  deepbookMidPriceUserAnswerUse,
  deepbookOrderbookUserAnswerUse,
  deepbookQuoteUserAnswerUse,
  deepbookUsdcPriceAtTimeUserAnswerUse,
  deepbookUsdcPriceHistoryUserAnswerUse
} from "../src/core/read/readResponseGuidance.js";

describe("DeepBook source owner contract", () => {
  it("names every current DeepBook source owner group without owning FlowX", () => {
    expect(Object.keys(DEEPBOOK_SOURCE_OWNER_GROUPS).sort()).toEqual([
      "directSuiGrpcAndLocalMaterial",
      "guidanceOnly",
      "localTransactionActivity",
      "officialIndexerRest",
      "pinnedSdkMetadata",
      "sdkSimulation"
    ]);
    expect(DEEPBOOK_SOURCE_OWNER_GROUPS.officialIndexerRest.owns).toEqual(
      expect.arrayContaining(["USDC-quoted candle history", "chart candles"])
    );
    expect(JSON.stringify(DEEPBOOK_SOURCE_OWNER_GROUPS)).not.toMatch(/FlowX/i);
  });

  it("keeps Unit 1 limited to guidance labels and unsupported-use rules", () => {
    const source = readFileSync(join(process.cwd(), "src/core/read/deepbookSourceOwners.ts"), "utf8");

    expect(source).toContain("official_deepbook_usdc_candle_history");
    expect(source).not.toContain("deepbook_v3_official_indexer");
    expect(source).not.toContain("deepbook_v3_sdk_mainnet_package_id");
    expect(source).not.toContain("pinned_deepbook_sdk_when_target_asset_selected");
  });

  it("feeds official candle answer-use labels into read-response guidance", () => {
    expect(deepbookUsdcPriceHistoryUserAnswerUse().canAnswer).toEqual([
      DEEPBOOK_ANSWER_USE.officialUsdcCandleHistory,
      DEEPBOOK_ANSWER_USE.officialCandleAvailabilityForRequestedUtcRange
    ]);
    expect(deepbookUsdcPriceAtTimeUserAnswerUse(true).canAnswer).toEqual([
      DEEPBOOK_ANSWER_USE.officialUsdcCandleForRequestedTime,
      DEEPBOOK_ANSWER_USE.representativeClosePriceForMatchedCandle
    ]);
    expect(deepbookUsdcPriceAtTimeUserAnswerUse(false).canAnswer).toEqual([
      DEEPBOOK_ANSWER_USE.officialUsdcCandleForRequestedTime
    ]);
  });

  it("feeds unsupported-use rules into DeepBook read-response guidance", () => {
    expect(deepbookOrderbookUserAnswerUse().cannotAnswer).toEqual([
      ...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.orderbook
    ]);
    expect(deepbookMidPriceUserAnswerUse().cannotAnswer).toEqual([
      ...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.midPrice
    ]);
    expect(deepbookUsdcPriceHistoryUserAnswerUse().cannotAnswer).toEqual([
      ...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.officialUsdcCandles
    ]);
    expect(deepbookUsdcPriceAtTimeUserAnswerUse(true).cannotAnswer).toEqual([
      ...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.officialUsdcCandles
    ]);
    expect(deepbookQuoteUserAnswerUse("raw").cannotAnswer).toEqual([
      ...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.quote
    ]);
    expect(deepbookAccountInventoryUserAnswerUse("available").cannotAnswer).toEqual(
      expect.arrayContaining([...DEEPBOOK_READ_RESPONSE_UNSUPPORTED.accountInventory])
    );
  });
});
