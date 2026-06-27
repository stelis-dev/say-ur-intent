import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCandlesSearchParams,
  buildSelectedPoolCandleQueries,
  candleToCandlestickData,
  candleToLineData,
  candleToVolumeData,
  DEEPBOOK_USDC_CHART_SHORTCUTS,
  legendTextForDatasets,
  parseUtcInputToMs,
  shortcutQuery,
  type CandleDataset
} from "../review-app/src/deepbookUsdcChart.js";

describe("DeepBook USDC chart page helpers", () => {
  it("builds one local candle API query per selected pool without shortcut names", () => {
    const queries = buildSelectedPoolCandleQueries({
      selectedPoolNames: ["SUI_USDC", "DEEP_USDC"],
      interval: "15m",
      startInput: "2026-06-27T00:00",
      endInput: "2026-06-27T01:00",
      limitInput: "120"
    });

    expect(queries).toEqual([
      {
        poolName: "SUI_USDC",
        interval: "15m",
        startTimeMs: Date.parse("2026-06-27T00:00:00.000Z"),
        endTimeMs: Date.parse("2026-06-27T01:00:00.000Z"),
        limit: 120
      },
      {
        poolName: "DEEP_USDC",
        interval: "15m",
        startTimeMs: Date.parse("2026-06-27T00:00:00.000Z"),
        endTimeMs: Date.parse("2026-06-27T01:00:00.000Z"),
        limit: 120
      }
    ]);
    expect(buildCandlesSearchParams(queries[0]!).toString()).toBe(
      "poolName=SUI_USDC&interval=15m&limit=120&startTimeMs=1782518400000&endTimeMs=1782522000000"
    );
    expect(DEEPBOOK_USDC_CHART_SHORTCUTS).toEqual(["Latest 500", "Last 24h", "Last 7d", "Last 30d"]);
  });

  it("keeps shortcut labels as page-only convenience and produces official query fields", () => {
    const latest = shortcutQuery("Latest 500", new Date("2026-06-27T03:00:00.000Z"));
    expect(latest).toEqual({ startInput: "", endInput: "", limitInput: "500" });

    const day = shortcutQuery("Last 24h", new Date("2026-06-27T03:00:00.000Z"));
    expect(day).toEqual({
      startInput: "2026-06-26T03:00",
      endInput: "2026-06-27T03:00",
      limitInput: "10000"
    });
  });

  it("rejects invalid UTC windows and unsupported selected-pool counts before fetch", () => {
    expect(() => parseUtcInputToMs("2026-06-27 00:00")).toThrow("YYYY-MM-DDTHH:mm");
    expect(() =>
      buildSelectedPoolCandleQueries({
        selectedPoolNames: [],
        interval: "15m",
        startInput: "",
        endInput: "",
        limitInput: "500"
      })
    ).toThrow("at least one");
    expect(() =>
      buildSelectedPoolCandleQueries({
        selectedPoolNames: ["A", "B", "C", "D", "E", "F"],
        interval: "15m",
        startInput: "",
        endInput: "",
        limitInput: "500"
      })
    ).toThrow("at most 5");
    expect(() =>
      buildSelectedPoolCandleQueries({
        selectedPoolNames: ["SUI_USDC"],
        interval: "15m",
        startInput: "2026-06-27T01:00",
        endInput: "2026-06-27T00:00",
        limitInput: "500"
      })
    ).toThrow("before");
  });

  it("maps official candles to candlestick close-line and volume data without synthetic values", () => {
    const candle = {
      timestampMs: 1_782_518_400_000,
      start: "2026-06-27T00:00:00.000Z",
      end: "2026-06-27T00:15:00.000Z",
      open: "0.7001",
      high: "0.7020",
      low: "0.6999",
      close: "0.7010",
      volume: "1200.5"
    };

    expect(candleToCandlestickData(candle)).toEqual({
      time: 1_782_518_400,
      open: 0.7001,
      high: 0.702,
      low: 0.6999,
      close: 0.701
    });
    expect(candleToLineData(candle)).toEqual({ time: 1_782_518_400, value: 0.701 });
    expect(candleToVolumeData(candle)).toMatchObject({ time: 1_782_518_400, value: 1200.5 });
  });

  it("uses close-only legend text for multi-pool line mode", () => {
    const datasets = [
      {
        poolName: "SUI_USDC",
        response: {
          status: "ok",
          candles: [
            {
              timestampMs: 1_782_518_400_000,
              start: "2026-06-27T00:00:00.000Z",
              end: "2026-06-27T00:15:00.000Z",
              open: "0.7001",
              high: "0.7020",
              low: "0.6999",
              close: "0.7010",
              volume: "1200.5"
            }
          ]
        }
      },
      {
        poolName: "DEEP_USDC",
        response: {
          status: "ok",
          candles: [
            {
              timestampMs: 1_782_518_400_000,
              start: "2026-06-27T00:00:00.000Z",
              end: "2026-06-27T00:15:00.000Z",
              open: "0.0180",
              high: "0.0184",
              low: "0.0179",
              close: "0.0182",
              volume: "900"
            }
          ]
        }
      }
    ] as CandleDataset[];

    const legend = legendTextForDatasets(datasets);

    expect(legend).toContain("SUI_USDC 2026-06-27T00:00:00.000Z UTC | C 0.7010");
    expect(legend).toContain("DEEP_USDC 2026-06-27T00:00:00.000Z UTC | C 0.0182");
    expect(legend).not.toContain(" O ");
    expect(legend).not.toContain(" V ");
  });

  it("keeps the browser source same-origin and free of wallet signing account and external Indexer fetches", () => {
    const source = readFileSync(join(process.cwd(), "review-app/src/deepbookUsdcChart.ts"), "utf8");
    expect(source).toContain("/api/charts/deepbook-usdc/pools");
    expect(source).toContain("/api/charts/deepbook-usdc/candles");
    expect(source).not.toContain("deepbook-indexer.mainnet.mystenlabs.com");
    expect(source).not.toContain("@mysten/dapp-kit");
    expect(source).not.toContain("SuiGrpcClient");
    expect(source).not.toContain("transactionBytes");
    expect(source).not.toContain("reviewSessionId");
    expect(source).not.toContain("walletSessionId");
    expect(source).not.toContain("autoRefresh");
    expect(source).not.toContain("setInterval");
  });
});
