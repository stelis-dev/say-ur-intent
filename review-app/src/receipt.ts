import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import type {
  PublicChainReceipt,
  PublicChainReceiptBalanceChange,
  PublicChainReceiptEvent,
  PublicChainReceiptGas,
  PublicChainReceiptInput
} from "../../src/core/action/suiChainReceiptReader.js";
import type { SuiChainReceiptPackageCall } from "../../src/core/action/suiChainReceiptEvidence.js";
import { parseReceipt } from "./receiptFacts.js";
import { receiptToMarkdown } from "./receiptMarkdown.js";
import { renderShell } from "./ui/shell.js";
import {
  accordion,
  card,
  copyButton,
  detailItem,
  element,
  feedback,
  footer,
  info,
  mono,
  pageHeader,
  placeholder,
  row,
  searchField,
  skeleton,
  skeletonHint,
  skeletonRow,
  statusBanner
} from "./ui/ui.js";
import { createPtbGraphView } from "./ui/ptbDiagram.js";
import { mistToSui, signedRawToDisplay } from "./format.js";
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
  const success = receipt.effectsStatus.success;
  const wrap = element("div", "receipt-result");

  // Card — overview: status banner + general facts (digest, sender, checked-at).
  const overview = card(t.receipt.facts);
  overview.append(statusBanner(success ? "success" : "failure", success ? t.receipt.success : t.receipt.failure));
  if (!success && receipt.effectsStatus.errorMessage) {
    overview.append(row(t.receipt.error, receipt.effectsStatus.errorMessage));
  }
  overview.append(row(t.receipt.digest, mono(receipt.txDigest)));
  if (receipt.sender) {
    overview.append(row(t.receipt.sender, monoShort(receipt.sender)));
  }
  overview.append(row(t.receipt.checkedAt, receipt.fetchedAt));
  wrap.append(overview);

  // Card — balance changes (signed, in decimals when resolved, up/down tinted).
  const balances = card(t.receipt.balanceChanges);
  if (receipt.balanceChanges.length === 0) {
    balances.append(placeholder(t.receipt.noBalanceChanges));
  } else {
    for (const change of receipt.balanceChanges) {
      balances.append(balanceChangeItem(change, receipt.sender));
    }
  }
  wrap.append(balances);

  // Card — gas (always SUI, known decimals).
  const gasCard = card(t.receipt.gas);
  gasCard.append(gasSection(receipt.gas));
  wrap.append(gasCard);

  // Card — PTB graph (the centerpiece, left-to-right); placeholder when none.
  const graphCard = infoTitleCard(t.receipt.graph, t.receipt.graphTip);
  if (receipt.ptbGraph) {
    const view = createPtbGraphView({
      rendering: t.receipt.graphRendering,
      failed: t.receipt.graphFailed,
      panZoom: true,
      zoomIn: t.receipt.graphZoomIn,
      zoomOut: t.receipt.graphZoomOut,
      center: t.receipt.graphCenter
    });
    const slot = element("div", "receipt-ptb");
    slot.append(view.element);
    graphCard.append(slot);
    view.render(receipt.ptbGraph.mermaid);
  } else {
    graphCard.append(placeholder(t.receipt.noGraph));
  }
  wrap.append(graphCard);

  // Collapsed detail accordions: inputs, Move calls, object changes, events.
  wrap.append(inputsAccordion(receipt.inputs));
  wrap.append(moveCallsAccordion(receipt.packageCalls));
  wrap.append(objectChangesAccordion(receipt.objectTypes));
  wrap.append(eventsAccordion(receipt.events));

  // Copy as Markdown (full values), bottom-right.
  const actions = element("div", "receipt-actions");
  actions.append(copyButton(t.common.copyMarkdown, () => receiptToMarkdown(digest, receipt), t.common.copied));
  wrap.append(actions);
  return wrap;
}

// A card whose title carries an info tooltip (the boundary note, the graph note).
function infoTitleCard(titleText: string, tip: string): HTMLElement {
  const node = card();
  const head = element("h2", "ui-card-head");
  head.append(`${titleText} `, info(tip));
  node.append(head);
  return node;
}

// The single-card shell used for the error state.
function factsCard(body: HTMLElement): HTMLElement {
  const node = card(t.receipt.facts);
  node.append(body);
  return node;
}

function balanceChangeItem(change: PublicChainReceiptBalanceChange, sender: string | undefined): HTMLElement {
  const symbol = change.symbol ?? shortSymbol(change.coinType);
  // The raw amount already carries the sign for a decrease; an increase gets an
  // explicit "+" so direction reads at a glance (with the up/down tint below).
  const magnitude =
    change.decimals !== undefined ? signedRawToDisplay(change.amountRaw, change.decimals) : change.amountRaw;
  const amount = change.direction === "increase" ? `+${magnitude}` : magnitude;
  const metas: Array<{ label?: string; value: string; full?: string }> = [
    { value: shortenCoinType(change.coinType), full: change.coinType }
  ];
  if (change.address !== sender) {
    metas.push({ label: t.receipt.account, value: shortenId(change.address), full: change.address });
  }
  return change.direction === "zero"
    ? detailItem({ title: symbol, trailing: amount, metas })
    : detailItem({ title: symbol, trailing: amount, trailingTone: change.direction === "increase" ? "up" : "down", metas });
}

function gasSection(gas: PublicChainReceiptGas): HTMLElement {
  const wrap = element("div", "receipt-gas");
  wrap.append(row(t.receipt.gasTotal, `${mistToSui(gas.totalMist)} SUI`));
  wrap.append(row(t.receipt.gasComputation, `${mistToSui(gas.computationMist)} SUI`));
  wrap.append(row(t.receipt.gasStorage, `${mistToSui(gas.storageMist)} SUI`));
  wrap.append(row(t.receipt.gasRebate, `${mistToSui(gas.storageRebateMist)} SUI`));
  if (gas.budgetMist !== undefined) {
    wrap.append(row(t.receipt.gasBudget, `${mistToSui(gas.budgetMist)} SUI`));
  }
  if (gas.priceMist !== undefined) {
    wrap.append(row(t.receipt.gasPrice, `${gas.priceMist} MIST`));
  }
  if (gas.paymentObjectId !== undefined) {
    wrap.append(row(t.receipt.gasPayment, monoShort(gas.paymentObjectId)));
  }
  return wrap;
}

function inputsAccordion(inputs: PublicChainReceiptInput[]): HTMLElement {
  const { details, body } = accordion(`${t.receipt.inputs} (${inputs.length})`);
  if (inputs.length === 0) {
    body.append(placeholder(t.receipt.noInputs));
  } else {
    for (const inputEntry of inputs) {
      const metas: Array<{ label?: string; value: string; full?: string }> = [];
      if (inputEntry.objectId) {
        metas.push({ value: shortenId(inputEntry.objectId), full: inputEntry.objectId });
      }
      if (inputEntry.bytes) {
        metas.push({ label: t.receipt.bytes, value: shortenId(inputEntry.bytes), full: inputEntry.bytes });
      }
      body.append(detailItem({ title: t.receipt.inputKinds[inputEntry.kind], metas }));
    }
  }
  return details;
}

function moveCallsAccordion(calls: SuiChainReceiptPackageCall[]): HTMLElement {
  const { details, body } = accordion(`${t.receipt.moveCalls} (${calls.length})`);
  if (calls.length === 0) {
    body.append(placeholder(t.receipt.noMoveCalls));
  } else {
    for (const call of calls) {
      body.append(
        detailItem({ title: moveCallName(call.target), metas: [{ value: shortenCoinType(call.target), full: call.target }] })
      );
    }
  }
  return details;
}

function objectChangesAccordion(objectTypes: Record<string, string>): HTMLElement {
  const entries = Object.entries(objectTypes);
  const { details, body } = accordion(`${t.receipt.objectChanges} (${entries.length})`);
  if (entries.length === 0) {
    body.append(placeholder(t.receipt.noObjectChanges));
  } else {
    for (const [objectId, objectType] of entries) {
      body.append(
        detailItem({
          title: shortTypeName(objectType),
          metas: [
            { label: t.receipt.object, value: shortenId(objectId), full: objectId },
            { value: shortenCoinType(objectType), full: objectType }
          ]
        })
      );
    }
  }
  return details;
}

function eventsAccordion(events: PublicChainReceiptEvent[]): HTMLElement {
  const { details, body } = accordion(`${t.receipt.events} (${events.length})`);
  if (events.length === 0) {
    body.append(placeholder(t.receipt.noEvents));
  } else {
    for (const event of events) {
      body.append(
        detailItem({
          title: moveCallName(event.eventType),
          metas: [{ value: shortenCoinType(event.eventType), full: event.eventType }]
        })
      );
    }
  }
  return details;
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

// Display helpers: derive short, scannable labels for the headline while the full
// value stays available via the meta `title` and the Markdown copy.
function monoShort(value: string): HTMLElement {
  const node = mono(shortenId(value));
  node.title = value;
  return node;
}

function shortenId(value: string): string {
  if (value.startsWith("0x") && value.length > 14) {
    return `0x${value.slice(2, 8)}…${value.slice(-4)}`;
  }
  return value;
}

function shortSymbol(coinType: string): string {
  const parts = coinType.split("::");
  return parts[parts.length - 1] || coinType;
}

function shortTypeName(objectType: string): string {
  const base = objectType.split("<")[0] ?? objectType;
  const parts = base.split("::");
  return parts[parts.length - 1] || objectType;
}

function moveCallName(target: string): string {
  const parts = target.split("::");
  return parts.length >= 2 ? parts.slice(-2).join("::") : target;
}

function shortenCoinType(type: string): string {
  const parts = type.split("::");
  const head = parts[0];
  if (parts.length >= 2 && head && head.startsWith("0x")) {
    return `${shortenId(head)}::${parts.slice(1).join("::")}`;
  }
  return type;
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
