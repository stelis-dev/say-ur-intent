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
  pools: ChartPool[];
  intervals: DeepbookOfficialIndexerInterval[];
  selectedPoolNames: string[];
  interval: DeepbookOfficialIndexerInterval;
  startInput: string;
  endInput: string;
  limitInput: string;
  poolFilter: string;
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
  const state: AppState = {
    pools: [],
    intervals: ["15m"],
    selectedPoolNames: ["SUI_USDC"],
    interval: "15m",
    startInput: "",
    endInput: "",
    limitInput: "500",
    poolFilter: "",
    loadingPools: true,
    loadingCandles: false,
    message: "Loading official DeepBook USDC pools from the local server.",
    error: "",
    datasets: [],
    lastUpdated: "",
    chart: undefined
  };

  render(rootElement, state);
  try {
    const pools = await requestJson<DeepbookUsdcChartPoolsResponse>("/api/charts/deepbook-usdc/pools");
    if (pools.status !== "ok") {
      state.loadingPools = false;
      state.error = chartStatusText(pools);
      state.message = "";
      render(rootElement, state);
      return;
    }
    state.pools = pools.pools;
    state.intervals = [...pools.intervals];
    state.interval = pools.defaultInterval;
    state.selectedPoolNames = initialSelectedPools(pools.pools);
    state.loadingPools = false;
    state.message = "Official pool list loaded.";
    render(rootElement, state);
    await loadCandles(rootElement, state);
  } catch {
    state.loadingPools = false;
    state.error = "The local server could not load official DeepBook USDC pools.";
    state.message = "";
    render(rootElement, state);
  }
}

async function loadCandles(rootElement: HTMLElement, state: AppState): Promise<void> {
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
    render(rootElement, state);
    return;
  }

  state.loadingCandles = true;
  state.error = "";
  state.message = "Loading selected pools through the local chart API.";
  render(rootElement, state);

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
  render(rootElement, state);
}

function render(rootElement: HTMLElement, state: AppState): void {
  state.chart?.remove();
  state.chart = undefined;

  const shell = element("section", "chart-shell");
  shell.append(renderSidebar(rootElement, state), renderMain(rootElement, state));
  rootElement.replaceChildren(shell);

  const chartContainer = rootElement.querySelector<HTMLElement>("[data-chart-container]");
  const legend = rootElement.querySelector<HTMLElement>("[data-chart-legend]");
  if (chartContainer && legend && state.datasets.length > 0) {
    state.chart = renderChart(chartContainer, legend, state.datasets);
  }
}

function renderSidebar(rootElement: HTMLElement, state: AppState): HTMLElement {
  const sidebar = element("aside", "chart-sidebar");
  sidebar.append(element("h1", undefined, "DeepBook USDC candles"));
  sidebar.append(
    element(
      "p",
      "chart-copy",
      "Read-only DeepBookV3 official Indexer candles quoted in USDC. USDC is a token reference asset here, not fiat USD."
    )
  );

  const poolFilterLabel = label("Filter pools");
  const poolFilter = input("search", state.poolFilter, "SUI, DEEP, WAL...");
  poolFilter.autocomplete = "off";
  poolFilter.oninput = () => {
    state.poolFilter = poolFilter.value;
    render(rootElement, state);
  };
  poolFilterLabel.append(poolFilter);
  sidebar.append(poolFilterLabel);

  const selectedCount = element(
    "p",
    "selected-count",
    `${state.selectedPoolNames.length}/${DEEPBOOK_USDC_CHART_MAX_SELECTED_POOLS} selected`
  );
  sidebar.append(selectedCount);

  const poolList = element("div", "pool-list");
  const pools = filteredPools(state.pools, state.poolFilter);
  if (state.loadingPools) {
    poolList.append(element("p", "status", "Loading official pools..."));
  } else if (pools.length === 0) {
    poolList.append(element("p", "status", "No official USDC pools match the filter."));
  } else {
    for (const pool of pools) {
      const item = document.createElement("label");
      item.className = "pool-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedPoolNames.includes(pool.poolName);
      checkbox.onchange = () => {
        if (checkbox.checked) {
          if (state.selectedPoolNames.length >= DEEPBOOK_USDC_CHART_MAX_SELECTED_POOLS) {
            state.message = `Select at most ${DEEPBOOK_USDC_CHART_MAX_SELECTED_POOLS} pools.`;
            checkbox.checked = false;
            render(rootElement, state);
            return;
          }
          state.selectedPoolNames = [...state.selectedPoolNames, pool.poolName];
        } else {
          const next = state.selectedPoolNames.filter((name) => name !== pool.poolName);
          state.selectedPoolNames = next.length > 0 ? next : [pool.poolName];
        }
        void loadCandles(rootElement, state);
      };
      item.append(checkbox, element("span", undefined, pool.poolName), element("small", undefined, pool.baseAsset.symbol));
      poolList.append(item);
    }
  }
  sidebar.append(poolList);

  sidebar.append(
    element("p", "source-note", "Source: local server reading the DeepBookV3 official Indexer."),
    element("p", "source-note", "TradingView Lightweight Charts is used for rendering."),
    element("p", "source-note", "No wallet, session token, signing, order entry, or route selection is used on this page.")
  );
  return sidebar;
}

function renderMain(rootElement: HTMLElement, state: AppState): HTMLElement {
  const main = element("main", "chart-main");
  const toolbar = element("section", "query-toolbar");

  const intervalLabel = label("Interval");
  const intervalSelect = document.createElement("select");
  for (const interval of state.intervals) {
    const option = document.createElement("option");
    option.value = interval;
    option.textContent = interval;
    option.selected = interval === state.interval;
    intervalSelect.append(option);
  }
  intervalSelect.onchange = () => {
    state.interval = intervalSelect.value as DeepbookOfficialIndexerInterval;
    void loadCandles(rootElement, state);
  };
  intervalLabel.append(intervalSelect);

  const startLabel = label("UTC start");
  const startInput = input("text", state.startInput, "YYYY-MM-DDTHH:mm");
  startInput.oninput = () => {
    state.startInput = startInput.value;
  };
  startLabel.append(startInput);

  const endLabel = label("UTC end");
  const endInput = input("text", state.endInput, "YYYY-MM-DDTHH:mm");
  endInput.oninput = () => {
    state.endInput = endInput.value;
  };
  endLabel.append(endInput);

  const limitLabel = label("Limit");
  const limitInput = input("number", state.limitInput, "500");
  limitInput.min = "1";
  limitInput.max = "10000";
  limitInput.step = "1";
  limitInput.oninput = () => {
    state.limitInput = limitInput.value;
  };
  limitLabel.append(limitInput);

  const reload = button("Reload", () => void loadCandles(rootElement, state));
  toolbar.append(intervalLabel, startLabel, endLabel, limitLabel, reload);

  const shortcuts = element("div", "shortcut-row");
  for (const shortcut of DEEPBOOK_USDC_CHART_SHORTCUTS) {
    shortcuts.append(
      button(shortcut, () => {
        const next = shortcutQuery(shortcut, new Date());
        state.startInput = next.startInput;
        state.endInput = next.endInput;
        state.limitInput = next.limitInput;
        void loadCandles(rootElement, state);
      }, "secondary")
    );
  }

  const header = element("header", "chart-header");
  const primary = primaryDataset(state.datasets);
  const latest = latestCandle(primary?.response);
  header.append(
    element("p", "eyebrow", state.selectedPoolNames.length === 1 ? "Single-pool candle chart" : "Multi-pool close-price panes"),
    element("h2", undefined, state.selectedPoolNames.join(", ") || "No selected pool"),
    element(
      "p",
      "chart-meta",
      [
        `Interval ${state.interval}`,
        `Limit ${state.limitInput || "500"}`,
        `Candles ${totalCandleCount(state.datasets)}`,
        latest ? `Latest close ${latest.close} USDC/${primary?.response.pair.baseAsset.symbol}` : "Latest close unavailable"
      ].join(" | ")
    )
  );

  const status = element("p", state.error ? "status error" : "status", state.error || state.message || "Ready.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const chartWrapper = element("section", "chart-area");
  const legend = element("div", "chart-legend");
  legend.setAttribute("data-chart-legend", "true");
  legend.textContent = legendTextForLatest(state.datasets);
  const chartCanvas = element("div", "chart-canvas");
  chartCanvas.setAttribute("data-chart-container", "true");
  chartWrapper.append(legend, chartCanvas);

  const details = element("section", "chart-details");
  details.append(
    row("Selected pools", state.selectedPoolNames.join(", ") || "none"),
    row("UTC window", currentWindowText(state)),
    row("Returned candles", String(totalCandleCount(state.datasets))),
    row("Last local reload", state.lastUpdated || "not loaded yet"),
    element("p", "source-note", "USDC is a token-denominated reference asset, not fiat USD and not a USDC/USD peg guarantee."),
    element("p", "source-note", "This page shows official DeepBookV3 Indexer candles. It is not a live quote, route recommendation, P&L, tax, cost-basis, or signing tool.")
  );

  main.append(toolbar, shortcuts, header, status, chartWrapper, details);
  return main;
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

  const filled = filledDatasets(datasets);
  if (filled.length === 1) {
    const dataset = filled[0]!;
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
    filled.forEach((dataset, index) => {
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
      legend.textContent = legendTextForMultiPool(filled, typeof param.time === "number" ? param.time : undefined);
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
  const filled = filledDatasets(datasets);
  if (filled.length > 1) {
    return legendTextForMultiPool(filled);
  }
  const primary = primaryDataset(datasets);
  const candle = latestCandle(primary?.response);
  return legendTextForCandle(primary?.poolName ?? "No pool", candle);
}

function legendTextForLatest(datasets: CandleDataset[]): string {
  return legendTextForDatasets(datasets);
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

function filledDatasets(datasets: CandleDataset[]): Array<{ poolName: string; response: CandleOkResponse }> {
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

function row(labelText: string, value: string): HTMLElement {
  const wrapper = element("div", "detail-row");
  wrapper.append(element("span", "detail-label", labelText), element("span", "detail-value", value));
  return wrapper;
}

function label(text: string): HTMLLabelElement {
  const node = document.createElement("label");
  node.className = "field";
  node.append(element("span", undefined, text));
  return node;
}

function input(type: string, value: string, placeholder: string): HTMLInputElement {
  const node = document.createElement("input");
  node.type = type;
  node.value = value;
  node.placeholder = placeholder;
  return node;
}

function button(text: string, onClick: () => void, variant = "primary"): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = variant;
  node.textContent = text;
  node.onclick = onClick;
  return node;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  textContent?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (textContent !== undefined) {
    node.textContent = textContent;
  }
  return node;
}
