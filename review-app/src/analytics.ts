import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import { formatWalletAssetRow } from "./walletAssetRow.js";
import { assetSnapshotToMarkdown } from "./analyticsMarkdown.js";
import { renderShell } from "./ui/shell.js";
import { card, copyButton, element, feedback, h1, info, placeholder, row, searchField, sectionTitle } from "./ui/ui.js";
import { t } from "./i18n/i18n.js";
import "./analytics.css";

const mount = document.querySelector<HTMLElement>("#analytics-app");
if (!mount) {
  throw new Error("analytics app root missing");
}
const shell = renderShell(mount, "analytics");
const main = shell.main;

// The address currently in view. It defaults to the local active account (read
// from the server's shared database) and can be overridden in-page by typing any
// address into the search field. This page takes no token, binds nothing, and
// reads only public on-chain data.
let viewed = "";
let assetsRequestedFor: string | undefined;
let assetsPayload: Record<string, unknown> | undefined;
let assetsError: string | undefined;

render();
void loadDefaultAddress();

// Default to the active account bound in the shared database. When none is bound,
// the field stays empty and waits for an address.
async function loadDefaultAddress(): Promise<void> {
  try {
    const response = await fetch("/api/analytics/active-account");
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
    void loadAssets(viewed);
  }
}

function lede(): HTMLElement {
  const node = element("p", "ui-subtitle");
  node.append(`${t.analytics.lede} `, info(t.analytics.ledeTip));
  return node;
}

function searchBox(): HTMLElement {
  const wrap = element("div", "analytics-search");
  wrap.append(
    searchField({
      value: viewed,
      placeholder: t.analytics.searchPlaceholder,
      ariaLabel: t.analytics.searchLabel,
      onSearch: (value) => {
        const address = value.trim();
        if (!address) {
          return;
        }
        viewed = address;
        render();
        void loadAssets(address);
      }
    })
  );
  return wrap;
}

function render(): void {
  const nodes: Node[] = [h1(t.analytics.title), lede(), searchBox()];
  if (viewed) {
    nodes.push(assetsCard(viewed));
  }
  main.replaceChildren(...nodes);
}

function assetsCard(address: string): HTMLElement {
  const node = card();
  // The card title carries the scope boundary as its tooltip, so no separate
  // boundary line is needed.
  const head = element("h2", "ui-card-title");
  head.append(`${t.analytics.snapshot} `, info(t.analytics.boundaryTip));
  node.append(head);

  if (assetsError && assetsRequestedFor === address) {
    node.append(feedback("error", assetsError));
  } else if (assetsPayload && assetsRequestedFor === address) {
    const fetchedAt = typeof assetsPayload.fetchedAt === "string" ? assetsPayload.fetchedAt : undefined;
    if (fetchedAt) {
      node.append(row(t.analytics.checkedAt, fetchedAt));
    }
    const balances = Array.isArray(assetsPayload.balances) ? assetsPayload.balances : [];
    if (balances.length === 0) {
      node.append(placeholder(t.analytics.noBalances));
    } else {
      node.append(sectionTitle(t.analytics.balances));
      for (const entry of balances) {
        const assetRow = formatWalletAssetRow(entry);
        if (!assetRow) {
          continue;
        }
        node.append(row(assetRow.symbol, assetRow.detail));
      }
    }
    const payload = assetsPayload;
    const actions = element("div", "analytics-actions");
    actions.append(copyButton(t.common.copyMarkdown, () => assetSnapshotToMarkdown(address, payload), t.common.copied));
    node.append(actions);
  }
  return node;
}

async function loadAssets(address: string): Promise<void> {
  if (assetsRequestedFor === address) {
    return;
  }
  assetsRequestedFor = address;
  assetsPayload = undefined;
  assetsError = undefined;
  shell.setBusy(true);
  try {
    const response = await fetch(`/api/analytics/assets?address=${encodeURIComponent(address)}`);
    if (!response.ok) {
      throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
    }
    const raw = (await response.json()) as Record<string, unknown>;
    if (!Array.isArray(raw.balances)) {
      // Fail closed: an unexpected shape becomes an error, not a false-negative
      // "no coin balances" snapshot.
      throw new Error(t.analytics.errorShape);
    }
    assetsPayload = raw;
  } catch (error) {
    assetsError = messageForHttpError(error, t.analytics.errorLoad);
  } finally {
    shell.setBusy(false);
  }
  render();
}
