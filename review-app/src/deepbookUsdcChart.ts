import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type LineData,
  type MouseEventParams,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";

import type {
  DeepbookUsdcChartCandlesResponse,
  DeepbookUsdcChartPoolsResponse
} from "../../src/review-server/deepbookUsdcChartApi.js";
import type { DeepbookOfficialIndexerInterval } from "../../src/core/read/deepbookOfficialIndexerSource.js";
import { renderShell } from "./ui/shell.js";
import {
  accordion,
  button,
  card,
  chip,
  element,
  feedback,
  field,
  footer,
  iconButton,
  input,
  modal,
  pageHeader,
  placeholder,
  row,
  sectionTitle,
  select
} from "./ui/ui.js";
import { t } from "./i18n/i18n.js";
import "./deepbookUsdcChart.css";

type PoolsOkResponse = Extract<DeepbookUsdcChartPoolsResponse, { status: "ok" }>;
type ChartPool = PoolsOkResponse["pools"][number];
type CandleOkResponse = Extract<DeepbookUsdcChartCandlesResponse, { status: "ok" }>;
type CandleEmptyResponse = Extract<DeepbookUsdcChartCandlesResponse, { status: "empty_result" }>;
type ChartCandle = CandleOkResponse["candles"][number];
export type CandleDataset = {
  poolName: string;
  response: CandleOkResponse | CandleEmptyResponse;
};

export const DEEPBOOK_USDC_CHART_MAX_SELECTED_POOLS = 5;
export const DEEPBOOK_USDC_CHART_SHORTCUTS = ["Latest 500", "Last 24h", "Last 7d", "Last 30d"] as const;

// Major base-token chips shown up front = the Sui Foundation tokens at the head of
// the curated order (SUI, DEEP, WAL, NS); everything after them — third-party
// tokens such as IKA, plus stable/wrapped pairs that may have no recent trades —
// is reachable through the "…" chip.
const MAJOR_POOL_CHIP_COUNT = 4;

const SETTINGS_GEAR_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

export type DeepbookUsdcChartShortcut = (typeof DEEPBOOK_USDC_CHART_SHORTCUTS)[number];

export type DeepbookUsdcChartQueryState = {
  selectedPoolNames: string[];
  interval: DeepbookOfficialIndexerInterval;
  startInput: string;
  endInput: string;
  limitInput: string;
};

export type DeepbookUsdcChartCandleQuery = {
  poolName: string;
  interval: DeepbookOfficialIndexerInterval;
  startTimeMs?: number | undefined;
  endTimeMs?: number | undefined;
  limit: number;
};

type AppState = {
  main: HTMLElement;
  pools: ChartPool[];
  intervals: DeepbookOfficialIndexerInterval[];
  selectedPoolNames: string[];
  interval: DeepbookOfficialIndexerInterval;
  startInput: string;
  endInput: string;
  limitInput: string;
  poolFilter: string;
  showMore: boolean;
  showAdvanced: boolean;
  settingsOpen: boolean;
  loadingPools: boolean;
  loadingCandles: boolean;
  message: string;
  error: string;
  datasets: CandleDataset[];
  lastUpdated: string;
  chart: IChartApi | undefined;
};

const root = typeof document !== "undefined" ? document.querySelector<HTMLElement>("#deepbook-usdc-chart-app") : null;

if (root) {
  void startDeepbookUsdcChart(root);
}

async function startDeepbookUsdcChart(rootElement: HTMLElement): Promise<void> {
  const shell = renderShell(rootElement, "chart");
  const state: AppState = {
    main: shell.main,
    pools: [],
    intervals: ["15m"],
    selectedPoolNames: ["SUI_USDC"],
    interval: "15m",
    startInput: "",
    endInput: "",
    limitInput: "500",
    poolFilter: "",
    showMore: false,
    showAdvanced: false,
    settingsOpen: false,
    loadingPools: true,
    loadingCandles: false,
    message: t.chart.loadingPools,
    error: "",
    datasets: [],
    lastUpdated: "",
    chart: undefined
  };

  render(state);
  try {
    const pools = await requestJson<DeepbookUsdcChartPoolsResponse>("/api/charts/deepbook-usdc/pools");
    if (pools.status !== "ok") {
      state.loadingPools = false;
      state.error = chartStatusText(pools);
      state.message = "";
      render(state);
      return;
    }
    state.pools = pools.pools;
    state.intervals = [...pools.intervals];
    state.interval = pools.defaultInterval;
    state.selectedPoolNames = initialSelectedPools(pools.pools);
    state.loadingPools = false;
    state.message = "";
    render(state);
    await loadCandles(state);
  } catch {
    state.loadingPools = false;
    state.error = t.chart.errorPools;
    state.message = "";
    render(state);
  }
}

async function loadCandles(state: AppState): Promise<void> {
  let queries: DeepbookUsdcChartCandleQuery[];
  try {
    queries = buildSelectedPoolCandleQueries({
      selectedPoolNames: state.selectedPoolNames,
      interval: state.interval,
      startInput: state.startInput,
      endInput: state.endInput,
      limitInput: state.limitInput
    });
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Invalid chart query.";
    state.message = "";
    state.datasets = [];
    render(state);
    return;
  }

  state.loadingCandles = true;
  state.error = "";
  state.message = "Loading selected pools through the local chart API.";
  render(state);

  const datasets: CandleDataset[] = [];
  const failures: string[] = [];
  for (const query of queries) {
    try {
      const response = await requestJson<DeepbookUsdcChartCandlesResponse>(
        `/api/charts/deepbook-usdc/candles?${buildCandlesSearchParams(query).toString()}`
      );
      if (response.status === "ok" || response.status === "empty_result") {
        datasets.push({ poolName: query.poolName, response });
      } else {
        failures.push(`${query.poolName}: ${chartStatusText(response)}`);
      }
    } catch {
      failures.push(`${query.poolName}: the local chart API did not return candle data.`);
    }
  }

  state.loadingCandles = false;
  state.datasets = datasets;
  state.lastUpdated = new Date().toISOString();
  state.error = failures.join(" ");
  state.message =
    failures.length > 0
      ? "Some selected pools could not be loaded."
      : datasets.length > 0
        ? "Selected pool candles loaded."
        : "No selected pool candles were loaded.";
  render(state);
}

function render(state: AppState): void {
  state.chart?.remove();
  state.chart = undefined;

  const nodes: Node[] = [
    pageHeader({ title: t.chart.title, lede: t.chart.lede, ledeTip: t.chart.ledeTip }),
    pairCard(state),
    chartCard(state),
    footer([t.chart.boundaryUsdc, t.chart.boundaryScope, t.chart.source])
  ];
  if (state.settingsOpen) {
    nodes.push(settingsModal(state));
  }
  state.main.replaceChildren(...nodes);

  const container = state.main.querySelector<HTMLElement>("[data-chart-container]");
  const legend = state.main.querySelector<HTMLElement>("[data-chart-legend]");
  if (container && legend && state.datasets.length > 0) {
    state.chart = renderChart(container, legend, state.datasets);
  }
}

// Pair selector: a row of major base-token chips (each vs USDC, in the curated
// featured-first order) plus a "…" chip that reveals the full searchable list. A
// settings gear in the card title opens the chart settings.
function pairCard(state: AppState): HTMLElement {
  const node = card();
  const head = element("h2", "ui-card-head");
  head.append(element("span", undefined, t.chart.pair));
  head.append(
    iconButton(SETTINGS_GEAR_ICON, t.chart.settings, () => {
      state.settingsOpen = true;
      render(state);
    })
  );
  node.append(head);

  if (state.loadingPools) {
    node.append(placeholder(t.chart.loadingPools));
    return node;
  }

  const chips = element("div", "chart-chip-row");
  for (const pool of majorPools(state)) {
    chips.append(poolChip(state, pool));
  }
  // The "…" chip toggles the full list inline, so the long tail needs no extra
  // button on its own line.
  const moreChip = chip("…", {
    size: "sm",
    selected: state.showMore,
    onClick: () => {
      state.showMore = !state.showMore;
      render(state);
    }
  });
  moreChip.setAttribute("aria-label", t.chart.more);
  moreChip.title = t.chart.more;
  chips.append(moreChip);
  node.append(chips);

  if (state.showMore) {
    node.append(morePanel(state));
  }
  return node;
}

function poolChip(state: AppState, pool: ChartPool): HTMLButtonElement {
  return chip(pool.baseAsset.symbol, {
    selected: state.selectedPoolNames.includes(pool.poolName),
    size: "sm",
    onClick: () => selectPool(state, pool.poolName)
  });
}

// The "…" panel searches the long-tail pools (those not already a major chip),
// updating only the chip row as the user types so the search keeps focus.
function morePanel(state: AppState): HTMLElement {
  const panel = element("div", "chart-more");
  const majorNames = new Set(majorPools(state).map((pool) => pool.poolName));
  const longTail = state.pools.filter((pool) => !majorNames.has(pool.poolName));
  const chipsBox = element("div", "chart-chip-row");
  const renderChips = (): void => {
    const matches = filteredPools(longTail, state.poolFilter);
    if (matches.length === 0) {
      chipsBox.replaceChildren(placeholder(t.chart.noPools));
      return;
    }
    chipsBox.replaceChildren(...matches.map((pool) => poolChip(state, pool)));
  };
  const search = input({ type: "search", value: state.poolFilter, placeholder: t.chart.searchPlaceholder });
  search.spellcheck = false;
  search.addEventListener("input", () => {
    state.poolFilter = search.value;
    renderChips();
  });
  renderChips();
  panel.append(search, chipsBox);
  return panel;
}

// Settings modal: interval, range shortcuts, a custom-range disclosure, and the
// query detail facts. A modal keeps the page balanced (no tall side card).
function settingsModal(state: AppState): HTMLElement {
  const { overlay, body } = modal({
    title: t.chart.settings,
    onClose: () => {
      state.settingsOpen = false;
      render(state);
    }
  });

  body.append(
    field(
      t.chart.interval,
      select({
        value: state.interval,
        choices: state.intervals.map((interval) => ({ value: interval, label: interval })),
        onChange: (value) => {
          state.interval = value as DeepbookOfficialIndexerInterval;
          void loadCandles(state);
        }
      })
    )
  );

  const ranges = element("div", "chart-chip-row");
  for (const shortcut of DEEPBOOK_USDC_CHART_SHORTCUTS) {
    ranges.append(
      button(
        shortcut,
        () => {
          const next = shortcutQuery(shortcut, new Date());
          state.startInput = next.startInput;
          state.endInput = next.endInput;
          state.limitInput = next.limitInput;
          void loadCandles(state);
        },
        "secondary"
      )
    );
  }
  body.append(field(t.chart.range, ranges));

  const advanced = accordion(t.chart.advanced, state.showAdvanced);
  advanced.details.addEventListener("toggle", () => {
    state.showAdvanced = advanced.details.open;
  });
  const startInput = input({ type: "text", value: state.startInput, placeholder: "YYYY-MM-DDTHH:mm" });
  startInput.addEventListener("input", () => {
    state.startInput = startInput.value;
  });
  const endInput = input({ type: "text", value: state.endInput, placeholder: "YYYY-MM-DDTHH:mm" });
  endInput.addEventListener("input", () => {
    state.endInput = endInput.value;
  });
  const limitInput = input({ type: "number", value: state.limitInput, placeholder: "500" });
  limitInput.min = "1";
  limitInput.max = "10000";
  limitInput.step = "1";
  limitInput.addEventListener("input", () => {
    state.limitInput = limitInput.value;
  });
  advanced.body.append(
    field(t.chart.utcStart, startInput),
    field(t.chart.utcEnd, endInput),
    field(t.chart.limit, limitInput),
    button(t.chart.reload, () => void loadCandles(state))
  );
  body.append(advanced.details);

  body.append(sectionTitle(t.chart.details));
  body.append(
    row(t.chart.window, currentWindowText(state)),
    row(t.chart.returnedCandles, String(totalCandleCount(state.datasets))),
    row(t.chart.lastReload, state.lastUpdated || "—")
  );
  return overlay;
}

// Chart card: a minimal header (pair + latest close) over a full-bleed chart area.
function chartCard(state: AppState): HTMLElement {
  const node = card();
  const primary = primaryDataset(state.datasets);
  const latest = latestCandle(primary?.response);

  const head = element("h2", "ui-card-head");
  head.append(element("span", undefined, state.selectedPoolNames.join(", ") || "—"));
  if (latest && primary) {
    head.append(element("span", "chart-close", `${latest.close} USDC/${primary.response.pair.baseAsset.symbol}`));
  }
  node.append(head);

  if (state.error) {
    node.append(feedback("error", state.error));
    return node;
  }
  node.append(chartArea(state));
  return node;
}

function chartArea(state: AppState): HTMLElement {
  const area = element("div", "chart-area");
  if (state.loadingCandles) {
    // While loading, blur the previous chart and cover it with a loading overlay so
    // the stale graph is never shown as if it were the new selection's data.
    area.classList.add("chart-area--loading");
  }
  const legend = element("div", "chart-legend");
  legend.setAttribute("data-chart-legend", "true");
  legend.textContent = legendTextForDatasets(state.datasets);
  area.append(legend);
  if (state.datasets.length > 0) {
    const canvas = element("div", "chart-canvas");
    canvas.setAttribute("data-chart-container", "true");
    area.append(canvas);
  } else if (!state.loadingCandles) {
    area.append(element("div", "chart-empty", t.chart.noCandles));
  }
  if (state.loadingCandles) {
    area.append(element("div", "chart-loading", t.chart.loadingCandles));
  }
  return area;
}

// Single-pool selection: clicking a chip views that token vs USDC. (Compare was
// removed; the chart always shows one pool's candlestick + volume.)
function selectPool(state: AppState, poolName: string): void {
  if (state.selectedPoolNames.length === 1 && state.selectedPoolNames[0] === poolName) {
    return;
  }
  state.selectedPoolNames = [poolName];
  render(state);
  void loadCandles(state);
}

// Major chips are the first pools in the server's curated order (featured Sui
// tokens first). The order is fixed, so a chip never moves when it is selected; the
// long tail is reachable through the "…" chip.
function majorPools(state: AppState): ChartPool[] {
  return state.pools.slice(0, MAJOR_POOL_CHIP_COUNT);
}

function renderChart(container: HTMLElement, legend: HTMLElement, datasets: CandleDataset[]): IChartApi {
  const chart = createChart(container, {
    autoSize: true,
    layout: { background: { color: "#ffffff" }, textColor: "#17211d" },
    grid: { vertLines: { color: "#edf1ee" }, horzLines: { color: "#edf1ee" } },
    rightPriceScale: { borderColor: "#d9e2dc" },
    timeScale: { borderColor: "#d9e2dc", timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 }
  });

  const available = availableDatasets(datasets);
  if (available.length === 1) {
    const dataset = available[0]!;
    const candles = dataset.response.candles.map(candleToCandlestickData);
    const volumes = dataset.response.candles.map(candleToVolumeData);
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#167752",
      downColor: "#b44336",
      borderVisible: false,
      wickUpColor: "#167752",
      wickDownColor: "#b44336",
      priceFormat: { type: "price", precision: 6, minMove: 0.000001 }
    });
    candleSeries.setData(candles);
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#8da39a",
      priceFormat: { type: "volume" },
      priceScaleId: ""
    }, 1);
    volumeSeries.setData(volumes);
    chart.panes()[0]?.setStretchFactor(3);
    chart.panes()[1]?.setStretchFactor(1);
    const byTime = new Map<number, ChartCandle>();
    for (const candle of dataset.response.candles) {
      byTime.set(candleTime(candle), candle);
    }
    chart.subscribeCrosshairMove((param) => {
      legend.textContent = legendTextForCandle(dataset.response.pair.poolName, crosshairCandle(param, byTime) ?? latestCandle(dataset.response));
    });
  } else {
    available.forEach((dataset, index) => {
      const series = chart.addSeries(LineSeries, {
        color: lineColor(index),
        lineWidth: 2,
        priceFormat: { type: "price", precision: 6, minMove: 0.000001 },
        title: dataset.response.pair.poolName
      }, index);
      series.setData(dataset.response.candles.map(candleToLineData));
      chart.panes()[index]?.setStretchFactor(1);
    });
    chart.subscribeCrosshairMove((param) => {
      legend.textContent = legendTextForMultiPool(available, typeof param.time === "number" ? param.time : undefined);
    });
  }
  chart.timeScale().fitContent();
  return chart;
}

function crosshairCandle(param: MouseEventParams<Time>, byTime: Map<number, ChartCandle>): ChartCandle | undefined {
  return typeof param.time === "number" ? byTime.get(param.time) : undefined;
}

export function buildSelectedPoolCandleQueries(input: DeepbookUsdcChartQueryState): DeepbookUsdcChartCandleQuery[] {
  if (input.selectedPoolNames.length === 0) {
    throw new Error("Select at least one official pool.");
  }
  if (input.selectedPoolNames.length > DEEPBOOK_USDC_CHART_MAX_SELECTED_POOLS) {
    throw new Error(`Select at most ${DEEPBOOK_USDC_CHART_MAX_SELECTED_POOLS} pools.`);
  }
  const limit = parseLimitInput(input.limitInput);
  const startTimeMs = parseUtcInputToMs(input.startInput);
  const endTimeMs = parseUtcInputToMs(input.endInput);
  if (startTimeMs !== undefined && endTimeMs !== undefined && startTimeMs >= endTimeMs) {
    throw new Error("UTC start must be before UTC end.");
  }
  return input.selectedPoolNames.map((poolName) => ({
    poolName,
    interval: input.interval,
    ...(startTimeMs !== undefined ? { startTimeMs } : {}),
    ...(endTimeMs !== undefined ? { endTimeMs } : {}),
    limit
  }));
}

export function buildCandlesSearchParams(query: DeepbookUsdcChartCandleQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("poolName", query.poolName);
  params.set("interval", query.interval);
  params.set("limit", query.limit.toString());
  if (query.startTimeMs !== undefined) {
    params.set("startTimeMs", query.startTimeMs.toString());
  }
  if (query.endTimeMs !== undefined) {
    params.set("endTimeMs", query.endTimeMs.toString());
  }
  return params;
}

export function shortcutQuery(
  shortcut: DeepbookUsdcChartShortcut,
  now: Date
): Pick<DeepbookUsdcChartQueryState, "startInput" | "endInput" | "limitInput"> {
  if (shortcut === "Latest 500") {
    return { startInput: "", endInput: "", limitInput: "500" };
  }
  const durationMs =
    shortcut === "Last 24h"
      ? 24 * 60 * 60 * 1000
      : shortcut === "Last 7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  const end = now.getTime();
  const start = end - durationMs;
  return { startInput: utcMsToInputValue(start), endInput: utcMsToInputValue(end), limitInput: "10000" };
}

export function parseUtcInputToMs(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    throw new Error("UTC timestamps must use YYYY-MM-DDTHH:mm.");
  }
  const ms = Date.parse(`${trimmed}:00.000Z`);
  if (!Number.isSafeInteger(ms)) {
    throw new Error("UTC timestamp is invalid.");
  }
  return ms;
}

export function utcMsToInputValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

export function candleToCandlestickData(candle: ChartCandle): CandlestickData<UTCTimestamp> {
  return {
    time: candleTime(candle) as UTCTimestamp,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close)
  };
}

export function candleToLineData(candle: ChartCandle): LineData<UTCTimestamp> {
  return {
    time: candleTime(candle) as UTCTimestamp,
    value: Number(candle.close)
  };
}

export function candleToVolumeData(candle: ChartCandle): HistogramData<UTCTimestamp> {
  return {
    time: candleTime(candle) as UTCTimestamp,
    value: Number(candle.volume),
    color: Number(candle.close) >= Number(candle.open) ? "rgba(22, 119, 82, 0.45)" : "rgba(180, 67, 54, 0.45)"
  };
}

function candleTime(candle: ChartCandle): number {
  return Math.floor(candle.timestampMs / 1000);
}

function parseLimitInput(value: string): number {
  const trimmed = value.trim();
  if (!/^[1-9][0-9]*$/.test(trimmed)) {
    throw new Error("Limit must be an integer from 1 to 10000.");
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed > 10_000) {
    throw new Error("Limit must be an integer from 1 to 10000.");
  }
  return parsed;
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: "GET", headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`local chart API returned HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function initialSelectedPools(pools: ChartPool[]): string[] {
  if (pools.some((pool) => pool.poolName === "SUI_USDC")) {
    return ["SUI_USDC"];
  }
  return pools[0] ? [pools[0].poolName] : [];
}

function filteredPools(pools: ChartPool[], filter: string): ChartPool[] {
  const needle = filter.trim().toUpperCase();
  if (needle === "") {
    return pools;
  }
  return pools.filter((pool) =>
    `${pool.poolName} ${pool.baseAsset.symbol} ${pool.baseAsset.coinType}`.toUpperCase().includes(needle)
  );
}

function chartStatusText(response: DeepbookUsdcChartPoolsResponse | DeepbookUsdcChartCandlesResponse): string {
  switch (response.status) {
    case "source_unavailable":
      return `Official Indexer source unavailable: ${response.reason}.`;
    case "unsupported_input":
      return `Unsupported chart input: ${response.reason}.`;
    case "over_limit":
      return `Requested ${response.requestedLimit} candles; the local chart API limit is ${response.maxCandles}.`;
    case "unsupported_pool":
      return `Unsupported official USDC pool: ${response.query.poolName}.`;
    case "empty_result":
      return `No candles returned for ${response.query.poolName}.`;
    case "ok":
      return "OK";
  }
}

function totalCandleCount(datasets: CandleDataset[]): number {
  return datasets.reduce((sum, dataset) => sum + (dataset.response.status === "ok" ? dataset.response.candleCount : 0), 0);
}

function primaryDataset(datasets: CandleDataset[]): CandleDataset | undefined {
  return datasets[0];
}

function latestCandle(response: CandleDataset["response"] | undefined): ChartCandle | undefined {
  return response?.status === "ok" ? response.candles.at(-1) : undefined;
}

export function legendTextForDatasets(datasets: CandleDataset[]): string {
  const available = availableDatasets(datasets);
  if (available.length > 1) {
    return legendTextForMultiPool(available);
  }
  const primary = primaryDataset(datasets);
  const candle = latestCandle(primary?.response);
  return legendTextForCandle(primary?.poolName ?? "No pool", candle);
}

function legendTextForCandle(poolName: string, candle: ChartCandle | undefined): string {
  if (!candle) {
    return `${poolName}: no candle selected`;
  }
  return `${poolName} ${candle.start} UTC | O ${candle.open} H ${candle.high} L ${candle.low} C ${candle.close} | V ${candle.volume}`;
}

function legendTextForMultiPool(datasets: Array<{ poolName: string; response: CandleOkResponse }>, time?: number): string {
  return datasets
    .map((dataset) => {
      const candle =
        time === undefined
          ? latestCandle(dataset.response)
          : dataset.response.candles.find((candidate) => candleTime(candidate) === time) ?? latestCandle(dataset.response);
      return candle ? `${dataset.poolName} ${candle.start} UTC | C ${candle.close}` : `${dataset.poolName}: no close`;
    })
    .join(" | ");
}

function availableDatasets(datasets: CandleDataset[]): Array<{ poolName: string; response: CandleOkResponse }> {
  return datasets.filter((dataset): dataset is { poolName: string; response: CandleOkResponse } =>
    dataset.response.status === "ok" && dataset.response.candles.length > 0
  );
}

function currentWindowText(state: AppState): string {
  if (state.startInput || state.endInput) {
    return `${state.startInput || "blank"} to ${state.endInput || "blank"} UTC`;
  }
  return `latest official candles for limit ${state.limitInput || "500"}`;
}

function lineColor(index: number): string {
  return ["#1f6feb", "#8957e5", "#bf8700", "#0a7f78", "#cf222e"][index % 5]!;
}
