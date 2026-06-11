import { getWalletUniqueIdentifier, type UiWallet } from "@mysten/dapp-kit-core";
import { createLocalDAppKit } from "./dappKitClient.js";
import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import "./analysis.css";
import {
  resultForConnectedAccount,
  resultForNoCompatibleWallet,
  resultForWalletError,
  type WalletIdentityResultPayload
} from "./walletStatus.js";

const root = document.querySelector<HTMLElement>("#analysis-app");

if (!root) {
  throw new Error("analysis app root missing");
}
const rootElement = root;

const walletSessionId = rootElement.dataset.walletSessionId ?? "";
const token = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";

const dAppKit = createLocalDAppKit();

let terminalSubmitted = false;
let isConnecting = false;
let isSubmittingResult = false;
let lastError: string | undefined;

void postLifecycle("opened")
  .then(() => render())
  .catch((error) => {
    lastError = messageForHttpError(error, "The local review server did not accept this wallet session.");
    render();
  });

dAppKit.stores.$wallets.subscribe(() => render());
dAppKit.stores.$connection.subscribe(() => render());

function render(): void {
  const connection = dAppKit.stores.$connection.get();
  const wallets = dAppKit.stores.$wallets.get();
  rootElement.innerHTML = "";
  const section = document.createElement("section");
  section.className = "wallet-shell";

  const heading = document.createElement("h1");
  heading.textContent = "Say Ur Intent Analysis";
  section.append(heading);

  const copy = document.createElement("p");
  copy.textContent =
    "Connect a Sui mainnet wallet to provide the account address used for account-bound checks, then view a wallet asset snapshot and your stored local review records. This page only captures an address and prepares no transaction.";
  section.append(copy);

  const status = document.createElement("p");
  status.className = "status";
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.textContent = statusText();
  section.append(status);

  if (lastError) {
    const recovery = document.createElement("p");
    recovery.className = "error";
    recovery.textContent = "Return to your AI client and request a new wallet identity URL.";
    section.append(recovery);
  }

  if (!token) {
    const missing = document.createElement("p");
    missing.className = "error";
    missing.textContent = "Missing wallet session token. Open the wallet URL from your AI client again.";
    section.append(missing);
  } else if (connection.status === "connected") {
    const connected = document.createElement("p");
    connected.className = "success";
    connected.textContent = `Connected address: ${connection.account.address}`;
    section.append(connected);
    section.append(analysisPanelsContainer());
    void loadAnalysisPanels();
  } else if (wallets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "error";
    empty.textContent = "No compatible Sui wallet was detected in this browser.";
    section.append(empty);
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = isSubmittingResult;
    button.textContent = "Report no compatible wallet";
    button.onclick = () => {
      void submitResult(resultForNoCompatibleWallet())
        .then(() => render())
        .catch((error) => {
          lastError = messageForHttpError(error, "The local review server did not accept this wallet identity result.");
          render();
        });
    };
    section.append(button);
  } else {
    const list = document.createElement("div");
    list.className = "wallet-list";
    for (const wallet of wallets) {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = isConnecting;
      button.textContent = wallet.name;
      button.onclick = () => connect(wallet);
      list.append(button);
    }
    section.append(list);
  }

  rootElement.append(section);
}

async function connect(wallet: UiWallet): Promise<void> {
  if (isConnecting || isSubmittingResult || terminalSubmitted) return;
  isConnecting = true;
  lastError = undefined;
  render();
  try {
    await postLifecycle("connecting");
  } catch (error) {
    lastError = messageForHttpError(error, "The local review server did not accept this wallet session.");
    isConnecting = false;
    render();
    return;
  }

  let payload: WalletIdentityResultPayload;
  try {
    const result = await dAppKit.connectWallet({ wallet });
    const account = result.accounts[0];
    payload = resultForConnectedAccount(account, {
      walletName: wallet.name,
      walletId: getWalletUniqueIdentifier(wallet)
    });
  } catch (error) {
    payload = resultForWalletError(error, {
      walletName: wallet.name,
      walletId: getWalletUniqueIdentifier(wallet)
    });
  }

  try {
    await submitResult(payload);
  } catch (error) {
    lastError = messageForHttpError(error, "The local review server did not accept this wallet identity result.");
  } finally {
    isConnecting = false;
    render();
  }
}

async function submitResult(payload: WalletIdentityResultPayload): Promise<void> {
  if (terminalSubmitted || isSubmittingResult) return;
  isSubmittingResult = true;
  lastError = undefined;
  render();
  try {
    await postJson(`/api/wallet/${encodeURIComponent(walletSessionId)}/result`, payload);
    terminalSubmitted = true;
  } finally {
    isSubmittingResult = false;
  }
}

async function postLifecycle(event: "opened" | "connecting"): Promise<void> {
  if (!token) return;
  await postJson(`/api/wallet/${encodeURIComponent(walletSessionId)}/${event}`, {});
}

async function postJson(path: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-say-ur-intent-token": token
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
  }
}

let panelsRequested = false;
let assetsPayload: Record<string, unknown> | undefined;
let activityPayload: Record<string, unknown> | undefined;
let panelsError: string | undefined;

function analysisPanelsContainer(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "analysis-panels";
  wrapper.append(panel("Wallet asset snapshot", renderAssets()));
  wrapper.append(panel("Local review records", renderActivity()));
  const note = document.createElement("p");
  note.className = "boundary-note";
  note.textContent =
    "These panels show a wallet asset snapshot at its fetched time and stored local review records. They are not P&L, not tax or cost-basis data, not payment readiness, and not signing readiness.";
  wrapper.append(note);
  return wrapper;
}

function panel(title: string, body: HTMLElement): HTMLElement {
  const section = document.createElement("section");
  section.className = "analysis-panel";
  const heading = document.createElement("h2");
  heading.textContent = title;
  section.append(heading);
  section.append(body);
  return section;
}

function renderAssets(): HTMLElement {
  const body = document.createElement("div");
  if (panelsError) {
    body.textContent = panelsError;
    return body;
  }
  if (!assetsPayload) {
    body.textContent = "Loading wallet asset snapshot from the local server.";
    return body;
  }
  const fetchedAt = typeof assetsPayload.fetchedAt === "string" ? assetsPayload.fetchedAt : undefined;
  if (fetchedAt) {
    const stamp = document.createElement("p");
    stamp.textContent = `Checked at ${fetchedAt}`;
    body.append(stamp);
  }
  const balances = Array.isArray(assetsPayload.balances) ? assetsPayload.balances : [];
  if (balances.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No coin balances were returned for this account snapshot.";
    body.append(empty);
    return body;
  }
  const list = document.createElement("ul");
  for (const entry of balances) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const item = document.createElement("li");
    const symbol = typeof row.symbol === "string" ? row.symbol : "(unknown symbol)";
    const display = typeof row.display === "string" ? row.display : undefined;
    const raw = typeof row.raw === "string" ? row.raw : undefined;
    item.textContent = display !== undefined ? `${symbol}: ${display}` : `${symbol}: raw ${raw ?? "unavailable"}`;
    list.append(item);
  }
  body.append(list);
  return body;
}

function renderActivity(): HTMLElement {
  const body = document.createElement("div");
  if (panelsError) {
    body.textContent = panelsError;
    return body;
  }
  if (!activityPayload) {
    body.textContent = "Loading stored local review records from the local server.";
    return body;
  }
  const list = document.createElement("ul");
  for (const [key, value] of Object.entries(activityPayload)) {
    if (typeof value !== "number" && typeof value !== "string") continue;
    const item = document.createElement("li");
    item.textContent = `${key}: ${value}`;
    list.append(item);
  }
  if (list.childElementCount === 0) {
    body.textContent = "No stored local review records were returned.";
    return body;
  }
  body.append(list);
  return body;
}

async function loadAnalysisPanels(): Promise<void> {
  if (panelsRequested) return;
  panelsRequested = true;
  try {
    const [assets, activity] = await Promise.all([
      getJson(`/api/analysis/${encodeURIComponent(walletSessionId)}/assets`),
      getJson(`/api/analysis/${encodeURIComponent(walletSessionId)}/review-activity`)
    ]);
    assetsPayload = assets;
    activityPayload = activity;
  } catch (error) {
    panelsError = messageForHttpError(error, "The local server could not return analysis data for this session.");
  }
  render();
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    headers: { "x-say-ur-intent-token": token }
  });
  if (!response.ok) {
    throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
  }
  return (await response.json()) as Record<string, unknown>;
}

function statusText(): string {
  if (lastError) return lastError;
  if (terminalSubmitted) return "Wallet identity result was sent to the local server.";
  if (isSubmittingResult) return "Sending wallet identity result to the local server.";
  if (isConnecting) return "Finish or cancel the request in your wallet popup.";
  return "Choose a wallet to continue.";
}
