import { getWalletUniqueIdentifier, type UiWallet } from "@mysten/dapp-kit-core";
import { createLocalDAppKit, getStoredWalletSelection, hasStoredWalletSelection } from "./dappKitClient.js";
import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import { formatWalletAssetRow } from "./walletAssetRow.js";
import "./analytics.css";

const root = document.querySelector<HTMLElement>("#analytics-app");

if (!root) {
  throw new Error("analytics app root missing");
}
const rootElement = root;

type DApp = ReturnType<typeof createLocalDAppKit>;

// `?address` is the explicit public input. When present it always drives the
// read, independent of any wallet connection. This page takes no token, binds
// nothing, and reads only public on-chain data.
const queryAddress = (new URLSearchParams(window.location.search).get("address") ?? "").trim();

// Only the no-address path needs the wallet provider (to read the connected
// wallet's address or offer a reconnect). With an explicit `?address` this is a
// pure public read, so the wallet provider is never created and autoConnect
// never runs.
const dAppKit: DApp | null = queryAddress ? null : createLocalDAppKit();

let isConnecting = false;
let assetsRequestedFor: string | undefined;
let assetsPayload: Record<string, unknown> | undefined;
let assetsError: string | undefined;

// Show a reconnecting placeholder until dapp-kit's autoConnect settles, instead
// of flashing the address input when a stored wallet selection is about to
// reconnect.
let autoConnectSettling = dAppKit ? hasStoredWalletSelection() : false;
if (autoConnectSettling) {
  window.setTimeout(() => {
    autoConnectSettling = false;
    render();
  }, 2000);
}

if (dAppKit) {
  dAppKit.stores.$wallets.subscribe(() => render());
  dAppKit.stores.$connection.subscribe(() => render());
}
render();

function activeAddress(): string {
  if (queryAddress) {
    return queryAddress;
  }
  if (!dAppKit) {
    return "";
  }
  const connection = dAppKit.stores.$connection.get();
  return connection.status === "connected" ? connection.account.address : "";
}

function render(): void {
  const address = activeAddress();
  rootElement.innerHTML = "";
  const section = document.createElement("section");
  section.className = "analytics-shell";

  const heading = document.createElement("h1");
  heading.textContent = "Analytics";
  section.append(heading);

  const copy = document.createElement("p");
  copy.textContent =
    "Public on-chain asset balances for a Sui mainnet address. Enter an address, or reconnect a wallet to read its address. This page takes no token, binds nothing, and reads only public on-chain data.";
  section.append(copy);

  if (address) {
    const current = document.createElement("p");
    current.className = "status";
    current.textContent = `Address: ${address}`;
    section.append(current);
    section.append(assetsPanel(address));
    void loadAssets(address);
  } else {
    section.append(addressForm());
    if (dAppKit) {
      section.append(walletState(dAppKit));
    }
  }

  rootElement.append(section);
}

function addressForm(): HTMLElement {
  const form = document.createElement("form");
  form.className = "address-form";
  const label = document.createElement("label");
  label.textContent = "Sui mainnet address";
  label.htmlFor = "analytics-address";
  form.append(label);
  const input = document.createElement("input");
  input.id = "analytics-address";
  input.type = "text";
  input.name = "address";
  input.placeholder = "0x…";
  input.autocomplete = "off";
  input.spellcheck = false;
  form.append(input);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "View assets";
  // Disabled until an address is entered: with no address (and no connected
  // wallet) there is nothing to view, so the button does not invite a no-op.
  submit.disabled = true;
  input.addEventListener("input", () => {
    submit.disabled = input.value.trim().length === 0;
  });
  form.append(submit);
  form.onsubmit = (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set("address", value);
    // Setting the query reloads the page; on reload `?address` drives the read.
    window.location.search = params.toString();
  };
  return form;
}

function walletState(kit: DApp): HTMLElement {
  const wrap = document.createElement("div");
  const connection = kit.stores.$connection.get();
  if (autoConnectSettling || connection.status === "connecting") {
    const status = document.createElement("p");
    status.className = "status";
    status.textContent = "Reconnecting your wallet…";
    wrap.append(status);
    return wrap;
  }
  // Only offer a reconnect when a wallet selection is stored and that one wallet
  // is present in this browser. There is no wallet picker here: binding happens
  // only on the Connect page.
  const stored = getStoredWalletSelection();
  if (stored) {
    const wallets = kit.stores.$wallets.get();
    const wallet = wallets.find((candidate) => getWalletUniqueIdentifier(candidate) === stored.walletId);
    if (wallet) {
      const note = document.createElement("p");
      note.className = "status";
      note.textContent = "Or reconnect your wallet to read its address.";
      wrap.append(note);
      const reconnect = document.createElement("button");
      reconnect.type = "button";
      reconnect.disabled = isConnecting;
      reconnect.textContent = isConnecting ? "Reconnecting…" : `Reconnect ${wallet.name}`;
      reconnect.onclick = () => void reconnectWallet(kit, wallet);
      wrap.append(reconnect);
    }
  }
  return wrap;
}

async function reconnectWallet(kit: DApp, wallet: UiWallet): Promise<void> {
  if (isConnecting) {
    return;
  }
  isConnecting = true;
  render();
  try {
    await kit.connectWallet({ wallet });
  } catch {
    // Stay on the input; the user can type an address instead.
  } finally {
    isConnecting = false;
    render();
  }
}

function assetsPanel(address: string): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "analytics-panel";
  const heading = document.createElement("h2");
  heading.textContent = "Wallet asset snapshot";
  wrapper.append(heading);
  wrapper.append(renderAssets(address));
  const note = document.createElement("p");
  note.className = "boundary-note";
  note.textContent =
    "This is a public on-chain asset snapshot at its fetched time. It is not P&L, not tax or cost-basis data, not payment readiness, and not signing readiness.";
  wrapper.append(note);
  return wrapper;
}

function renderAssets(address: string): HTMLElement {
  const body = document.createElement("div");
  if (assetsError && assetsRequestedFor === address) {
    body.textContent = assetsError;
    return body;
  }
  if (!assetsPayload || assetsRequestedFor !== address) {
    body.textContent = "Loading the public asset snapshot from the local server.";
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
    const row = formatWalletAssetRow(entry);
    if (!row) continue;
    const item = document.createElement("li");
    item.textContent = `${row.symbol}: ${row.detail}`;
    list.append(item);
  }
  body.append(list);
  return body;
}

async function loadAssets(address: string): Promise<void> {
  if (assetsRequestedFor === address) {
    return;
  }
  assetsRequestedFor = address;
  assetsPayload = undefined;
  assetsError = undefined;
  try {
    const response = await fetch(`/api/analytics/assets?address=${encodeURIComponent(address)}`);
    if (!response.ok) {
      throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
    }
    const raw = (await response.json()) as Record<string, unknown>;
    if (!Array.isArray(raw.balances)) {
      // Fail closed: an unexpected shape becomes an error, not a false-negative
      // "no coin balances" snapshot.
      throw new Error("The local server returned an unexpected asset snapshot shape.");
    }
    assetsPayload = raw;
  } catch (error) {
    assetsError = messageForHttpError(error, "The local server could not return public asset data for this address.");
  }
  render();
}
