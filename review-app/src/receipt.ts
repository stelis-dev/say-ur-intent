import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import type { PublicChainReceipt } from "../../src/core/action/suiChainReceiptReader.js";
import { parseReceipt } from "./receiptFacts.js";
import { receiptToMarkdown } from "./receiptMarkdown.js";
import { copyToClipboard } from "./ui/ui.js";
import { t } from "./i18n/i18n.js";
import "./receipt.css";

// Public Receipt Analytics: on-chain receipt facts for one transaction digest,
// read through GET /api/receipt?digest=. It takes no token, binds nothing, reads
// only public on-chain data, and never shows review evidence or session data.
const root = document.querySelector<HTMLElement>("#receipt-app");

if (!root) {
  throw new Error("receipt app root missing");
}
const rootElement = root;

const queryDigest = (new URLSearchParams(window.location.search).get("digest") ?? "").trim();

let requestedFor: string | undefined;
let receiptData: PublicChainReceipt | undefined;
let errorText: string | undefined;
let errorCode: string | undefined;

render();

function render(): void {
  rootElement.innerHTML = "";
  const section = document.createElement("section");
  section.className = "receipt-shell";

  const heading = document.createElement("h1");
  heading.textContent = "Receipt Analytics";
  section.append(heading);

  const copy = document.createElement("p");
  copy.textContent =
    "On-chain receipt facts for a Sui mainnet transaction digest. Enter a digest to view its execution status, balance changes, object changes, and effects. This page takes no token and reads only public on-chain data.";
  section.append(copy);

  if (!queryDigest) {
    section.append(digestForm());
    rootElement.append(section);
    return;
  }

  const current = document.createElement("p");
  current.className = "status";
  current.textContent = `Digest: ${queryDigest}`;
  section.append(current);
  section.append(receiptPanel());
  void loadReceipt(queryDigest);

  rootElement.append(section);
}

function digestForm(): HTMLElement {
  const form = document.createElement("form");
  form.className = "digest-form";
  const label = document.createElement("label");
  label.textContent = "Sui transaction digest";
  label.htmlFor = "receipt-digest";
  form.append(label);
  const input = document.createElement("input");
  input.id = "receipt-digest";
  input.type = "text";
  input.name = "digest";
  input.placeholder = "transaction digest";
  input.autocomplete = "off";
  input.spellcheck = false;
  form.append(input);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "View receipt";
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
    params.set("digest", value);
    window.location.search = params.toString();
  };
  return form;
}

function receiptPanel(): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "receipt-panel";
  wrapper.append(renderReceipt());
  if (receiptData && requestedFor === queryDigest) {
    wrapper.append(copyMarkdownButton(receiptData));
  }
  const note = document.createElement("p");
  note.className = "boundary-note";
  note.textContent =
    "These are public on-chain receipt facts only. They are not review evidence, not a safety verdict, not P&L, and not payment readiness.";
  wrapper.append(note);
  return wrapper;
}

function copyMarkdownButton(receipt: PublicChainReceipt): HTMLElement {
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "copy-markdown";
  copy.textContent = t.common.copyMarkdown;
  copy.addEventListener("click", () =>
    copyToClipboard(copy, () => receiptToMarkdown(queryDigest, receipt), t.common.copied)
  );
  return copy;
}

function renderReceipt(): HTMLElement {
  const body = document.createElement("div");
  if (requestedFor !== queryDigest || (!receiptData && !errorText)) {
    body.textContent = "Loading the on-chain receipt from the local server.";
    return body;
  }
  if (errorText || !receiptData) {
    body.append(line("error", receiptErrorMessage()));
    return body;
  }
  const receipt = receiptData;
  const effectsStatus = receipt.effectsStatus;
  body.append(line("status", `Execution status: ${effectsStatus.success ? "success" : "failure"}`));
  if (!effectsStatus.success && effectsStatus.errorMessage) {
    body.append(line(undefined, `Error: ${effectsStatus.errorMessage}`));
  }
  if (receipt.sender) {
    body.append(line(undefined, `Sender: ${receipt.sender}`));
  }
  body.append(subheading("Balance changes"));
  body.append(balanceList(receipt.balanceChanges));
  body.append(subheading("Move calls"));
  body.append(packageCallList(receipt.packageCalls));
  body.append(subheading("Object changes"));
  body.append(objectTypeList(receipt.objectTypes));
  return body;
}

function balanceList(changes: PublicChainReceipt["balanceChanges"]): HTMLElement {
  const list = document.createElement("ul");
  for (const change of changes) {
    const item = document.createElement("li");
    item.textContent = `${change.address}: ${change.amountRaw} ${change.coinType}`;
    list.append(item);
  }
  if (list.childElementCount === 0) {
    return line(undefined, "No balance changes were recorded.");
  }
  return list;
}

function packageCallList(calls: PublicChainReceipt["packageCalls"]): HTMLElement {
  const list = document.createElement("ul");
  for (const call of calls) {
    const item = document.createElement("li");
    item.textContent = call.target;
    list.append(item);
  }
  if (list.childElementCount === 0) {
    return line(undefined, "No Move calls were recorded.");
  }
  return list;
}

function objectTypeList(objectTypes: PublicChainReceipt["objectTypes"]): HTMLElement {
  const list = document.createElement("ul");
  for (const [objectId, objectType] of Object.entries(objectTypes)) {
    const item = document.createElement("li");
    item.textContent = `${objectId}: ${objectType}`;
    list.append(item);
  }
  if (list.childElementCount === 0) {
    return line(undefined, "No object changes were recorded.");
  }
  return list;
}

function receiptErrorMessage(): string {
  if (errorCode === "digest_invalid") {
    return "That is not a valid Sui transaction digest.";
  }
  if (errorCode === "receipt_not_found") {
    return "No transaction was found for this digest on Sui mainnet.";
  }
  return errorText ?? "The local server could not return this receipt.";
}

async function loadReceipt(digest: string): Promise<void> {
  if (requestedFor === digest) {
    return;
  }
  requestedFor = digest;
  receiptData = undefined;
  errorText = undefined;
  errorCode = undefined;
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
      throw new Error("The local server returned an unexpected receipt shape.");
    }
    receiptData = parsed;
  } catch (error) {
    errorCode = error instanceof HttpJsonRequestError ? error.code : undefined;
    errorText = messageForHttpError(error, "The local server could not return this receipt.");
  }
  render();
}

function subheading(text: string): HTMLElement {
  return line("receipt-subheading", text, "h2");
}

function line(className: string | undefined, text: string, tag: "p" | "h2" = "p"): HTMLElement {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  element.textContent = text;
  return element;
}
