import "./settings.css";
import { renderShell } from "./ui/shell.js";
import { button, buttonRow, card, element, feedback, input, note, row } from "./ui/ui.js";
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
// Token page: the shared shell in token mode (no navigation, brand not a link).
const shell = renderShell(rootElement, "token");
const main = shell.main;
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
  const content: HTMLElement[] = [];
  content.push(element("h1", "settings-title", "Say Ur Intent Settings"));
  content.push(
    note(
      "Use this local page to manage wallet read context, local data, and Sui read endpoints. Settings changes do not sign transactions or grant custody."
    )
  );

  if (errorMessage) {
    content.push(feedback("error", errorMessage));
  } else if (message) {
    content.push(feedback("ok", message));
  }

  if (!settingsSessionId || !token) {
    content.push(
      feedback("error", "Missing settings session id or token. Open the settings URL from your AI client again.")
    );
    main.replaceChildren(...content);
    return;
  }

  content.push(
    renderStatusPanel(),
    renderWalletPanel(),
    renderEndpointPanel(),
    renderLocalDataPanel(),
    renderResetPanel()
  );
  main.replaceChildren(...content);
}

function renderStatusPanel(): HTMLElement {
  const panel = card("Status");
  if (!statusPayload) {
    panel.append(note("Loading…"));
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
    note(
      "Clear active account removes only the local read context; it does not disconnect a wallet or revoke onchain permission. To connect a wallet, open the connect link from your AI client; binding happens only on the Connect page."
    )
  );
  panel.append(button("Clear active account", () => void clearActiveAccount(), "secondary"));
  return panel;
}

function renderEndpointPanel(): HTMLElement {
  const panel = card("Sui gRPC endpoint");
  const grpcInput = input({
    type: "url",
    value: statusPayload?.localSettings.suiGrpcUrl.storedValue ?? "",
    placeholder: "https://fullnode.mainnet.sui.io:443"
  });
  grpcInput.maxLength = MAX_SUI_GRPC_URL_LENGTH;
  grpcInput.setAttribute("aria-label", "Sui gRPC endpoint URL");
  panel.append(grpcInput);
  panel.append(
    buttonRow(
      button("Save endpoint", () => void saveEndpoint(grpcInput.value)),
      button("Restore default Sui gRPC URL", () => void restoreDefaultEndpoint(), "secondary")
    )
  );

  const graphqlPanel = card("Sui GraphQL endpoint");
  const graphqlInput = input({
    type: "url",
    value: statusPayload?.localSettings.suiGraphqlUrl.storedValue ?? "",
    placeholder: "https://graphql.mainnet.sui.io/graphql"
  });
  graphqlInput.maxLength = MAX_SUI_GRAPHQL_URL_LENGTH;
  graphqlInput.setAttribute("aria-label", "Sui GraphQL endpoint URL");
  graphqlPanel.append(graphqlInput);
  graphqlPanel.append(
    buttonRow(
      button("Save GraphQL endpoint", () => void saveGraphqlEndpoint(graphqlInput.value)),
      button("Restore default Sui GraphQL URL", () => void restoreDefaultGraphqlEndpoint(), "secondary")
    )
  );

  const wrapper = element("div", "settings-endpoints");
  wrapper.append(panel, graphqlPanel);
  return wrapper;
}

function renderLocalDataPanel(): HTMLElement {
  const panel = card("Local data");
  panel.append(
    note(
      "Export downloads a backup of your local data. Import previews a chosen backup file (shape only); endpoint verification runs when you confirm, and importing replaces current local data and invalidates open review, wallet, and settings pages."
    )
  );

  // The native file input is visually hidden; the styled button opens it, so the
  // import control reads as a button alongside Export. The chosen file is surfaced
  // through the preview feedback below, not the native control.
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "application/json,.json";
  file.className = "settings-file";
  file.setAttribute("aria-label", "Choose a Say Ur Intent backup file to import");
  file.onchange = () => void previewImport(file);

  panel.append(
    buttonRow(
      button("Export local data", () => void exportLocalData()),
      button("Choose backup file…", () => file.click(), "secondary")
    )
  );
  panel.append(file);

  if (importPreview) {
    const defaultInjectionText = importPreview.defaultsInjected.length > 0
      ? ` Missing settings filled with defaults: ${importPreview.defaultsInjected.join(", ")}.`
      : "";
    panel.append(
      feedback(
        "ok",
        `Import preview ready. Incoming accounts: ${importPreview.incomingCounts.accounts}. Active account change: ${importPreview.activeAccountChange}.${defaultInjectionText} Endpoint verification runs before replacement. This import replaces current local data.`
      )
    );
    panel.append(buttonRow(button("Import and replace local data", () => void importLocalData(), "danger")));
  }

  return panel;
}

// Reset is the irreversible wipe, so it lives in its own card, apart from the
// reversible export/import actions, to signal its different severity.
function renderResetPanel(): HTMLElement {
  const panel = card("Danger zone");
  panel.append(
    note(
      "Reset permanently clears all local Say Ur Intent data and invalidates every open review, wallet, and settings page. This cannot be undone."
    )
  );
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
