import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import type { PublicChainReceipt } from "../../src/core/action/suiChainReceiptReader.js";
import { parseReceipt } from "./receiptFacts.js";
import { receiptToMarkdown } from "./receiptMarkdown.js";
import { renderShell } from "./ui/shell.js";
import {
  card,
  copyButton,
  element,
  feedback,
  footer,
  pageHeader,
  searchField,
  skeleton,
  skeletonHint,
  skeletonRow
} from "./ui/ui.js";
import { chainReceiptView } from "./ui/chainReceiptView.js";
import { t } from "./i18n/i18n.js";
import "./receipt.css";

// Public Receipt Analytics: on-chain receipt facts for one transaction digest,
// read through GET /api/receipt?digest=. It takes no token, binds nothing, reads
// only public on-chain data, and never shows review evidence or session data.
// The layout follows the locked v4 design (explorer study + mockups): status
// banner → meta → balance changes (in decimals) → gas → PTB graph (the
// left-to-right centerpiece, placeholder when none) → collapsed accordions
// (inputs, Move calls, object changes, events) → boundary note → Copy as Markdown.
const mount = document.querySelector<HTMLElement>("#receipt-app");
if (!mount) {
  throw new Error("receipt app root missing");
}
const shell = renderShell(mount, "receipt");
const main = shell.main;

// The digest in view. Entered in-page via the search field; no URL parameter.
let viewed = "";
let requestedFor: string | undefined;
let receiptData: PublicChainReceipt | undefined;
let errorText: string | undefined;
let errorCode: string | undefined;

render();

function searchControl(): HTMLElement {
  return searchField({
    value: viewed,
    placeholder: t.receipt.searchPlaceholder,
    ariaLabel: t.receipt.searchLabel,
    onSearch: (value) => {
      const digest = value.trim();
      if (!digest) {
        return;
      }
      viewed = digest;
      render();
      void loadReceipt(digest);
    }
  });
}

function render(): void {
  const loaded = requestedFor === viewed && (receiptData !== undefined || errorText !== undefined);
  // Empty → a prompt to enter a digest; loading → a quiet status; both over a
  // static layout ghost so the page is never blank (and never looks falsely busy).
  const body = !viewed
    ? receiptSkeleton(t.receipt.hint)
    : loaded
      ? receiptResult(viewed)
      : receiptSkeleton(t.receipt.loading);
  main.replaceChildren(
    // Title + description on the left, the digest search on the right.
    pageHeader({ title: t.receipt.title, lede: t.receipt.lede, ledeTip: t.receipt.ledeTip, aside: searchControl() }),
    body,
    // The scope boundary lives in the consistent page footer.
    footer([t.receipt.boundaryTip])
  );
}

function receiptResult(digest: string): HTMLElement {
  // Called only once the receipt has loaded (data or error). The error state
  // renders as a single card; otherwise the full v4 layout below.
  if (errorText || !receiptData) {
    return factsCard(feedback("error", receiptErrorMessage()));
  }

  const receipt = receiptData;
  const wrap = chainReceiptView(receipt);

  // Copy as Markdown (full values), bottom-right — the page's own action.
  const actions = element("div", "receipt-actions");
  actions.append(copyButton(t.common.copyMarkdown, () => receiptToMarkdown(digest, receipt), t.common.copied));
  wrap.append(actions);
  return wrap;
}

// The single-card shell used for the error state.
function factsCard(body: HTMLElement): HTMLElement {
  const node = card(t.receipt.facts);
  node.append(body);
  return node;
}

// A static ghost of the v4 receipt layout, led by a prompt (enter a digest) or a
// loading status. Not animated — the message says what's happening.
function receiptSkeleton(message: string): HTMLElement {
  const wrap = element("div", "receipt-result");
  wrap.append(skeletonHint(message));

  const overview = card();
  overview.append(skeleton({ variant: "title" }), skeletonRow(), skeletonRow(), skeletonRow());
  wrap.append(overview);

  const balances = card();
  balances.append(skeleton({ variant: "title" }), skeletonRow(), skeletonRow());
  wrap.append(balances);

  const gas = card();
  gas.append(skeleton({ variant: "title" }), skeletonRow(), skeletonRow(), skeletonRow());
  wrap.append(gas);

  const graph = card();
  graph.append(skeleton({ variant: "title" }), skeleton({ variant: "block" }));
  wrap.append(graph);

  return wrap;
}

function receiptErrorMessage(): string {
  if (errorCode === "digest_invalid") {
    return t.receipt.errorInvalidDigest;
  }
  if (errorCode === "receipt_not_found") {
    return t.receipt.errorNotFound;
  }
  return errorText ?? t.receipt.errorGeneric;
}

async function loadReceipt(digest: string): Promise<void> {
  if (requestedFor === digest) {
    return;
  }
  requestedFor = digest;
  receiptData = undefined;
  errorText = undefined;
  errorCode = undefined;
  // The skeleton (shown by render while requestedFor has no data yet) is the
  // loading indicator, so no full-page overlay here.
  try {
    const response = await fetch(`/api/receipt?digest=${encodeURIComponent(digest)}`);
    if (!response.ok) {
      throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
    }
    const parsed = parseReceipt(await response.json());
    if (!parsed) {
      // Fail closed: an unexpected shape becomes an error, never a partial or
      // false-negative receipt (e.g. a dropped balance change or a "failure"
      // shown for a successful transaction).
      throw new Error(t.receipt.errorShape);
    }
    receiptData = parsed;
  } catch (error) {
    errorCode = error instanceof HttpJsonRequestError ? error.code : undefined;
    errorText = messageForHttpError(error, t.receipt.errorGeneric);
  }
  render();
}
