import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import "./review.css";
import { Transaction } from "@mysten/sui/transactions";
import mermaid from "mermaid";
import type { UiWallet } from "@mysten/dapp-kit-core";
import { createLocalDAppKit } from "./dappKitClient.js";
import { isWalletStandardUserRejected } from "./walletStatus.js";
import { getWalletUniqueIdentifier } from "@mysten/dapp-kit-core";

type GuardianCheck = {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail";
  message: string;
  source: "registry" | "quote" | "wallet" | "simulation" | "adapter" | "network" | "proposal";
};

type DisplayIntentAmount = {
  symbol: string;
  amount: string;
  amountKind: "display_intent";
  approx?: boolean;
};

type ProposalParty = {
  address?: string;
  label?: string;
};

type ProposalAmount = {
  amountDisplay: string;
  amountKind: "display_proposal";
  symbol?: string;
  coinType?: string;
  denomination?: string;
};

type ProposalReviewModel = {
  proposalId: string;
  proposalType: "payment" | "sui_action";
  proposalSource: {
    kind: string;
    name: string;
    reference?: string;
  };
  proposedAction: {
    kind: "payment" | "sui_action";
    title: string;
    purpose: string;
    network: "sui:mainnet";
    recipient?: ProposalParty;
    target?: string | Record<string, string>;
  };
  assetFlow: {
    outgoing: ProposalAmount[];
    expectedIncoming: ProposalAmount[];
    fees: ProposalAmount[];
  };
  recipients: ProposalParty[];
  targets: Array<string | Record<string, string>>;
  evidenceUsed: Array<{ id: string; label: string; source: string; summary: string }>;
  missingEvidence: Array<{ id: string; label: string; reason: string }>;
  requiredUserChoices: Array<{ id: string; label: string; reason: string }>;
  unsupportedClaims: Array<{ id: string; label: string; reason: string }>;
  rejectedExecutableFields: Array<{ fieldName: string; reason: string }>;
  freshness: {
    proposalCreatedAt: string;
    proposalExpiresAt?: string;
    evaluatedAt: string;
    status: string;
    reason: string;
  };
  blockingChecks: GuardianCheck[];
  nonSignableReason: {
    code: string;
    message: string;
    blockedCapabilities: string[];
  };
};

type ActionPlan = {
  id: string;
  actionKind: string;
  adapterId: string;
  protocol: string;
  title: string;
  summary: string;
  assetFlowPreview: {
    outgoing: DisplayIntentAmount[];
    expectedIncoming: DisplayIntentAmount[];
    minimumIncoming?: DisplayIntentAmount[];
    fees?: DisplayIntentAmount[];
  };
  reviewModel?: ProposalReviewModel;
  createdAt: string;
  preliminaryChecks?: GuardianCheck[];
};

type HumanReadableReviewEnvelope = {
  kind: string;
  proposedAction: {
    title: string;
    summary: string;
    actionKind: string;
    adapterId: string;
    protocol: string;
    network: "sui:mainnet";
  };
  recipients: Array<{ role: string; address: string }>;
  evidenceUsed: Array<{ id: string; label: string; source: string; summary: string }>;
  missingEvidence: Array<{ id: string; label: string; reason: string }>;
  requiredUserChoices: Array<{ id: string; label: string; reason: string }>;
  unsupportedClaims: Array<{ id: string; label: string; reason: string }>;
  freshness: { status: "current"; evaluatedAt: string; expiresAt: string; reason: string };
  blockingChecks: GuardianCheck[];
};

type SwapHumanReadableReview = HumanReadableReviewEnvelope & {
  kind: "swap_human_readable_review";
  assetFlow: {
    outgoing: HumanReviewAmount[];
    expectedIncoming: HumanReviewAmount[];
    minimumIncoming: HumanReviewAmount[];
    fees: HumanReviewAmount[];
  };
  targets: Array<{ kind: string; symbol: string; coinType: string; protocol: string; poolKey: string; direction: string }>;
};

type HumanReadableReview = SwapHumanReadableReview;

type TransactionSimulationSummary = {
  provider: "client.core.simulateTransaction";
  checksEnabled: boolean;
  success: boolean;
  gasCostSummary?: {
    computationCostRaw: string;
    storageCostRaw: string;
    storageRebateRaw: string;
    nonRefundableStorageFeeRaw: string;
  };
  balanceChanges?: Record<string, unknown>[];
  objectChanges?: Record<string, unknown>[];
  error?: string;
};

type ReviewState = {
  planId: string;
  reviewSessionId: string;
  account: string;
  status: "ready_for_wallet_review" | "refresh_required" | "blocked";
  blockedReason?: string;
  refreshReason?: string;
  adapterLifecycle?: {
    stageCatalogId: string;
    adapterId: string;
    protocol: string;
    actionKind: string;
    completedStages: string[];
    missingStages: string[];
  };
  humanReadableReview?: HumanReadableReview;
  simulation?: TransactionSimulationSummary;
  ptbVisualization?: PtbVisualizationArtifact;
  checks: GuardianCheck[];
  updatedAt: string;
};

type PtbVisualizationArtifact = {
  generatedAt: string;
  source: {
    adapterId: string;
    sourceKind: string;
    authority: string;
    renderer?: { name: string; packageName?: string; version?: string };
  };
  mermaid: { diagramType: string; text: string };
  diagnostics: Array<{ severity: string; code: string; message: string; source: string }>;
  unsupportedUse: string[];
};

type HumanReviewAmount = {
  role: string;
  symbol: string;
  coinType: string;
  decimals: number;
  rawAmount: string;
  rawAmountSource: string;
  displayAmount?: string;
  displayAmountSource?: string;
};

type ReviewSessionPayload = {
  reviewSessionId: string;
  internalStatus: string;
  pollingStatus: string;
  lastActivityAt: string;
  activeAccount?: {
    account: string;
    source: string;
    setAt: string;
    walletName?: string;
    walletId?: string;
  };
  reviewState?: ReviewState;
  signingInProgress?: boolean;
  executionResult?: {
    status: string;
    txDigest?: string;
    failureReason?: string;
    failureDetail?: string;
    recordedAt?: string;
  };
  plans: ActionPlan[];
};

type WalletIdentityResponse = {
  walletUrl: string;
  walletSessionId: string;
  openTarget: "system_browser";
};

const root = document.querySelector<HTMLElement>("#review-app");
if (!root) {
  throw new Error("review app root missing");
}
const rootElement = root;
const reviewSessionId = rootElement.dataset.reviewSessionId ?? "";
const token = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";

let sessionPayload: ReviewSessionPayload | undefined;
let selectedPlanId: string | undefined;
let message = "";
let errorMessage = "";
let loading = false;

mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default", flowchart: { useMaxWidth: true } });
let ptbRenderSequence = 0;

const dAppKit = createLocalDAppKit();
dAppKit.stores.$wallets.subscribe(() => render());
dAppKit.stores.$connection.subscribe(() => render());
let isSigning = false;
let signNotice: { kind: "error" | "info"; text: string } | undefined;
let sessionGone = false;

if (reviewSessionId && token) {
  void openAndLoadReview();
} else {
  render();
}

type ReviewWizardStage = "review" | "sign" | "result";
type PageStage =
  | "no_identity"
  | "pre_review"
  | "stopped"
  | "ready"
  | "expired_quote"
  | "signing"
  | "chain_wait"
  | "done"
  | "session_expired";

let quoteCountdownTimer: ReturnType<typeof setInterval> | undefined;

function reviewExpiresAtMs(payload: ReviewSessionPayload): number | undefined {
  const expiresAt = payload.reviewState?.humanReadableReview?.freshness.expiresAt;
  return expiresAt ? Date.parse(expiresAt) : undefined;
}

function pageStage(payload: ReviewSessionPayload): PageStage {
  if (sessionGone) {
    return "session_expired";
  }
  if (payload.executionResult || payload.internalStatus === "success" || payload.internalStatus === "failure") {
    return "done";
  }
  if (payload.internalStatus === "signed_pending_result") {
    return "chain_wait";
  }
  if (payload.signingInProgress || isSigning) {
    return "signing";
  }
  if (payload.reviewState?.status === "ready_for_wallet_review") {
    const expiresAtMs = reviewExpiresAtMs(payload);
    if (expiresAtMs !== undefined && Date.now() > expiresAtMs) {
      return "expired_quote";
    }
    return "ready";
  }
  if (payload.reviewState) {
    return "stopped";
  }
  if (!payload.activeAccount) {
    return "no_identity";
  }
  return "pre_review";
}

function wizardStage(stage: PageStage): ReviewWizardStage {
  if (stage === "done" || stage === "chain_wait") {
    return "result";
  }
  if (stage === "ready" || stage === "expired_quote" || stage === "signing") {
    return "sign";
  }
  return "review";
}

const STAGE_HEADLINES: Record<PageStage, string> = {
  no_identity: "Connect a wallet first - ask your AI client to connect, or open the wallet page below.",
  pre_review: "Start the review to check this transaction against live mainnet data.",
  stopped: "The review stopped - see the reason below, then run it again.",
  ready: "Ready to sign - check the summary, then sign in your wallet.",
  expired_quote: "The price quote expired. Your funds are safe - refresh to get a current quote.",
  signing: "Waiting for your wallet - approve or reject the request in the wallet popup.",
  chain_wait: "Signed - waiting for the chain result.",
  done: "This review session is finished - for another transaction, ask your AI client to prepare a new review.",
  session_expired: "This review session has expired. Ask your AI client for a new review."
};

function renderWizardHeader(stage: ReviewWizardStage): HTMLElement {
  const order: Array<{ key: ReviewWizardStage; label: string }> = [
    { key: "review", label: "1. Review" },
    { key: "sign", label: "2. Sign" },
    { key: "result", label: "3. Result" }
  ];
  const index = order.findIndex((step) => step.key === stage);
  const headerEl = element("div", "wizard-steps");
  order.forEach((step, stepIndex) => {
    const cls = stepIndex < index ? "wizard-step done" : stepIndex === index ? "wizard-step current" : "wizard-step";
    headerEl.append(element("span", cls, step.label));
    if (stepIndex < order.length - 1) {
      headerEl.append(element("span", "wizard-sep", "→"));
    }
  });
  return headerEl;
}

function render(): void {
  rootElement.innerHTML = "";
  const shell = element("section", "review-shell");
  const header = element("div", "page-header");
  header.append(element("h1", undefined, "Say Ur Intent"));
  header.append(element("span", "page-subtitle", "Transaction review and signing"));
  shell.append(header);
  if (errorMessage) {
    const status = element("p", "status error", errorMessage);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    shell.append(status);
  }

  if (!reviewSessionId || !token) {
    shell.append(element("p", "error", "Missing review session id or token. Open the review URL from your AI client again."));
    rootElement.append(shell);
    return;
  }

  if (!sessionPayload) {
    shell.append(button("Reload review session", () => void loadReview(), "secondary"));
    rootElement.append(shell);
    return;
  }

  const stage = pageStage(sessionPayload);
  shell.append(renderWizardHeader(wizardStage(stage)));
  shell.append(element("h3", "stage-headline", STAGE_HEADLINES[stage]));
  if (signNotice) {
    shell.append(element("p", signNotice.kind === "error" ? "error sign-banner" : "status sign-banner", signNotice.text));
  }
  manageQuoteCountdown(stage);
  shell.append(renderTransactionCard(sessionPayload));

  switch (stage) {
    case "session_expired": {
      break;
    }
    case "done":
    case "chain_wait": {
      if (sessionPayload.executionResult) {
        shell.append(renderExecutionResultPanel(sessionPayload.executionResult));
      }
      shell.append(collapsedEvidence(sessionPayload, stage));
      break;
    }
    case "signing": {
      const panel = card("Signing in progress");
      panel.append(
        element(
          "p",
          undefined,
          "Your wallet shows exactly what will be signed. Nothing happens without your approval there."
        )
      );
      panel.append(element("p", undefined, "If you do not see the wallet popup, open your wallet extension - or cancel below."));
      const actions = element("div", "actions");
      actions.append(button("Cancel signing", () => void cancelSigning(), "secondary"));
      panel.append(actions);
      shell.append(panel);
      shell.append(collapsedEvidence(sessionPayload, stage));
      break;
    }
    case "ready": {
      if (sessionPayload.reviewState) {
        shell.append(renderReadyKeyFindings(sessionPayload.reviewState));
        shell.append(renderSigningSection(sessionPayload.reviewState));
      }
      shell.append(collapsedEvidence(sessionPayload, stage));
      break;
    }
    case "expired_quote": {
      const panel = card("Quote expired");
      panel.append(
        element(
          "p",
          undefined,
          "Nothing was signed and no funds moved. Prices are only held for 30 seconds - refresh to continue."
        )
      );
      const actions = element("div", "actions");
      const refresh = button("Refresh price quote", () => void runAccountBoundReview(), "primary");
      refresh.disabled = loading;
      actions.append(refresh);
      panel.append(actions);
      shell.append(panel);
      shell.append(collapsedEvidence(sessionPayload, stage));
      break;
    }
    case "stopped": {
      shell.append(renderStoppedPanel(sessionPayload));
      shell.append(collapsedEvidence(sessionPayload, stage));
      break;
    }
    case "no_identity": {
      const panel = card("Wallet needed");
      panel.append(
        element(
          "p",
          undefined,
          "This review needs a connected wallet account for its checks. Connect on the wallet page, then come back here."
        )
      );
      const actions = element("div", "actions");
      actions.append(button("Open wallet page", () => void createWalletIdentity(), "primary"));
      panel.append(actions);
      shell.append(panel);
      break;
    }
    case "pre_review": {
      const plan = selectedPlan(sessionPayload);
      if (plan?.reviewModel) {
        const proposalCard = card("External proposal review");
        proposalCard.append(renderProposalReviewModel(plan.reviewModel));
        shell.append(proposalCard);
      }
      const actions = element("div", "actions");
      const run = button("Start review", () => void runAccountBoundReview(), "primary");
      run.disabled = loading;
      actions.append(run);
      shell.append(actions);
      shell.append(collapsedEvidence(sessionPayload, stage));
      break;
    }
  }
  rootElement.append(shell);
}

function manageQuoteCountdown(stage: PageStage): void {
  if (quoteCountdownTimer) {
    clearInterval(quoteCountdownTimer);
    quoteCountdownTimer = undefined;
  }
  if (stage !== "ready") {
    return;
  }
  quoteCountdownTimer = setInterval(() => {
    const expiresAtMs = sessionPayload ? reviewExpiresAtMs(sessionPayload) : undefined;
    const label = document.querySelector(".quote-countdown");
    if (expiresAtMs === undefined || !label) {
      return;
    }
    const secondsLeft = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
    label.textContent = `Quote valid for ${secondsLeft}s - if it expires, just refresh; your funds stay safe.`;
    if (secondsLeft === 0) {
      render();
    }
  }, 1000);
}

function renderStoppedPanel(payload: ReviewSessionPayload): HTMLElement {
  const panel = card("Why the review stopped");
  const state = payload.reviewState;
  const reason = state?.blockedReason ?? state?.refreshReason ?? "unknown";
  const friendly: Record<string, string> = {
    insufficient_balance: "The account does not hold enough assets for this swap - see the exact amounts below.",
    zero_expected_output: "The amount is too small for this pool minimum order size - try a larger amount.",
    quote_unavailable: "The pool could not quote this amount right now - it may be below the pool minimum, or the price source had a hiccup.",
    quote_stale: "The price quote expired. Running again fetches a fresh quote - your funds are safe.",
    object_resolution_failed: "Required on-chain objects could not be resolved while building the transaction. Running again usually resolves this."
  };
  const failingFirst = (state?.checks ?? []).find((check) => check.status === "fail");
  const reasonKey = String(reason);
  const detailKey = failingFirst && /zero_expected_output/.test(failingFirst.message) ? "zero_expected_output" : reasonKey;
  if (friendly[detailKey]) {
    panel.append(element("p", undefined, friendly[detailKey]));
  }
  panel.append(row("Reason", reasonKey));
  const failing = (state?.checks ?? []).filter((check) => check.status === "fail");
  for (const check of failing) {
    panel.append(element("p", "error", `${check.label}: ${check.message}`));
  }
  const actions = element("div", "actions");
  const run = button("Run review again", () => void runAccountBoundReview(), "primary");
  run.disabled = loading;
  actions.append(run);
  panel.append(actions);
  return panel;
}

function rawToDisplay(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function renderTransactionCard(payload: ReviewSessionPayload): HTMLElement {
  const panel = card("Transaction");
  const plan = selectedPlan(payload);
  const review = payload.reviewState?.humanReadableReview;
  const swap = review && review.kind === "swap_human_readable_review" ? review : undefined;
  if (!plan) {
    panel.append(element("p", "error", "No action plan is available for this review session."));
    return panel;
  }
  const sendPreview = plan.assetFlowPreview.outgoing[0];
  const receivePreview = plan.assetFlowPreview.expectedIncoming[0];
  const outgoing = swap?.assetFlow.outgoing[0];
  const minimum = swap?.assetFlow.minimumIncoming[0];
  panel.append(
    row(
      "You send",
      outgoing
        ? `${rawToDisplay(outgoing.rawAmount, outgoing.decimals)} ${outgoing.symbol}`
        : sendPreview
          ? `${sendPreview.amount} ${sendPreview.symbol}`
          : "-"
    )
  );
  panel.append(
    row(
      "You receive",
      minimum
        ? `at least ${rawToDisplay(minimum.rawAmount, minimum.decimals)} ${minimum.symbol} (guaranteed minimum)`
        : receivePreview
          ? `${receivePreview.symbol} (amount confirmed after review)`
          : "-"
    )
  );
  const fee = swap?.assetFlow.fees[0];
  if (fee) {
    const feeValue = BigInt(fee.rawAmount);
    panel.append(
      row(
        "Protocol fee",
        feeValue === 0n
          ? "Included in the rate (paid from the coin you send)"
          : `${rawToDisplay(fee.rawAmount, fee.decimals)} ${fee.symbol}`
      )
    );
  }
  const recipient = swap?.recipients.find((entry) => entry.role === "output_recipient");
  panel.append(
    row(
      "Receiving account",
      recipient
        ? `${shortHex(recipient.address)} (your connected account)`
        : payload.activeAccount
          ? `${shortHex(payload.activeAccount.account)} (your connected account)`
          : "your connected account"
    )
  );
  const target = swap?.targets[0];
  panel.append(row("Via", target ? `${target.protocol} ${target.poolKey}` : plan.protocol));
  return panel;
}

function coinDisplayMap(state: ReviewState): Map<string, { symbol: string; decimals: number }> {
  const map = new Map<string, { symbol: string; decimals: number }>();
  const review = state.humanReadableReview;
  if (review && review.kind === "swap_human_readable_review") {
    for (const amount of [
      ...review.assetFlow.outgoing,
      ...review.assetFlow.expectedIncoming,
      ...review.assetFlow.minimumIncoming,
      ...review.assetFlow.fees
    ]) {
      map.set(amount.coinType, { symbol: amount.symbol, decimals: amount.decimals });
    }
  }
  return map;
}

function formatBalanceChangeDisplay(
  record: Record<string, unknown>,
  coins: Map<string, { symbol: string; decimals: number }>
): string {
  const coinType = typeof record.coinType === "string" ? record.coinType : "";
  const amount = typeof record.amount === "string" ? record.amount : "0";
  const known = coins.get(coinType);
  if (!known) {
    return formatBalanceChange(record);
  }
  const negative = amount.startsWith("-");
  const raw = BigInt(negative ? amount.slice(1) : amount);
  return `${negative ? "-" : "+"}${rawToDisplay(raw.toString(), known.decimals)} ${known.symbol}`;
}

function renderReadyKeyFindings(state: ReviewState): HTMLElement {
  const wrapper = card("Review result");
  const passCount = state.checks.filter((check) => check.status === "pass").length;
  wrapper.append(
    element("p", "key-findings-line", `All review checks passed (${passCount}/${state.checks.length}).`)
  );
  const changes = state.simulation?.balanceChanges ?? [];
  if (changes.length > 0) {
    const coins = coinDisplayMap(state);
    wrapper.append(
      element(
        "p",
        "key-findings-line",
        `Simulation verified balance changes: ${changes
          .map((change) => formatBalanceChangeDisplay(change, coins))
          .join("  |  ")}`
      )
    );
  }
  if (state.ptbVisualization) {
    wrapper.append(renderPtbVisualization(state.ptbVisualization));
  }
  wrapper.append(
    element("p", "quote-countdown", "Quote valid for 30s - if it expires, just refresh; your funds stay safe.")
  );
  return wrapper;
}

function auditRecordMarkdown(payload: ReviewSessionPayload): string {
  const lines: string[] = [];
  const state = payload.reviewState;
  lines.push("# Say Ur Intent - review audit record");
  lines.push("");
  lines.push(`- Review session: ${payload.reviewSessionId}`);
  lines.push(`- Status: ${payload.pollingStatus}`);
  if (state) {
    lines.push(`- Updated at: ${state.updatedAt}`);
    lines.push(`- Review account: ${state.account}`);
  }
  if (payload.executionResult) {
    lines.push("");
    lines.push("## Execution result");
    lines.push(`- Status: ${payload.executionResult.status}`);
    if (payload.executionResult.txDigest) {
      lines.push(`- Transaction digest: ${payload.executionResult.txDigest}`);
    }
    if (payload.executionResult.failureReason) {
      lines.push(`- Failure reason: ${payload.executionResult.failureReason}`);
    }
    if (payload.executionResult.recordedAt) {
      lines.push(`- Recorded at: ${payload.executionResult.recordedAt}`);
    }
  }
  const review = state?.humanReadableReview;
  if (review && review.kind === "swap_human_readable_review") {
    lines.push("");
    lines.push("## Transaction");
    lines.push(`- Action: ${review.proposedAction.title}`);
    for (const [label, list] of [
      ["You send", review.assetFlow.outgoing],
      ["Expected incoming", review.assetFlow.expectedIncoming],
      ["Minimum incoming", review.assetFlow.minimumIncoming],
      ["Fees", review.assetFlow.fees]
    ] as const) {
      for (const amount of list) {
        lines.push(
          `- ${label}: ${rawToDisplay(amount.rawAmount, amount.decimals)} ${amount.symbol} (${amount.rawAmount} raw, ${amount.coinType})`
        );
      }
    }
    for (const recipient of review.recipients) {
      lines.push(`- Recipient (${recipient.role}): ${recipient.address}`);
    }
    const target = review.targets[0];
    if (target) {
      lines.push(`- Via: ${target.protocol} ${target.poolKey} (${target.direction})`);
    }
    lines.push(`- Freshness: ${review.freshness.status}, expires ${review.freshness.expiresAt}`);
    for (const item of review.evidenceUsed) {
      lines.push(`- Evidence used - ${item.label}: ${item.summary}`);
    }
    for (const item of review.missingEvidence) {
      lines.push(`- Missing evidence - ${item.label}: ${item.reason}`);
    }
    for (const item of review.requiredUserChoices) {
      lines.push(`- Required user choice - ${item.label}: ${item.reason}`);
    }
    for (const item of review.unsupportedClaims) {
      lines.push(`- Unsupported claim - ${item.label}: ${item.reason}`);
    }
  }
  const lifecycle = state?.adapterLifecycle;
  if (lifecycle) {
    lines.push("");
    lines.push("## Adapter lifecycle");
    lines.push(`- Adapter: ${lifecycle.adapterId} / ${lifecycle.protocol} / ${lifecycle.actionKind}`);
    lines.push(`- Stage catalog: ${lifecycle.stageCatalogId}`);
    lines.push(`- Completed: ${lifecycle.completedStages.join(", ") || "-"}`);
    lines.push(`- Missing: ${lifecycle.missingStages.join(", ") || "-"}`);
  }
  const simulation = state?.simulation;
  if (simulation) {
    lines.push("");
    lines.push("## Review-time simulation");
    lines.push(`- Provider: ${simulation.provider}`);
    lines.push(`- Success: ${simulation.success ? "yes" : "no"}`);
    if (simulation.gasCostSummary) {
      lines.push(
        `- Gas (raw): computation ${simulation.gasCostSummary.computationCostRaw}, storage ${simulation.gasCostSummary.storageCostRaw}, rebate ${simulation.gasCostSummary.storageRebateRaw}`
      );
    }
    const balanceChanges = simulation.balanceChanges ?? [];
    if (balanceChanges.length > 0) {
      lines.push(`- Balance changes (${balanceChanges.length}):`);
      for (const change of balanceChanges) {
        lines.push(`  - ${formatBalanceChange(change)}`);
      }
    }
    const objectChanges = simulation.objectChanges ?? [];
    if (objectChanges.length > 0) {
      lines.push(`- Object changes (${objectChanges.length}):`);
      for (const change of objectChanges) {
        lines.push(`  - ${formatObjectChange(change)}`);
      }
    }
    if (balanceChanges.length > 0 || objectChanges.length > 0) {
      lines.push("");
      lines.push("Raw records:");
      lines.push("```json");
      lines.push(JSON.stringify({ balanceChanges, objectChanges }, null, 2));
      lines.push("```");
    }
  }
  if (state?.ptbVisualization) {
    lines.push("");
    lines.push("## PTB visualization (Mermaid)");
    lines.push("```mermaid");
    lines.push(state.ptbVisualization.mermaid.text);
    lines.push("```");
  }
  if (state) {
    lines.push("");
    lines.push("## Checks");
    for (const check of state.checks) {
      lines.push(`- [${check.status}] ${check.id}: ${check.message}`);
    }
  }
  lines.push("");
  lines.push(
    "_Local pre-signing review evidence. Not transaction bytes, signing data, signing readiness, or execution safety._"
  );
  return lines.join("\n");
}

async function copyAuditRecord(buttonEl: HTMLButtonElement): Promise<void> {
  if (!sessionPayload) {
    return;
  }
  const markdown = auditRecordMarkdown(sessionPayload);
  try {
    await navigator.clipboard.writeText(markdown);
    const original = buttonEl.textContent;
    buttonEl.textContent = "Copied!";
    setTimeout(() => {
      buttonEl.textContent = original;
    }, 1500);
  } catch {
    window.prompt("Copy the audit record:", markdown);
  }
}

function collapsedEvidence(payload: ReviewSessionPayload, stage: PageStage): HTMLElement {
  const panel = element("section", "card raw-evidence-card");
  const header = element("div", "card-header");
  header.append(element("h2", undefined, "Raw evidence"));
  const copyButton = button("Copy as Markdown", () => void copyAuditRecord(copyButton), "secondary");
  copyButton.classList.add("copy-audit");
  header.append(copyButton);
  panel.append(header);
  const evidence = document.createElement("details");
  evidence.className = "final-evidence collapsible-records";
  const summary = document.createElement("summary");
  summary.textContent =
    stage === "done" || stage === "chain_wait" ? "Show audit record (final snapshot)" : "Show audit record";
  evidence.append(summary);
  const inner = document.createElement("div");
  inner.className = "raw-evidence-body";
  const state = payload.reviewState;
  const sub = (title: string, content: HTMLElement): HTMLElement => {
    const section = document.createElement("details");
    section.className = "collapsible-records";
    const sectionSummary = document.createElement("summary");
    sectionSummary.textContent = title;
    section.append(sectionSummary, content);
    return section;
  };
  inner.append(row("Review session", payload.reviewSessionId));
  if (state) {
    inner.append(row("Updated at", state.updatedAt));
    if (state.adapterLifecycle) {
      inner.append(sub("Adapter lifecycle", renderAdapterLifecycle(state.adapterLifecycle)));
    }
    if (state.humanReadableReview) {
      inner.append(
        sub(
          "Human-readable review (raw units)",
          renderHumanReadableReview(state.humanReadableReview, state.simulation !== undefined)
        )
      );
    }
    if (state.simulation) {
      inner.append(sub("Review-time simulation", renderSimulationSummary(state.simulation)));
    }
    if (state.ptbVisualization) {
      inner.append(sub("PTB visualization", renderPtbVisualization(state.ptbVisualization)));
    }
    inner.append(sub(`All checks (${state.checks.length})`, renderChecks("", state.checks)));
  } else {
    inner.append(element("p", undefined, "No review evidence recorded yet."));
  }
  evidence.append(inner);
  panel.append(evidence);
  return panel;
}

async function cancelSigning(): Promise<void> {
  try {
    await requestJson(`/api/review/${encodeURIComponent(reviewSessionId)}/handoff/cancel`, { method: "POST", body: "{}" });
    signNotice = { kind: "info", text: "Signing cancelled. Nothing was signed." };
  } catch (error) {
    signNotice = { kind: "error", text: messageForHttpError(error, "Could not cancel signing.") };
  }
  isSigning = false;
  await loadReview();
}

function renderExecutionResultPanel(result: NonNullable<ReviewSessionPayload["executionResult"]>): HTMLElement {
  const panel = card("Execution result");
  panel.classList.add(result.status === "success" ? "execution-success" : result.status === "failure" ? "execution-failure" : "execution-pending");
  const headline =
    result.status === "success"
      ? "Transaction executed successfully."
      : result.status === "failure"
        ? "Transaction did not execute."
        : "Signed - waiting for the chain result.";
  panel.append(element("p", "execution-headline", headline));
  if (result.txDigest) {
    panel.append(row("Transaction digest", result.txDigest));
  }
  if (result.failureReason) {
    panel.append(row("Failure reason", result.failureReason));
  }
  if (result.failureDetail) {
    panel.append(row("Detail", result.failureDetail));
  }
  if (result.recordedAt) {
    panel.append(row("Recorded at", result.recordedAt));
  }
  panel.append(
    element(
      "p",
      "boundary-note",
      "Recorded from your wallet's execution result for this review session. Verify the digest in a Sui explorer for chain-level confirmation."
    )
  );
  return panel;
}

function renderProposalReviewModel(model: ProposalReviewModel): HTMLElement {
  const wrapper = element("div", "proposal-review");
  wrapper.append(element("h4", undefined, "Proposal review"));
  wrapper.append(row("Proposal id", model.proposalId));
  wrapper.append(row("Proposal source", `${model.proposalSource.kind}: ${model.proposalSource.name}`));
  if (model.proposalSource.reference) {
    wrapper.append(row("Source reference", model.proposalSource.reference));
  }
  wrapper.append(row("Purpose", model.proposedAction.purpose));
  wrapper.append(row("Network", model.proposedAction.network));
  if (model.proposedAction.recipient) {
    wrapper.append(row("Recipient", partyText(model.proposedAction.recipient)));
  }
  if (model.proposedAction.target) {
    wrapper.append(row("Target", targetText(model.proposedAction.target)));
  }
  wrapper.append(renderProposalAmountList("Proposal outgoing", model.assetFlow.outgoing));
  wrapper.append(renderProposalAmountList("Proposal expected incoming", model.assetFlow.expectedIncoming));
  wrapper.append(renderProposalAmountList("Proposal fees", model.assetFlow.fees));
  wrapper.append(renderFactList("Evidence used", model.evidenceUsed.map((item) => `${item.label}: ${item.summary}`)));
  wrapper.append(renderFactList("Missing evidence", model.missingEvidence.map((item) => `${item.label}: ${item.reason}`)));
  wrapper.append(
    renderFactList("Required user choices", model.requiredUserChoices.map((item) => `${item.label}: ${item.reason}`))
  );
  wrapper.append(
    renderFactList("Unsupported claims", model.unsupportedClaims.map((item) => `${item.label}: ${item.reason}`))
  );
  wrapper.append(row("Freshness", `${model.freshness.status}: ${model.freshness.reason}`));
  wrapper.append(row("Non-signable reason", model.nonSignableReason.message));
  wrapper.append(renderFactList("Blocked capabilities", model.nonSignableReason.blockedCapabilities));
  return wrapper;
}

function renderAdapterLifecycle(lifecycle: NonNullable<ReviewState["adapterLifecycle"]>): HTMLElement {
  const wrapper = element("div", "adapter-lifecycle");
  wrapper.append(element("h4", undefined, "Adapter lifecycle"));
  wrapper.append(row("Adapter", `${lifecycle.adapterId} / ${lifecycle.protocol} / ${lifecycle.actionKind}`));
  wrapper.append(row("Stage catalog", lifecycle.stageCatalogId));
  wrapper.append(renderFactList("Completed stages", lifecycle.completedStages));
  wrapper.append(renderFactList("Missing stages", lifecycle.missingStages));
  wrapper.append(
    element(
      "p",
      "boundary-note",
      "Local pre-signing review progress only."
    )
  );
  return wrapper;
}

function renderHumanReadableReview(review: HumanReadableReview, simulationCompleted: boolean): HTMLElement {
  const wrapper = element("div", "human-readable-review");
  wrapper.append(element("h4", undefined, "Human-readable review"));
  wrapper.append(row("Review kind", review.kind));
  wrapper.append(row("Action", review.proposedAction.title));
  wrapper.append(row("Summary", humanSummary(review.proposedAction.summary)));
  wrapper.append(row("Protocol", review.proposedAction.protocol));
  wrapper.append(row("Freshness", `${review.freshness.status}: ${review.freshness.reason}`));
  wrapper.append(row("Expires at", review.freshness.expiresAt));
  wrapper.append(renderHumanReadableReviewProjection(review));
  wrapper.append(renderFactList("Recipients", review.recipients.map((recipient) => `${recipient.role}: ${recipient.address}`)));
  wrapper.append(renderFactList("Evidence used", review.evidenceUsed.map((item) => `${item.label}: ${item.summary}`)));
  // The human-readable review evidence is a stage-time snapshot; once the
  // simulation evidence exists on the same state, its "simulation missing"
  // entries are resolved and would contradict the panel below.
  const missingEvidence = simulationCompleted
    ? review.missingEvidence.filter((item) => !/simulation/i.test(item.id) && !/simulation/i.test(item.label))
    : review.missingEvidence;
  wrapper.append(renderFactList("Missing evidence", missingEvidence.map((item) => `${item.label}: ${item.reason}`)));
  wrapper.append(renderFactList("Required user choices", review.requiredUserChoices.map((item) => `${item.label}: ${item.reason}`)));
  wrapper.append(renderFactList("Unsupported claims", review.unsupportedClaims.map((item) => `${item.label}: ${item.reason}`)));
  const blockingChecks = simulationCompleted
    ? review.blockingChecks.filter((check) => !/simulation/i.test(check.id))
    : review.blockingChecks;
  if (blockingChecks.length > 0) {
    wrapper.append(renderChecks("Human review blocking checks", blockingChecks));
  }
  wrapper.append(
    element(
      "p",
      "boundary-note",
      "Displayable pre-signing evidence only."
    )
  );
  return wrapper;
}

function renderPtbVisualization(artifact: PtbVisualizationArtifact): HTMLElement {
  const wrapper = element("div", "ptb-visualization");
  wrapper.append(element("h4", undefined, "PTB visualization"));
  wrapper.append(row("Generated at", artifact.generatedAt));
  if (artifact.source.renderer) {
    const renderer = artifact.source.renderer;
    wrapper.append(
      row(
        "Renderer",
        `${renderer.name}${renderer.packageName ? ` (${renderer.packageName}${renderer.version ? `@${renderer.version}` : ""})` : ""}`
      )
    );
  }
  const graph = document.createElement("div");
  graph.className = "ptb-visualization-graph";
  graph.textContent = "Rendering PTB graph...";
  wrapper.append(graph);
  ptbRenderSequence += 1;
  void mermaid
    .render(`ptb-graph-${ptbRenderSequence}`, artifact.mermaid.text)
    .then((rendered) => {
      graph.innerHTML = rendered.svg;
    })
    .catch((error: unknown) => {
      // Do not hide render errors behind the text fallback; name the failure.
      graph.textContent = `PTB graph rendering failed: ${error instanceof Error ? error.message : String(error)}`;
      graph.classList.add("error");
    });
  const source = document.createElement("details");
  source.className = "ptb-visualization-source";
  const summary = document.createElement("summary");
  summary.textContent = `Mermaid source (${artifact.mermaid.text.length} chars)`;
  const copyMermaid = button("Copy Mermaid", () => {
    void navigator.clipboard
      .writeText(artifact.mermaid.text)
      .then(() => {
        copyMermaid.textContent = "Copied!";
        setTimeout(() => {
          copyMermaid.textContent = "Copy Mermaid";
        }, 1500);
      })
      .catch(() => window.prompt("Copy the Mermaid source:", artifact.mermaid.text));
  }, "secondary");
  copyMermaid.classList.add("copy-mermaid");
  const diagram = document.createElement("pre");
  diagram.className = "ptb-visualization-text";
  diagram.textContent = artifact.mermaid.text;
  source.append(summary, copyMermaid, diagram);
  wrapper.append(source);
  if (artifact.diagnostics.length > 0) {
    wrapper.append(
      renderFactList(
        "Renderer diagnostics",
        artifact.diagnostics.map((entry) => `${entry.severity} ${entry.code}: ${entry.message}`)
      )
    );
  }
  wrapper.append(
    element(
      "p",
      "boundary-note",
      "Diagram of the locally stored transaction shape - visualization only."
    )
  );
  return wrapper;
}

function renderSimulationSummary(simulation: TransactionSimulationSummary): HTMLElement {
  const wrapper = element("div", "simulation-summary");
  wrapper.append(element("h4", undefined, "Review-time simulation"));
  wrapper.append(row("Provider", simulation.provider));
  wrapper.append(row("Validation checks", simulation.checksEnabled ? "Enabled" : "Disabled"));
  wrapper.append(row("Simulation success", simulation.success ? "Yes" : "No"));
  if (simulation.gasCostSummary) {
    wrapper.append(
      renderFactList("Gas cost summary", [
        `Computation cost raw: ${simulation.gasCostSummary.computationCostRaw}`,
        `Storage cost raw: ${simulation.gasCostSummary.storageCostRaw}`,
        `Storage rebate raw: ${simulation.gasCostSummary.storageRebateRaw}`,
        `Non-refundable storage fee raw: ${simulation.gasCostSummary.nonRefundableStorageFeeRaw}`
      ])
    );
  }
  if (simulation.error) {
    wrapper.append(row("Simulation error", simulation.error));
  }
  wrapper.append(renderCollapsibleRecords("Balance changes", simulation.balanceChanges, formatBalanceChange));
  wrapper.append(renderCollapsibleRecords("Object changes", simulation.objectChanges, formatObjectChange));
  wrapper.append(
    element(
      "p",
      "boundary-note",
      "Redacted summary of private review-time simulation evidence."
    )
  );
  return wrapper;
}

const MCP_BOUNDARY_SENTENCE =
  /\s*This MCP response contains no sign action, signing data, transaction bytes, or signing readiness\.?/g;

// plan.summary doubles as MCP answer copy; the human page drops the
// MCP-audience sentence while leaving the stored data untouched.
function humanSummary(text: string): string {
  return text.replace(MCP_BOUNDARY_SENTENCE, "").trim();
}

function shortHex(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function shortType(value: string): string {
  return value
    .split("<")
    .map((part) =>
      part
        .split("::")
        .map((segment) => (segment.startsWith("0x") && segment.length > 14 ? shortHex(segment) : segment))
        .join("::")
    )
    .join("<");
}

function formatBalanceChange(record: Record<string, unknown>): string {
  const address = typeof record.address === "string" ? shortHex(record.address) : "?";
  const coinType = typeof record.coinType === "string" ? shortType(record.coinType) : "?";
  const amount = typeof record.amount === "string" ? record.amount : "?";
  return `${address}: ${amount.startsWith("-") ? amount : `+${amount}`} raw (${coinType})`;
}

function formatObjectChange(record: Record<string, unknown>): string {
  const op = typeof record.idOperation === "string" ? record.idOperation : "?";
  const objectType = typeof record.objectType === "string" ? shortType(record.objectType) : "?";
  const objectId = typeof record.objectId === "string" ? shortHex(record.objectId) : "?";
  return `${op}: ${objectType} (${objectId})`;
}

function renderCollapsibleRecords(
  title: string,
  records: Record<string, unknown>[] | undefined,
  format: (record: Record<string, unknown>) => string
): HTMLElement {
  const details = document.createElement("details");
  details.className = "collapsible-records";
  const summary = document.createElement("summary");
  summary.textContent = `${title} (${records?.length ?? 0})`;
  details.append(summary);
  if (!records || records.length === 0) {
    details.append(element("p", undefined, "None."));
    return details;
  }
  const list = document.createElement("ul");
  for (const record of records) {
    const item = document.createElement("li");
    item.textContent = format(record);
    list.append(item);
  }
  details.append(list);
  const raw = document.createElement("details");
  const rawSummary = document.createElement("summary");
  rawSummary.textContent = "Raw records";
  const pre = document.createElement("pre");
  pre.className = "collapsible-records-raw";
  pre.textContent = JSON.stringify(records, null, 2);
  raw.append(rawSummary, pre);
  details.append(raw);
  return details;
}

function renderHumanReadableReviewProjection(review: HumanReadableReview): HTMLElement {
  switch (review.kind) {
    case "swap_human_readable_review":
      return renderSwapHumanReadableReviewProjection(review);
  }
}

function renderSwapHumanReadableReviewProjection(review: SwapHumanReadableReview): HTMLElement {
  const wrapper = element("div", "human-readable-review-projection");
  wrapper.append(renderHumanReviewAmountList("Outgoing", review.assetFlow.outgoing));
  wrapper.append(renderHumanReviewAmountList("Expected incoming", review.assetFlow.expectedIncoming));
  wrapper.append(renderHumanReviewAmountList("Minimum incoming", review.assetFlow.minimumIncoming));
  wrapper.append(renderHumanReviewAmountList("Fees", review.assetFlow.fees));
  wrapper.append(renderFactList("Targets", review.targets.map((target) => `${target.kind}: ${target.symbol} via ${target.protocol} ${target.poolKey}`)));
  return wrapper;
}

function summarizeRecords(records: Record<string, unknown>[] | undefined): string[] {
  if (!records || records.length === 0) {
    return [];
  }
  return records.map((record) => JSON.stringify(record));
}

async function openAndLoadReview(): Promise<void> {
  loading = true;
  render();
  try {
    await requestJson(`/api/review/${encodeURIComponent(reviewSessionId)}/opened`, { method: "POST", body: "{}" });
    await loadReview();
  } catch (error) {
    errorMessage = messageForHttpError(error, "The local review server did not accept this review session.");
    loading = false;
    render();
  }
}

async function loadReview(): Promise<void> {
  loading = true;
  render();
  try {
    sessionPayload = await requestJson<ReviewSessionPayload>(`/api/review/${encodeURIComponent(reviewSessionId)}`, {
      method: "GET"
    });
    selectedPlanId ??= sessionPayload.plans[0]?.id;
    message = "Review session loaded.";
    errorMessage = "";
  } catch (error) {
    if (error instanceof HttpJsonRequestError && error.status === 410) {
      sessionGone = true;
    }
    errorMessage = messageForHttpError(error, "Could not load the review session.");
  } finally {
    loading = false;
    render();
  }
}

async function createWalletIdentity(): Promise<void> {
  loading = true;
  render();
  try {
    const result = await requestJson<WalletIdentityResponse>(
      `/api/review/${encodeURIComponent(reviewSessionId)}/wallet-identity`,
      { method: "POST", body: "{}" }
    );
    const opened = window.open(result.walletUrl, "_blank", "noopener,noreferrer");
    message = opened
      ? "Wallet identity page opened. After it reports the account result, reload this review session."
      : `Open this wallet identity URL in the same browser, then reload this review session: ${result.walletUrl}`;
    errorMessage = "";
  } catch (error) {
    errorMessage = messageForHttpError(error, "Could not create a wallet identity session.");
  } finally {
    loading = false;
    render();
  }
}

async function runAccountBoundReview(): Promise<void> {
  const account = sessionPayload?.activeAccount?.account;
  const plan = sessionPayload ? selectedPlan(sessionPayload) : undefined;
  if (!account || !plan) return;
  loading = true;
  render();
  try {
    const result = await requestJson<{ reviewState: ReviewState }>(
      `/api/review/${encodeURIComponent(reviewSessionId)}/state`,
      {
        method: "POST",
        body: JSON.stringify({ planId: plan.id, account })
      }
    );
    sessionPayload = {
      ...(await requestJson<ReviewSessionPayload>(`/api/review/${encodeURIComponent(reviewSessionId)}`, {
        method: "GET"
      })),
      reviewState: result.reviewState
    };
    message = "Account-bound review evidence recorded.";
    errorMessage = "";
  } catch (error) {
    errorMessage = messageForHttpError(error, "Could not run account-bound review.");
  } finally {
    loading = false;
    render();
  }
}

function renderSigningSection(state: ReviewState): HTMLElement {
  const wrapper = card("Wallet signing");
  wrapper.classList.add("signing-section");
  if (signNotice) {
    wrapper.append(element("p", signNotice.kind === "error" ? "error" : "status", signNotice.text));
  }
  const connection = dAppKit.stores.$connection.get();
  const wallets = dAppKit.stores.$wallets.get();
  if (connection.status === "connected") {
    if (connection.account.address !== state.account) {
      wrapper.append(
        element(
          "p",
          "error",
          `Connected wallet account ${connection.account.address} does not match the reviewed account ${state.account}. Switch the wallet account before signing.`
        )
      );
    } else {
      wrapper.append(
        element(
          "p",
          undefined,
          "Signing hands the digest-verified transaction bytes to your wallet. Finish or cancel the request in your wallet popup."
        )
      );
      const sign = button(isSigning ? "Waiting for wallet" : "Sign in wallet", () => void signInWallet(state), "primary");
      sign.disabled = isSigning;
      wrapper.append(sign);
    }
  } else if (wallets.length === 0) {
    wrapper.append(element("p", "error", "No compatible Sui wallet was detected in this browser."));
  } else {
    const preferredId = sessionPayload?.activeAccount?.walletId;
    const preferredName = sessionPayload?.activeAccount?.walletName;
    const matching = wallets.filter(
      (wallet) =>
        (preferredId !== undefined && getWalletUniqueIdentifier(wallet) === preferredId) ||
        (preferredName !== undefined && wallet.name === preferredName)
    );
    const offered = preferredId || preferredName ? matching : wallets;
    if (offered.length === 0) {
      wrapper.append(
        element(
          "p",
          "error",
          `The wallet of your reviewed account (${preferredName ?? "unknown"}) was not detected in this browser. Open that wallet extension and reload.`
        )
      );
    } else {
      wrapper.append(element("p", undefined, "Connect the reviewed wallet account in this page to sign."));
      wrapper.append(
        element(
          "p",
          "boundary-note",
          "Your wallet asks for this once per server address; afterwards it reconnects automatically."
        )
      );
      const list = element("div", "wallet-list");
      for (const wallet of offered) {
        const label = preferredId || preferredName ? `Connect ${wallet.name} (your account's wallet)` : `Connect ${wallet.name}`;
        list.append(button(label, () => void connectForSigning(wallet), "secondary"));
      }
      wrapper.append(list);
    }
  }
  wrapper.append(
    element(
      "p",
      "boundary-note",
      "Signing happens in your wallet. This page never sees private keys; it hands over bytes whose recomputed digest equals the reviewed commitment."
    )
  );
  return wrapper;
}

async function connectForSigning(wallet: UiWallet): Promise<void> {
  signNotice = undefined;
  try {
    await dAppKit.connectWallet({ wallet });
    const connection = dAppKit.stores.$connection.get();
    if (connection.status === "connected" && connection.account.address === sessionPayload?.activeAccount?.account) {
      // Remember which wallet holds the reviewed account so future sessions
      // only offer that wallet. Failure here is non-blocking.
      void requestJson(`/api/review/${encodeURIComponent(reviewSessionId)}/wallet-meta`, {
        method: "POST",
        body: JSON.stringify({
          account: connection.account.address,
          walletName: wallet.name,
          walletId: getWalletUniqueIdentifier(wallet)
        })
      }).catch(() => undefined);
    }
  } catch (error) {
    signNotice = {
      kind: "error",
      text: messageForHttpError(error, "The wallet connection request was not completed.")
    };
  }
  render();
}

async function signInWallet(state: ReviewState): Promise<void> {
  if (isSigning) return;
  isSigning = true;
  signNotice = { kind: "info", text: "Approve the request in your wallet. After approval this page waits for the chain result and shows success or failure here." };
  render();
  let handedOff = false;
  try {
    const handoff = await requestJson<{ transactionBytesBase64: string; transactionMaterialCommitment: string }>(
      `/api/review/${encodeURIComponent(reviewSessionId)}/handoff`,
      { method: "POST", body: JSON.stringify({ planId: state.planId, account: state.account }) }
    );
    const bytes = base64ToBytes(handoff.transactionBytesBase64);
    const transaction = Transaction.from(bytes);
    const recomputed = await transaction.getDigest();
    if (recomputed !== handoff.transactionMaterialCommitment) {
      throw new Error("Handoff bytes do not match the reviewed transaction commitment.");
    }
    handedOff = true;
    const result = await dAppKit.signAndExecuteTransaction({ transaction });
    const executed = result.$kind === "Transaction" ? result.Transaction : undefined;
    const digest = executed?.digest;
    if (typeof digest !== "string" || digest.length === 0) {
      await postExecutionResult(state, { status: "failure", failureReason: "transaction_submit_failed" });
      signNotice = { kind: "error", text: "The wallet did not return an executed transaction digest." };
      return;
    }
    await postExecutionResult(state, { status: "signed_pending_result", txDigest: digest });
    await postExecutionResult(state, { status: "success", txDigest: digest });
    signNotice = { kind: "info", text: "Transaction executed successfully - receipt recorded below." };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (handedOff) {
      const failureReason = isWalletStandardUserRejected(error) ? "wallet_rejected" : "wallet_provider_error";
      try {
        await postExecutionResult(state, { status: "failure", failureReason });
      } catch {
        // The local result endpoint refused the failure record; surface the original error only.
      }
    }
    signNotice = { kind: "error", text: messageForHttpError(error, text) };
  } finally {
    isSigning = false;
    await loadReview();
  }
}

async function postExecutionResult(
  state: ReviewState,
  body: { status: "signed_pending_result" | "success" | "failure"; txDigest?: string; failureReason?: string }
): Promise<void> {
  await requestJson(`/api/review/${encodeURIComponent(reviewSessionId)}/result`, {
    method: "POST",
    body: JSON.stringify({ planId: state.planId, ...body })
  });
}

function base64ToBytes(value: string): Uint8Array {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

async function requestJson<T = unknown>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-say-ur-intent-token": token,
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
  }
  return (await response.json()) as T;
}

function selectedPlan(payload: ReviewSessionPayload): ActionPlan | undefined {
  return payload.plans.find((plan) => plan.id === selectedPlanId) ?? payload.plans[0];
}

function labelForReviewStatus(status: ReviewState["status"]): string {
  switch (status) {
    case "ready_for_wallet_review":
      return "Ready for wallet review";
    case "refresh_required":
      return "Refresh required";
    case "blocked":
      return "Blocked";
  }
}

function renderAmountList(label: string, amounts: DisplayIntentAmount[]): HTMLElement {
  const wrapper = element("div", "amount-list");
  wrapper.append(element("h4", undefined, label));
  if (amounts.length === 0) {
    wrapper.append(element("p", undefined, "None."));
    return wrapper;
  }
  const list = document.createElement("ul");
  for (const amount of amounts) {
    const item = document.createElement("li");
    item.textContent = `${amount.amount}${amount.approx ? " approx." : ""} ${amount.symbol} (${amount.amountKind})`;
    list.append(item);
  }
  wrapper.append(list);
  return wrapper;
}

function renderProposalAmountList(label: string, amounts: ProposalAmount[]): HTMLElement {
  const wrapper = element("div", "amount-list");
  wrapper.append(element("h4", undefined, label));
  if (amounts.length === 0) {
    wrapper.append(element("p", undefined, "None."));
    return wrapper;
  }
  const list = document.createElement("ul");
  for (const amount of amounts) {
    const item = document.createElement("li");
    item.textContent = `${amount.amountDisplay} ${amount.symbol ?? amount.denomination ?? "unspecified asset"} (${amount.amountKind})`;
    list.append(item);
  }
  wrapper.append(list);
  return wrapper;
}

function renderHumanReviewAmountList(label: string, amounts: HumanReviewAmount[]): HTMLElement {
  const wrapper = element("div", "amount-list");
  wrapper.append(element("h4", undefined, label));
  if (amounts.length === 0) {
    wrapper.append(element("p", undefined, "None."));
    return wrapper;
  }
  const list = document.createElement("ul");
  for (const amount of amounts) {
    const displayPrefix = amount.displayAmount ? `${amount.displayAmount} ${amount.symbol}; ` : "";
    const item = document.createElement("li");
    item.textContent =
      `${amount.role}: ${displayPrefix}${amount.rawAmount} raw ${amount.symbol} (${amount.coinType}, decimals ${amount.decimals}; source ${amount.rawAmountSource})`;
    list.append(item);
  }
  wrapper.append(list);
  return wrapper;
}

function renderFactList(label: string, facts: string[]): HTMLElement {
  const wrapper = element("div", "fact-list");
  wrapper.append(element("h4", undefined, label));
  if (facts.length === 0) {
    wrapper.append(element("p", undefined, "None."));
    return wrapper;
  }
  const list = document.createElement("ul");
  for (const fact of facts) {
    const item = document.createElement("li");
    item.textContent = fact;
    list.append(item);
  }
  wrapper.append(list);
  return wrapper;
}

function renderChecks(label: string, checks: GuardianCheck[]): HTMLElement {
  const wrapper = element("div", "checks");
  if (label) {
    wrapper.append(element("h4", undefined, label));
  }
  if (checks.length === 0) {
    wrapper.append(element("p", undefined, "No checks recorded."));
    return wrapper;
  }
  const list = document.createElement("ul");
  for (const check of checks) {
    const item = document.createElement("li");
    item.className = `check ${check.status}`;
    item.append(element("strong", undefined, `${check.label}: ${check.status}`));
    item.append(element("span", undefined, ` ${check.message}`));
    item.append(element("small", undefined, ` Source: ${check.source}; id: ${check.id}`));
    list.append(item);
  }
  wrapper.append(list);
  return wrapper;
}

function card(title: string): HTMLElement {
  const panel = element("section", "card");
  panel.append(element("h2", undefined, title));
  return panel;
}

function row(label: string, value: string): HTMLElement {
  const wrapper = element("div", "row");
  wrapper.append(element("span", "row-label", label));
  wrapper.append(element("span", "row-value", value));
  return wrapper;
}

function partyText(party: ProposalParty): string {
  return [party.label, party.address].filter(Boolean).join(" / ");
}

function targetText(target: string | Record<string, string>): string {
  if (typeof target === "string") {
    return target;
  }
  return Object.entries(target)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}

function button(label: string, onClick: () => void, variant: "primary" | "secondary" = "primary"): HTMLButtonElement {
  const buttonElement = document.createElement("button");
  buttonElement.type = "button";
  buttonElement.className = variant;
  buttonElement.disabled = loading;
  buttonElement.textContent = label;
  buttonElement.onclick = onClick;
  return buttonElement;
}

function element(tag: "h1" | "h2" | "h3" | "h4" | "p" | "section" | "div" | "span" | "strong" | "small", className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}
