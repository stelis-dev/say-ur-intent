import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import { formatWalletAssetRow, type WalletAssetRow } from "./walletAssetRow.js";
import { accountSnapshotToMarkdown } from "./accountMarkdown.js";
import { asRecord } from "./parse.js";
import { renderShell } from "./ui/shell.js";
import { accordion, card, copyButton, element, feedback, footer, info, mono, pageHeader, placeholder, row, searchField, skeletonHint, skeletonRow } from "./ui/ui.js";
import { qualifiedName } from "./format.js";
import { t } from "./i18n/i18n.js";
import "./account.css";

const mount = document.querySelector<HTMLElement>("#account-app");
if (!mount) {
  throw new Error("account app root missing");
}
const shell = renderShell(mount, "account");
const main = shell.main;

// The address currently in view. It defaults to the local active account (read
// from the server's shared database) and can be overridden in-page by typing any
// address into the search field. This page takes no token, binds nothing, and
// reads only public on-chain data.
let viewed = "";
let inventoryRequestedFor: string | undefined;
let inventoryPayload: Record<string, unknown> | undefined;
let inventoryError: string | undefined;

render();
void loadDefaultAddress();

// Default to the active account bound in the shared database. When none is bound,
// the field stays empty and waits for an address.
async function loadDefaultAddress(): Promise<void> {
  try {
    const response = await fetch("/api/account/active-account");
    if (response.ok) {
      const body = (await response.json()) as { address?: unknown };
      if (typeof body.address === "string" && body.address.length > 0) {
        viewed = body.address;
      }
    }
  } catch {
    // Leave the field empty; the user can type an address.
  }
  render();
  if (viewed) {
    void loadInventory(viewed);
  }
}

function searchControl(): HTMLElement {
  return searchField({
    value: viewed,
    placeholder: t.account.searchPlaceholder,
    ariaLabel: t.account.searchLabel,
    onSearch: (value) => {
      const address = value.trim();
      if (!address) {
        return;
      }
      viewed = address;
      render();
      void loadInventory(address);
    }
  });
}

function render(): void {
  const loaded = inventoryRequestedFor === viewed && (inventoryPayload !== undefined || inventoryError !== undefined);
  const header = pageHeader({ title: t.account.title, lede: t.account.lede, ledeTip: t.account.ledeTip, aside: searchControl() });
  const foot = footer([t.account.boundaryTip]);

  if (!viewed) {
    main.replaceChildren(header, accountSkeleton(t.account.hint), foot);
    return;
  }
  if (!loaded) {
    main.replaceChildren(header, accountSkeleton(t.account.loading), foot);
    return;
  }
  if (inventoryError !== undefined && inventoryRequestedFor === viewed) {
    const errorCard = card();
    errorCard.append(feedback("error", inventoryError));
    main.replaceChildren(header, errorCard, foot);
    return;
  }

  const payload = inventoryPayload ?? {};
  main.replaceChildren(
    header,
    identityCard(viewed, payload),
    balanceCard(payload),
    nftCard(payload),
    objectsCard(payload),
    actionsRow(viewed, payload),
    foot
  );
}

// A static ghost card, led by a prompt (enter an address) or a loading status.
// Not animated — the message says what's happening.
function accountSkeleton(message: string): HTMLElement {
  const node = card();
  node.append(skeletonHint(message), skeletonRow(), skeletonRow(), skeletonRow());
  return node;
}

// Card 1: the account's SuiNS name (or none) and its address.
function identityCard(address: string, payload: Record<string, unknown>): HTMLElement {
  const node = card(t.account.identity);
  const name = typeof payload.name === "string" && payload.name.length > 0 ? payload.name : undefined;
  node.append(row(t.account.name, name ?? t.account.noName));
  node.append(row(t.account.address, mono(address)));
  const fetchedAt = typeof payload.fetchedAt === "string" ? payload.fetchedAt : undefined;
  if (fetchedAt) {
    node.append(row(t.account.checkedAt, fetchedAt));
  }
  return node;
}

// Card 2: coin balances, each with the held-as split on a hover tooltip.
function balanceCard(payload: Record<string, unknown>): HTMLElement {
  const node = card(t.account.balances);
  const balances = Array.isArray(payload.balances) ? payload.balances : [];
  if (balances.length === 0) {
    node.append(placeholder(t.account.noBalances));
    return node;
  }
  for (const entry of balances) {
    const assetRow = formatWalletAssetRow(entry);
    if (assetRow) {
      node.append(assetBreakdownRow(assetRow));
    }
  }
  return node;
}

// Card 3: owned NFTs (objects with a Display name/image) as an image grid. Images
// load directly from their external host (page CSP allows external https), with a
// no-referrer policy so only the image bytes are requested.
function nftCard(payload: Record<string, unknown>): HTMLElement {
  const node = card(t.account.nfts);
  const nfts = Array.isArray(payload.nfts) ? payload.nfts : [];
  if (nfts.length === 0) {
    node.append(placeholder(t.account.noNfts));
    return node;
  }
  const grid = element("div", "account-nfts");
  for (const raw of nfts) {
    const nft = asRecord(raw);
    if (nft) {
      grid.append(nftTile(nft));
    }
  }
  node.append(grid);
  return node;
}

function nftTile(nft: Record<string, unknown>): HTMLElement {
  const type = typeof nft.type === "string" ? nft.type : "";
  const name = typeof nft.name === "string" && nft.name.length > 0 ? nft.name : qualifiedName(type);
  const imageUrl = typeof nft.imageUrl === "string" && nft.imageUrl.length > 0 ? imageSrc(nft.imageUrl) : undefined;
  const tile = element("div", "account-nft");
  if (imageUrl) {
    const img = document.createElement("img");
    img.className = "account-nft-img";
    img.src = imageUrl;
    img.alt = name;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    // A failed external image is replaced with a "No image" box rather than the
    // browser's broken-image glyph.
    img.addEventListener("error", () => {
      img.replaceWith(element("div", "account-nft-img account-nft-noimg", t.account.noImage));
    });
    tile.append(img);
  } else {
    tile.append(element("div", "account-nft-img account-nft-noimg", t.account.noImage));
  }
  tile.append(element("span", "account-nft-name", name));
  return tile;
}

// Card 4: other owned objects (non-coin, no Display), grouped by Move type.
// Collapsed by default — the list can be long (one row per distinct type), so it
// slides open from a summary that shows the group count.
function objectsCard(payload: Record<string, unknown>): HTMLElement {
  const groups = Array.isArray(payload.objectGroups) ? payload.objectGroups : [];
  const { details, body } = accordion(`${t.account.objects} (${groups.length})`);
  if (groups.length === 0) {
    body.append(placeholder(t.account.noObjects));
  } else {
    for (const raw of groups) {
      const group = asRecord(raw);
      if (!group) {
        continue;
      }
      const type = typeof group.type === "string" ? group.type : "";
      const count = typeof group.count === "number" ? group.count : 0;
      body.append(row(qualifiedName(type), `×${count}`));
    }
  }
  if (payload.objectsTruncated === true) {
    body.append(placeholder(t.account.objectsTruncated));
  }
  return details;
}

function actionsRow(address: string, payload: Record<string, unknown>): HTMLElement {
  const actions = element("div", "account-actions");
  actions.append(copyButton(t.common.copyMarkdown, () => accountSnapshotToMarkdown(address, payload), t.common.copied));
  return actions;
}

// One coin's holdings as a list item: symbol → total, with the held-as split
// (object vs account balance) on a hover tooltip after the total.
function assetBreakdownRow(assetRow: WalletAssetRow): HTMLElement {
  const node = element("div", "account-asset");
  node.append(element("span", "account-asset-symbol", assetRow.symbol));
  const total = element("span", "account-asset-total");
  total.append(assetRow.total);
  if (assetRow.object !== undefined || assetRow.account !== undefined) {
    total.append(
      " ",
      info(`${t.account.heldObject} ${assetRow.object ?? "0"} · ${t.account.heldAccount} ${assetRow.account ?? "0"}`)
    );
  }
  node.append(total);
  return node;
}

// NFT image hosts vary; ipfs:// URLs are rewritten to a public gateway so the
// browser (which has no ipfs scheme handler) can still load them over https.
function imageSrc(url: string): string {
  return url.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${url.slice("ipfs://".length)}` : url;
}

async function loadInventory(address: string): Promise<void> {
  if (inventoryRequestedFor === address) {
    return;
  }
  inventoryRequestedFor = address;
  inventoryPayload = undefined;
  inventoryError = undefined;
  // The skeleton (shown by render while this address has no data yet) is the
  // loading indicator, so no full-page overlay here.
  try {
    const response = await fetch(`/api/account/assets?address=${encodeURIComponent(address)}`);
    if (!response.ok) {
      throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
    }
    const raw = (await response.json()) as Record<string, unknown>;
    if (!Array.isArray(raw.balances)) {
      // Fail closed: an unexpected shape becomes an error, not a false-negative
      // empty snapshot.
      throw new Error(t.account.errorShape);
    }
    inventoryPayload = raw;
  } catch (error) {
    inventoryError = messageForHttpError(error, t.account.errorLoad);
  }
  render();
}
