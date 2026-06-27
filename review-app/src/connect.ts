import { getWalletUniqueIdentifier, type UiWallet } from "@mysten/dapp-kit-core";
import { createLocalDAppKit, hasStoredWalletSelection } from "./dappKitClient.js";
import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import { readPageToken, tokenHeaders } from "./token.js";
import "./connect.css";
import {
  resultForConnectedAccount,
  resultForNoCompatibleWallet,
  resultForWalletError,
  type WalletAccountLike,
  type WalletIdentityResultPayload
} from "./walletStatus.js";
import {
  isTerminalWalletIdentityStatus,
  isWalletIdentityStatus,
  type WalletIdentityStatus
} from "../../src/core/session/walletIdentityStatusContract.js";

const root = document.querySelector<HTMLElement>("#connect-app");

if (!root) {
  throw new Error("connect app root missing");
}
const rootElement = root;

const walletSessionId = rootElement.dataset.walletSessionId ?? "";
const token = readPageToken();

const dAppKit = createLocalDAppKit();

// The server wallet-identity session is the single source of truth for this page.
// Every server call (/opened, /connecting, /result) returns the authoritative
// session - its status and, once connected, the recorded account - so the page
// adopts that returned session and renders from it. The browser dapp-kit
// connection is used only to drive the picker and the wallet popup, never as the
// authoritative state.
type ServerSession = { status: WalletIdentityStatus; account: string | undefined };

// session === undefined means "not fetched yet" (checking the token). pageError
// means a server call failed on this loopback server, which is terminal (wrong or
// expired token, dead session, server error); both stop all wallet controls.
let session: ServerSession | undefined;
let pageError = false;
let isBusy = false;
let lastError: string | undefined;

// Avoid flashing the wallet picker before dapp-kit's autoConnect resolves.
let autoConnectSettling = hasStoredWalletSelection();
if (autoConnectSettling) {
  window.setTimeout(() => {
    autoConnectSettling = false;
    render();
  }, 2000);
}

// Validate the token first; the returned session decides every later state.
if (token) {
  void openSession();
}

dAppKit.stores.$wallets.subscribe(() => render());
dAppKit.stores.$connection.subscribe(() => render());
render();

async function openSession(): Promise<void> {
  try {
    session = await postSession(`/api/wallet/${encodeURIComponent(walletSessionId)}/opened`, {});
  } catch (error) {
    failSession(error, "The local review server did not accept this wallet session.");
  }
  render();
}

// End the page as a terminal recovery state. On a loopback server a failed call
// is terminal (wrong/expired token, dead session, server error), so the page
// stops here rather than retrying.
function failSession(error: unknown, fallback: string): void {
  pageError = true;
  lastError = messageForHttpError(error, fallback);
}

function render(): void {
  const connection = dAppKit.stores.$connection.get();
  const wallets = dAppKit.stores.$wallets.get();

  // Reconcile: while the server session still expects a result and the browser is
  // connected, record the connected account. This single binding path covers both
  // autoConnect (no user pick) and the manual pick. A failed submission sets
  // pageError and a successful one makes the session terminal, so it never
  // re-fires.
  if (!pageError && session && !isTerminalWalletIdentityStatus(session.status) && !isBusy && connection.status === "connected") {
    void recordConnected(connection.account, connection.wallet);
  }

  rootElement.innerHTML = "";
  const section = document.createElement("section");
  section.className = "wallet-shell";

  const heading = document.createElement("h1");
  heading.textContent = "Connect your Sui wallet";
  section.append(heading);

  const copy = document.createElement("p");
  copy.textContent =
    "Connect a Sui mainnet wallet to bind its address as the active account for account-bound review. This page only binds an address; it prepares no transaction and does nothing else.";
  section.append(copy);

  const status = document.createElement("p");
  status.className = "status";
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.textContent = statusText(connection.status);
  section.append(status);

  appendBody(section, connection, wallets);
  rootElement.append(section);
}

function appendBody(
  section: HTMLElement,
  connection: ReturnType<typeof dAppKit.stores.$connection.get>,
  wallets: readonly UiWallet[]
): void {
  if (!token) {
    section.append(errorLine("Missing connect token. Open the connect URL from your AI client again."));
    return;
  }
  if (pageError) {
    section.append(
      errorLine("This connect session is no longer available. Open a fresh connect URL from your AI client.")
    );
    return;
  }
  if (!session) {
    return; // checking the token
  }

  const serverStatus = session.status;
  if (serverStatus === "connected") {
    section.append(successLine(`Connected address: ${session.account ?? "(address unavailable)"}`));
    section.append(plainLine("Return to your AI client to continue. This page only binds the address."));
    return;
  }
  if (serverStatus === "rejected" || serverStatus === "failed") {
    section.append(errorLine("Return to your AI client and request a new connect URL."));
    return;
  }
  if (serverStatus === "expired") {
    section.append(errorLine("This connect session has expired. Open a fresh connect URL from your AI client."));
    return;
  }

  // Non-terminal server session (pending / opened / connecting).
  if (connection.status === "connected" || isBusy) {
    section.append(plainLine("Recording the connection with the local server…"));
  } else if (autoConnectSettling || connection.status === "connecting" || connection.status === "reconnecting") {
    section.append(plainLine("Reconnecting your wallet…"));
  } else if (wallets.length === 0) {
    section.append(errorLine("No compatible Sui wallet was detected in this browser."));
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = isBusy;
    button.textContent = "Report no compatible wallet";
    button.onclick = () => void submitResult(resultForNoCompatibleWallet());
    section.append(button);
  } else {
    const list = document.createElement("div");
    list.className = "wallet-list";
    for (const wallet of wallets) {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = isBusy;
      button.textContent = wallet.name;
      button.onclick = () => void connect(wallet);
      list.append(button);
    }
    section.append(list);
  }
}

// Drive the wallet popup for a manual pick. The success result is recorded by the
// connected-state reconciliation in render(); this path only records failures.
async function connect(wallet: UiWallet): Promise<void> {
  if (isBusy || pageError || !session || isTerminalWalletIdentityStatus(session.status)) return;
  isBusy = true;
  lastError = undefined;
  render();
  try {
    session = await postSession(`/api/wallet/${encodeURIComponent(walletSessionId)}/connecting`, {});
  } catch (error) {
    isBusy = false;
    failSession(error, "The local review server did not accept this wallet session.");
    render();
    return;
  }

  let failure: WalletIdentityResultPayload | undefined;
  try {
    await dAppKit.connectWallet({ wallet });
  } catch (error) {
    failure = resultForWalletError(error, {
      walletName: wallet.name,
      walletId: getWalletUniqueIdentifier(wallet)
    });
  }
  isBusy = false;
  if (failure) {
    await submitResult(failure);
  } else {
    // The $connection store flips to "connected"; render() reconciles and records.
    render();
  }
}

// Record the connected account. resultForConnectedAccount also classifies an
// unsupported chain or missing account as a terminal failure, so the server
// always learns a terminal result.
async function recordConnected(account: WalletAccountLike, wallet: UiWallet | null): Promise<void> {
  const payload = resultForConnectedAccount(
    account,
    wallet ? { walletName: wallet.name, walletId: getWalletUniqueIdentifier(wallet) } : {}
  );
  await submitResult(payload);
}

async function submitResult(payload: WalletIdentityResultPayload): Promise<void> {
  if (isBusy || pageError || !session || isTerminalWalletIdentityStatus(session.status)) return;
  isBusy = true;
  lastError = undefined;
  try {
    session = await postSession(`/api/wallet/${encodeURIComponent(walletSessionId)}/result`, payload);
  } catch (error) {
    failSession(error, "The local review server did not accept this wallet identity result.");
  } finally {
    isBusy = false;
    render();
  }
}

// Post to a wallet lifecycle endpoint and adopt the returned authoritative
// session. The token travels in the header only, never the URL.
async function postSession(path: string, body: Record<string, unknown>): Promise<ServerSession> {
  const response = await fetch(path, {
    method: "POST",
    headers: tokenHeaders(token, { "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
  }
  const data = (await response.json()) as { status?: unknown; account?: unknown };
  // Validate the status against the known contract and fail closed on anything
  // else, so an unexpected status can never be treated as a non-terminal state
  // that renders wallet controls.
  if (!isWalletIdentityStatus(data.status)) {
    throw new HttpJsonRequestError(response.status, "wallet_session_response_invalid");
  }
  return {
    status: data.status,
    account: typeof data.account === "string" ? data.account : undefined
  };
}

function statusText(connectionStatus: string): string {
  if (!token) return "Open the connect URL from your AI client.";
  if (pageError) return lastError ?? "This connect session is no longer available.";
  if (!session) return "Opening the connect session…";
  const serverStatus = session.status;
  if (serverStatus === "connected") return "Wallet address bound. Result recorded by the local server.";
  if (serverStatus === "rejected" || serverStatus === "failed") return "Wallet result recorded by the local server.";
  if (serverStatus === "expired") return "This connect session has expired.";
  if (isBusy || connectionStatus === "connected") return "Recording the connection with the local server.";
  if (connectionStatus === "connecting") return "Finish or cancel the request in your wallet popup.";
  return "Choose a wallet to continue.";
}

function plainLine(text: string): HTMLElement {
  return line("status", text);
}

function successLine(text: string): HTMLElement {
  return line("success", text);
}

function errorLine(text: string): HTMLElement {
  return line("error", text);
}

function line(className: string, text: string): HTMLElement {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = text;
  return element;
}
