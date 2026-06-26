import { describe, expect, it } from "vitest";
import {
  DEEPBOOK_USDC_INDEX_CANONICAL_USDC_COIN_TYPE,
  DEFAULT_DEEPBOOK_USDC_INDEX_BASE_URL,
  DeepbookUsdcIndexSource,
  DeepbookUsdcIndexSourceError,
  deepbookUsdcIndexRegistrySchema,
  deepbookUsdcIndexWeeklyBarsPath,
  deepbookUsdcIndexWeeklyBarsSchema,
  normalizeDeepbookUsdcIndexBaseUrl,
  utcIsoWeekFromDate
} from "../src/core/read/deepbookUsdcIndexSource.js";

const fetchedAt = new Date("2026-06-27T00:00:00.000Z");

describe("DeepbookUsdcIndexSource", () => {
  it("fetches and validates the registry from the deterministic raw path", async () => {
    const requestedUrls: string[] = [];
    const source = new DeepbookUsdcIndexSource({
      fetch: async (url) => {
        requestedUrls.push(String(url));
        return jsonResponse(registryFixture());
      },
      now: () => fetchedAt
    });

    const result = await source.fetchRegistry();

    expect(requestedUrls).toEqual([`${DEFAULT_DEEPBOOK_USDC_INDEX_BASE_URL}/registry/pairs.json`]);
    expect(result.source).toEqual({
      repositoryUrl: "https://github.com/stelis-dev/deepbook-usdc-index",
      baseUrl: DEFAULT_DEEPBOOK_USDC_INDEX_BASE_URL,
      sourceRef: "main",
      path: "registry/pairs.json",
      url: `${DEFAULT_DEEPBOOK_USDC_INDEX_BASE_URL}/registry/pairs.json`,
      fetchedAt: fetchedAt.toISOString()
    });
    expect(result.registry.quoteAsset.coinType).toBe(DEEPBOOK_USDC_INDEX_CANONICAL_USDC_COIN_TYPE);
    expect(result.registry.pairs).toHaveLength(1);
    expect(result.registry.pairs[0]).toMatchObject({
      id: "SUI_USDC",
      enabled: true,
      poolId: "0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407",
      quoteAsset: "USDC",
      priceConvention: "USDC_PER_BASE",
      collection: { barIntervalMinutes: 10 }
    });
  });

  it("accepts observed public generated registry and weekly payload shapes", () => {
    const registry = deepbookUsdcIndexRegistrySchema.parse(observedPublicRegistryFixture());
    expect(registry.pairs.map((pair) => pair.id)).toEqual(["SUI_USDC", "DEEP_USDC", "WAL_USDC", "NS_USDC"]);

    const weekly = deepbookUsdcIndexWeeklyBarsSchema.parse(observedPublicSuiWeeklyBarsFixture());
    expect(weekly).toMatchObject({
      pairId: "SUI_USDC",
      week: { weekYear: 2026, week: 26, timeZone: "UTC" },
      barIntervalMinutes: 10,
      priceConvention: "USDC_PER_BASE"
    });
    expect(weekly.bars).toHaveLength(5);
    expect(weekly.bars.every((bar) => bar.status === "filled")).toBe(true);
  });

  it("computes UTC ISO week paths across year boundaries", () => {
    expect(utcIsoWeekFromDate(new Date("2020-12-31T23:59:59.000Z"))).toEqual({ weekYear: 2020, week: 53 });
    expect(utcIsoWeekFromDate(new Date("2021-01-01T00:00:00.000Z"))).toEqual({ weekYear: 2020, week: 53 });
    expect(utcIsoWeekFromDate(new Date("2021-01-04T00:00:00.000Z"))).toEqual({ weekYear: 2021, week: 1 });
    expect(utcIsoWeekFromDate(new Date("2026-06-26T17:10:00.000Z"))).toEqual({ weekYear: 2026, week: 26 });

    expect(deepbookUsdcIndexWeeklyBarsPath("SUI_USDC", { weekYear: 2026, week: 6 })).toBe(
      "data/SUI_USDC/bars/2026/W06.json"
    );
  });

  it("fetches and validates filled empty and missing weekly bars without directory listing", async () => {
    const requestedUrls: string[] = [];
    const source = new DeepbookUsdcIndexSource({
      fetch: async (url) => {
        requestedUrls.push(String(url));
        return jsonResponse(weeklyBarsFixture());
      },
      now: () => fetchedAt
    });

    const result = await source.fetchWeeklyBars("SUI_USDC", { weekYear: 2026, week: 26 });

    expect(result).toMatchObject({
      status: "found",
      source: {
        path: "data/SUI_USDC/bars/2026/W26.json",
        url: `${DEFAULT_DEEPBOOK_USDC_INDEX_BASE_URL}/data/SUI_USDC/bars/2026/W26.json`,
        fetchedAt: fetchedAt.toISOString()
      }
    });
    if (result.status !== "found") {
      throw new Error("expected found weekly bars");
    }
    expect(result.weeklyBars.bars.map((bar) => bar.status)).toEqual(["filled", "empty", "missing"]);
    expect(requestedUrls).toEqual([`${DEFAULT_DEEPBOOK_USDC_INDEX_BASE_URL}/data/SUI_USDC/bars/2026/W26.json`]);
    expect(requestedUrls.some((url) => url.includes("api.github.com") || url.endsWith("/data/SUI_USDC/bars/2026/"))).toBe(false);
  });

  it("returns an explicit missing file result for absent weekly data", async () => {
    const source = new DeepbookUsdcIndexSource({
      fetch: async () => new Response("not found", { status: 404 }),
      now: () => fetchedAt
    });

    await expect(source.fetchWeeklyBars("SUI_USDC", { weekYear: 2025, week: 1 })).resolves.toEqual({
      status: "missing_file",
      source: {
        repositoryUrl: "https://github.com/stelis-dev/deepbook-usdc-index",
        baseUrl: DEFAULT_DEEPBOOK_USDC_INDEX_BASE_URL,
        sourceRef: "main",
        path: "data/SUI_USDC/bars/2025/W01.json",
        url: `${DEFAULT_DEEPBOOK_USDC_INDEX_BASE_URL}/data/SUI_USDC/bars/2025/W01.json`
      },
      httpStatus: 404
    });
  });

  it("fails closed on invalid registry and weekly payloads", async () => {
    expect(
      deepbookUsdcIndexRegistrySchema.safeParse({
        ...registryFixture(),
        quoteAsset: { ...registryFixture().quoteAsset, coinType: "0x2::fake::USDC" }
      }).success
    ).toBe(false);

    expect(
      deepbookUsdcIndexRegistrySchema.safeParse({
        ...registryFixture(),
        pairs: [
          {
            ...registryFixture().pairs[0],
            baseAsset: { ...registryFixture().pairs[0]!.baseAsset, coinType: "not-a-coin-type" }
          }
        ]
      }).success
    ).toBe(false);

    expect(
      deepbookUsdcIndexWeeklyBarsSchema.safeParse({
        ...weeklyBarsFixture(),
        barIntervalMinutes: 30
      }).success
    ).toBe(false);

    expect(
      deepbookUsdcIndexWeeklyBarsSchema.safeParse({
        ...weeklyBarsFixture(),
        bars: [
          {
            ...weeklyBarsFixture().bars[0],
            signatures: []
          }
        ]
      }).success
    ).toBe(false);
  });

  it("reports source errors for timeout unavailable and invalid base URLs", async () => {
    const timeoutSource = new DeepbookUsdcIndexSource({
      fetch: async () => {
        throw new DOMException("aborted", "AbortError");
      }
    });
    await expect(timeoutSource.fetchRegistry()).rejects.toMatchObject({
      reason: "source_timeout"
    } satisfies Partial<DeepbookUsdcIndexSourceError>);

    const unavailableSource = new DeepbookUsdcIndexSource({
      fetch: async () => {
        throw new Error("dns");
      }
    });
    await expect(unavailableSource.fetchRegistry()).rejects.toMatchObject({
      reason: "source_unavailable"
    } satisfies Partial<DeepbookUsdcIndexSourceError>);

    expect(() => normalizeDeepbookUsdcIndexBaseUrl("http://example.com/index")).toThrow("must use https");
    expect(() => normalizeDeepbookUsdcIndexBaseUrl("https://example.com/index?x=1")).toThrow(
      "must not include credentials"
    );
  });

  it("fails closed when weekly payload identity does not match the requested path", async () => {
    const wrongPair = new DeepbookUsdcIndexSource({
      fetch: async () => jsonResponse({ ...weeklyBarsFixture(), pairId: "DEEP_USDC" })
    });
    await expect(wrongPair.fetchWeeklyBars("SUI_USDC", { weekYear: 2026, week: 26 })).rejects.toMatchObject({
      reason: "invalid_payload",
      details: { expectedPairId: "SUI_USDC", actualPairId: "DEEP_USDC" }
    } satisfies Partial<DeepbookUsdcIndexSourceError>);

    const wrongWeek = new DeepbookUsdcIndexSource({
      fetch: async () => jsonResponse({ ...weeklyBarsFixture(), week: { ...weeklyBarsFixture().week, week: 27 } })
    });
    await expect(wrongWeek.fetchWeeklyBars("SUI_USDC", { weekYear: 2026, week: 26 })).rejects.toMatchObject({
      reason: "invalid_payload",
      details: {
        expectedWeek: { weekYear: 2026, week: 26 },
        actualWeek: { weekYear: 2026, week: 27 }
      }
    } satisfies Partial<DeepbookUsdcIndexSourceError>);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function registryFixture() {
  return {
    schemaVersion: 1,
    network: "sui:mainnet",
    quoteAsset: {
      symbol: "USDC",
      coinType: DEEPBOOK_USDC_INDEX_CANONICAL_USDC_COIN_TYPE,
      decimals: 6,
      disclaimer: "USDC is not fiat USD and this index does not guarantee a USDC/USD peg."
    },
    eventSources: {
      orderInfoPackageIds: ["0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809"],
      orderFilledEventTypes: [
        "0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809::order_info::OrderFilled"
      ]
    },
    pairs: [
      {
        id: "SUI_USDC",
        enabled: true,
        poolId: "0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407",
        baseAsset: {
          symbol: "SUI",
          coinType: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
          decimals: 9
        },
        quoteAsset: "USDC",
        priceConvention: "USDC_PER_BASE",
        collection: {
          barIntervalMinutes: 10,
          rollingRetentionYears: 2
        }
      }
    ]
  };
}

function weeklyBarsFixture() {
  return {
    schemaVersion: 1,
    pairId: "SUI_USDC",
    week: {
      weekYear: 2026,
      week: 26,
      startsAt: "2026-06-22T00:00:00.000Z",
      endsAt: "2026-06-29T00:00:00.000Z",
      timeZone: "UTC"
    },
    barIntervalMinutes: 10,
    priceConvention: "USDC_PER_BASE",
    disclaimer: "USDC is not fiat USD and this index does not guarantee a USDC/USD peg.",
    bars: [
      {
        start: "2026-06-26T16:50:00.000Z",
        end: "2026-06-26T17:00:00.000Z",
        status: "filled",
        eventCount: 257,
        open: "0.69507",
        high: "0.69672",
        low: "0.69287",
        close: "0.69316",
        baseVolumeRaw: "146148100000000",
        quoteVolumeRaw: "101444802158",
        raw: "data/SUI_USDC/raw/2026/W26/2026-06-26T1650Z.jsonl.gz"
      },
      {
        start: "2026-06-26T17:00:00.000Z",
        end: "2026-06-26T17:10:00.000Z",
        status: "empty",
        eventCount: 0,
        open: null,
        high: null,
        low: null,
        close: null,
        baseVolumeRaw: "0",
        quoteVolumeRaw: "0",
        raw: null
      },
      {
        start: "2026-06-26T17:10:00.000Z",
        end: "2026-06-26T17:20:00.000Z",
        status: "missing",
        eventCount: 0,
        open: null,
        high: null,
        low: null,
        close: null,
        baseVolumeRaw: "0",
        quoteVolumeRaw: "0",
        raw: null
      }
    ]
  };
}

function observedPublicRegistryFixture() {
  return {
    schemaVersion: 1,
    network: "sui:mainnet",
    quoteAsset: {
      symbol: "USDC",
      coinType: DEEPBOOK_USDC_INDEX_CANONICAL_USDC_COIN_TYPE,
      decimals: 6,
      disclaimer: "USDC is a token-denominated reference asset in this index. It is not fiat USD and this repository does not guarantee a USDC/USD peg."
    },
    eventSources: {
      orderInfoPackageIds: ["0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809"],
      orderFilledEventTypes: [
        "0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809::order_info::OrderFilled"
      ]
    },
    pairs: [
      {
        id: "SUI_USDC",
        enabled: true,
        poolId: "0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407",
        baseAsset: {
          symbol: "SUI",
          coinType: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
          decimals: 9
        },
        quoteAsset: "USDC",
        priceConvention: "USDC_PER_BASE",
        collection: {
          barIntervalMinutes: 10,
          rollingRetentionYears: 2
        }
      },
      {
        id: "DEEP_USDC",
        enabled: true,
        poolId: "0xf948981b806057580f91622417534f491da5f61aeaf33d0ed8e69fd5691c95ce",
        baseAsset: {
          symbol: "DEEP",
          coinType: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
          decimals: 6
        },
        quoteAsset: "USDC",
        priceConvention: "USDC_PER_BASE",
        collection: {
          barIntervalMinutes: 10,
          rollingRetentionYears: 2
        }
      },
      {
        id: "WAL_USDC",
        enabled: true,
        poolId: "0x56a1c985c1f1123181d6b881714793689321ba24301b3585eec427436eb1c76d",
        baseAsset: {
          symbol: "WAL",
          coinType: "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL",
          decimals: 9
        },
        quoteAsset: "USDC",
        priceConvention: "USDC_PER_BASE",
        collection: {
          barIntervalMinutes: 10,
          rollingRetentionYears: 2
        }
      },
      {
        id: "NS_USDC",
        enabled: true,
        poolId: "0x0c0fdd4008740d81a8a7d4281322aee71a1b62c449eb5b142656753d89ebc060",
        baseAsset: {
          symbol: "NS",
          coinType: "0x5145494a5f5100e3cdbf3d8f919c4b68cf7d2e9ed7318a9fbceccc03c0aa614f::ns::NS",
          decimals: 6
        },
        quoteAsset: "USDC",
        priceConvention: "USDC_PER_BASE",
        collection: {
          barIntervalMinutes: 10,
          rollingRetentionYears: 2
        }
      }
    ]
  };
}

function observedPublicSuiWeeklyBarsFixture() {
  return {
    schemaVersion: 1,
    pairId: "SUI_USDC",
    week: {
      weekYear: 2026,
      week: 26,
      startsAt: "2026-06-22T00:00:00.000Z",
      endsAt: "2026-06-29T00:00:00.000Z",
      timeZone: "UTC"
    },
    barIntervalMinutes: 10,
    priceConvention: "USDC_PER_BASE",
    disclaimer: "USDC is a token-denominated reference asset in this index. It is not fiat USD and this repository does not guarantee a USDC/USD peg.",
    bars: [
      {
        start: "2026-06-26T16:50:00.000Z",
        end: "2026-06-26T17:00:00.000Z",
        status: "filled",
        eventCount: 257,
        open: "0.69507",
        high: "0.69672",
        low: "0.69287",
        close: "0.69316",
        baseVolumeRaw: "146148100000000",
        quoteVolumeRaw: "101444802158",
        raw: "data/SUI_USDC/raw/2026/W26/2026-06-26T1650Z.jsonl.gz"
      },
      {
        start: "2026-06-26T17:00:00.000Z",
        end: "2026-06-26T17:10:00.000Z",
        status: "filled",
        eventCount: 221,
        open: "0.69289",
        high: "0.69609",
        low: "0.69289",
        close: "0.69557",
        baseVolumeRaw: "137067200000000",
        quoteVolumeRaw: "95246163086",
        raw: "data/SUI_USDC/raw/2026/W26/2026-06-26T1700Z.jsonl.gz"
      },
      {
        start: "2026-06-26T17:10:00.000Z",
        end: "2026-06-26T17:20:00.000Z",
        status: "filled",
        eventCount: 297,
        open: "0.69593",
        high: "0.69793",
        low: "0.69506",
        close: "0.69616",
        baseVolumeRaw: "145652700000000",
        quoteVolumeRaw: "101479036478",
        raw: "data/SUI_USDC/raw/2026/W26/2026-06-26T1710Z.jsonl.gz"
      },
      {
        start: "2026-06-26T17:20:00.000Z",
        end: "2026-06-26T17:30:00.000Z",
        status: "filled",
        eventCount: 247,
        open: "0.69604",
        high: "0.69797",
        low: "0.69495",
        close: "0.69734",
        baseVolumeRaw: "124853000000000",
        quoteVolumeRaw: "86921414432",
        raw: "data/SUI_USDC/raw/2026/W26/2026-06-26T1720Z.jsonl.gz"
      },
      {
        start: "2026-06-26T17:30:00.000Z",
        end: "2026-06-26T17:40:00.000Z",
        status: "filled",
        eventCount: 296,
        open: "0.697",
        high: "0.69851",
        low: "0.69394",
        close: "0.69449",
        baseVolumeRaw: "148337800000000",
        quoteVolumeRaw: "103213859498",
        raw: "data/SUI_USDC/raw/2026/W26/2026-06-26T1730Z.jsonl.gz"
      }
    ]
  };
}
