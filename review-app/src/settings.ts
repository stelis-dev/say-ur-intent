import "./settings.css";
import { MAX_SUI_GRAPHQL_URL_LENGTH, MAX_SUI_GRPC_URL_LENGTH } from "../../src/core/suiEndpoint.js";
import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import { readPageToken, tokenHeaders } from "./token.js";

type StatusPayload = {
  server: {
    name: string;
    version: string;
    network: "mainnet";
  };
  localSettings: {
    suiGrpcUrl: {
      storedValue: string;
      effectiveValue: string;
      source: "environment" | "local_db" | "builtin_default";
      pendingStoredValue?: string;
      appliesAfter?: "mcp_server_restart";
    };
    suiGraphqlUrl: {
      storedValue: string;
      effectiveValue: string;
      source: "environment" | "local_db" | "builtin_default";
      pendingStoredValue?: string;
      appliesAfter?: "mcp_server_restart";
    };
  };
  activeAccount?: {
    account: string;
    source: string;
    setAt: string;
  };
  dataCounts: Record<string, number>;
  restartRequired: boolean;
};

type ImportPreview = {
  status: "valid";
  currentCounts: Record<string, number>;
  incomingCounts: Record<string, number>;
  willReplace: true;
  activeAccountChange: "unchanged" | "set" | "cleared";
  restartRequiredAfterImport: true;
  defaultsInjected: Array<"suiGraphqlUrl">;
};

const MAX_IMPORT_FILE_BYTES = 16 * 1024 * 1024;

const root = document.querySelector<HTMLElement>("#settings-app");
if (!root) {
  throw new Error("settings app root missing");
}
const rootElement = root;

const settingsSessionId = rootElement.dataset.settingsSessionId ?? "";
const token = readPageToken();
let statusPayload: StatusPayload | undefined;
let importPayload: unknown | undefined;
let importPreview: ImportPreview | undefined;
let message = "";
let errorMessage = "";

if (settingsSessionId && token) {
  void refresh();
} else {
  render();
}

function render(): void {
  rootElement.innerHTML = "";
  const shell = element("section", "settings-shell");
  shell.append(element("h1", undefined, "Say Ur Intent Settings"));
  shell.append(
    element(
      "p",
      "settings-copy",
      "Use this local page to manage wallet read context, local data, and Sui read endpoints. Settings changes do not sign transactions or grant custody."
    )
  );

  const status = element("p", errorMessage ? "status error" : "status", errorMessage || message || "Ready.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  shell.append(status);

  if (!settingsSessionId || !token) {
    shell.append(element("p", "error", "Missing settings session id or token. Open the settings URL from your AI client again."));
    rootElement.append(shell);
    return;
  }

  shell.append(renderStatusPanel());
  shell.append(renderWalletPanel());
  shell.append(renderEndpointPanel());
  shell.append(renderLocalDataPanel());
  rootElement.append(shell);
}

function renderStatusPanel(): HTMLElement {
  const panel = card("Status");
  if (!statusPayload) {
    panel.append(element("p", undefined, "Loading..."));
    return panel;
  }
  panel.append(row("Server", `${statusPayload.server.name} ${statusPayload.server.version}`));
  panel.append(row("Network", statusPayload.server.network));
  panel.append(row("Endpoint source", statusPayload.localSettings.suiGrpcUrl.source));
  panel.append(row("Effective endpoint", statusPayload.localSettings.suiGrpcUrl.effectiveValue));
  panel.append(row("Stored endpoint", statusPayload.localSettings.suiGrpcUrl.storedValue));
  panel.append(row("GraphQL endpoint source", statusPayload.localSettings.suiGraphqlUrl.source));
  panel.append(row("Effective GraphQL endpoint", statusPayload.localSettings.suiGraphqlUrl.effectiveValue));
  panel.append(row("Stored GraphQL endpoint", statusPayload.localSettings.suiGraphqlUrl.storedValue));
  panel.append(row("Restart required", statusPayload.restartRequired ? "yes" : "no"));
  panel.append(row("Active account", statusPayload.activeAccount?.account ?? "none"));
  panel.append(row("Data counts", Object.entries(statusPayload.dataCounts).map(([key, value]) => `${key}: ${value}`).join(", ")));
  return panel;
}

function renderWalletPanel(): HTMLElement {
  const panel = card("Wallet");
  panel.append(
    element(
      "p",
      undefined,
      "Clear active account removes only the local read context; it does not disconnect a wallet or revoke onchain permission. To connect a wallet, open the connect link from your AI client; binding happens only on the Connect page."
    )
  );
  panel.append(button("Clear active account", () => void clearActiveAccount(), "secondary"));
  return panel;
}

function renderEndpointPanel(): HTMLElement {
  const panel = card("Sui gRPC endpoint");
  const input = document.createElement("input");
  input.type = "url";
  input.value = statusPayload?.localSettings.suiGrpcUrl.storedValue ?? "";
  input.placeholder = "https://fullnode.mainnet.sui.io:443";
  input.autocomplete = "off";
  input.maxLength = MAX_SUI_GRPC_URL_LENGTH;
  panel.append(input);
  panel.append(button("Save endpoint", () => void saveEndpoint(input.value)));
  panel.append(button("Restore default Sui gRPC URL", () => void restoreDefaultEndpoint(), "secondary"));
  const graphqlPanel = card("Sui GraphQL endpoint");
  const graphqlInput = document.createElement("input");
  graphqlInput.type = "url";
  graphqlInput.value = statusPayload?.localSettings.suiGraphqlUrl.storedValue ?? "";
  graphqlInput.placeholder = "https://graphql.mainnet.sui.io/graphql";
  graphqlInput.autocomplete = "off";
  graphqlInput.maxLength = MAX_SUI_GRAPHQL_URL_LENGTH;
  graphqlPanel.append(graphqlInput);
  graphqlPanel.append(button("Save GraphQL endpoint", () => void saveGraphqlEndpoint(graphqlInput.value)));
  graphqlPanel.append(button("Restore default Sui GraphQL URL", () => void restoreDefaultGraphqlEndpoint(), "secondary"));
  const wrapper = element("div");
  wrapper.append(panel, graphqlPanel);
  return wrapper;
}

function renderLocalDataPanel(): HTMLElement {
  const panel = card("Local data");
  panel.append(
      element(
        "p",
        undefined,
        "Reset, import, and export operate on logical local data. Import preview checks the backup shape only; endpoint verification runs when import is confirmed. Reset and import invalidate open review, wallet, and settings pages."
      )
    );
  panel.append(button("Export local data", () => void exportLocalData()));

  const file = document.createElement("input");
  file.type = "file";
  file.accept = "application/json,.json";
  file.onchange = () => void previewImport(file);
  panel.append(file);

  if (importPreview) {
    const defaultInjectionText = importPreview.defaultsInjected.length > 0
      ? ` Missing settings filled with defaults: ${importPreview.defaultsInjected.join(", ")}.`
      : "";
    panel.append(
      element(
        "p",
        "success",
        `Import preview ready. Incoming accounts: ${importPreview.incomingCounts.accounts}. Active account change: ${importPreview.activeAccountChange}.${defaultInjectionText} Endpoint verification runs before replacement. This import replaces current local data.`
      )
    );
    panel.append(button("Import and replace local data", () => void importLocalData(), "danger"));
  }

  panel.append(button("Reset local data", () => void resetLocalData(), "danger"));
  return panel;
}

async function refresh(): Promise<void> {
  try {
    statusPayload = await requestJson<StatusPayload>(`/api/settings/${encodeURIComponent(settingsSessionId)}`, {
      method: "GET"
    });
    errorMessage = "";
  } catch (error) {
    errorMessage = messageForHttpError(error, "The local server did not accept this settings session.");
  }
  render();
}

async function clearActiveAccount(): Promise<void> {
  if (!window.confirm("Clear the local active account read context? This does not disconnect a wallet or revoke onchain permission.")) {
    return;
  }
  await postAction("clear-active-account", "Active account context cleared.");
}

async function saveEndpoint(url: string): Promise<void> {
  if (url.length > MAX_SUI_GRPC_URL_LENGTH) {
    errorMessage = `Sui gRPC endpoint must be ${MAX_SUI_GRPC_URL_LENGTH} characters or fewer.`;
    render();
    return;
  }
  await postAction(
    "sui-grpc-url",
    "Sui gRPC endpoint saved. Restart the MCP server for the stored value to apply.",
    { url },
    "Verifying and saving the Sui gRPC endpoint..."
  );
}

async function restoreDefaultEndpoint(): Promise<void> {
  if (!window.confirm("Restore the built-in default Sui gRPC URL? Restart the MCP server for the restored value to apply.")) {
    return;
  }
  await postAction("sui-grpc-url/restore-default", "Default Sui gRPC URL restored. Restart the MCP server for it to apply.");
}

async function saveGraphqlEndpoint(url: string): Promise<void> {
  if (url.length > MAX_SUI_GRAPHQL_URL_LENGTH) {
    errorMessage = `Sui GraphQL endpoint must be ${MAX_SUI_GRAPHQL_URL_LENGTH} characters or fewer.`;
    render();
    return;
  }
  await postAction(
    "sui-graphql-url",
    "Sui GraphQL endpoint saved. Restart the MCP server for the stored value to apply.",
    { url },
    "Verifying and saving the Sui GraphQL endpoint..."
  );
}

async function restoreDefaultGraphqlEndpoint(): Promise<void> {
  if (!window.confirm("Restore the built-in default Sui GraphQL URL? Restart the MCP server for the restored value to apply.")) {
    return;
  }
  await postAction("sui-graphql-url/restore-default", "Default Sui GraphQL URL restored. Restart the MCP server for it to apply.");
}

async function exportLocalData(): Promise<void> {
  try {
    message = "Preparing local data export...";
    errorMessage = "";
    render();
    const data = await requestJson<unknown>(`/api/settings/${encodeURIComponent(settingsSessionId)}/local-data/export`, {
      method: "GET"
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    const downloadUrl = URL.createObjectURL(blob);
    link.href = downloadUrl;
    link.download = `say-ur-intent-local-data-${new Date().toISOString().replaceAll(":", "-")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    message = "Local data export prepared.";
    errorMessage = "";
  } catch (error) {
    errorMessage = messageForHttpError(error, "Could not export local data.");
  }
  render();
}

async function previewImport(fileInput: HTMLInputElement): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    importPayload = undefined;
    importPreview = undefined;
    errorMessage = `Import file is too large. Maximum size is ${formatBytes(MAX_IMPORT_FILE_BYTES)}.`;
    fileInput.value = "";
    render();
    return;
  }
  try {
    message = "Loading import preview...";
    errorMessage = "";
    render();
    importPayload = JSON.parse(await file.text()) as unknown;
    importPreview = await requestJson<ImportPreview>(
      `/api/settings/${encodeURIComponent(settingsSessionId)}/local-data/import/preview`,
      {
        method: "POST",
        body: JSON.stringify(importPayload)
      }
    );
    message = "Import preview loaded. Endpoint verification will run only if you confirm import.";
    errorMessage = "";
  } catch (error) {
    importPayload = undefined;
    importPreview = undefined;
    fileInput.value = "";
    errorMessage = messageForHttpError(error, "Import preview failed. Check that the file is a Say Ur Intent local data export.");
  }
  render();
}

async function importLocalData(): Promise<void> {
  if (!importPayload) return;
  if (!window.confirm("Import and replace all local data? This invalidates all open review, wallet, and settings pages.")) {
    return;
  }
  try {
    message = "Importing local data...";
    errorMessage = "";
    render();
    await requestJson(`/api/settings/${encodeURIComponent(settingsSessionId)}/local-data/import`, {
      method: "POST",
      body: JSON.stringify(importPayload)
    });
    message = "Local data imported. This settings page is now invalid; create a new settings session to continue.";
    errorMessage = "";
    importPayload = undefined;
    importPreview = undefined;
  } catch (error) {
    errorMessage = messageForHttpError(error, "Could not import local data.");
  }
  render();
}

async function resetLocalData(): Promise<void> {
  if (!window.confirm("Reset all local Say Ur Intent data? This invalidates all open review, wallet, and settings pages.")) {
    return;
  }
  try {
    message = "Resetting local data...";
    errorMessage = "";
    render();
    await requestJson(`/api/settings/${encodeURIComponent(settingsSessionId)}/local-data/reset`, {
      method: "POST",
      body: "{}"
    });
    message = "Local data reset. This settings page is now invalid; create a new settings session to continue.";
    errorMessage = "";
  } catch (error) {
    errorMessage = messageForHttpError(error, "Could not reset local data.");
  }
  render();
}

async function postAction(
  path: string,
  successMessage: string,
  body: Record<string, unknown> = {},
  pendingMessage = "Sending local settings request..."
): Promise<void> {
  try {
    message = pendingMessage;
    errorMessage = "";
    render();
    await requestJson(`/api/settings/${encodeURIComponent(settingsSessionId)}/${path}`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    message = successMessage;
    errorMessage = "";
    await refresh();
  } catch (error) {
    errorMessage = messageForHttpError(error, "The local settings request failed.");
    render();
  }
}

async function requestJson<T = unknown>(path: string, init: RequestInit): Promise<T> {
  const extra = init.body !== undefined ? { "content-type": "application/json" } : undefined;
  const response = await fetch(path, { ...init, headers: tokenHeaders(token, extra) });
  if (!response.ok) {
    throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
  }
  return (await response.json()) as T;
}

function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return Number.isInteger(mib) ? `${mib} MiB` : `${bytes} bytes`;
}

function card(title: string): HTMLElement {
  const panel = element("section", "settings-card");
  panel.append(element("h2", undefined, title));
  return panel;
}

function row(label: string, value: string): HTMLElement {
  const item = element("div", "settings-row");
  item.append(element("span", "settings-label", label));
  item.append(element("span", "settings-value", value));
  return item;
}

function button(label: string, onclick: () => void, variant = "primary"): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = `button ${variant}`;
  control.textContent = label;
  control.onclick = onclick;
  return control;
}

function element(tagName: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
