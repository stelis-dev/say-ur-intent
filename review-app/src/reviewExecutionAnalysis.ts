import mermaid from "mermaid";

import type { ReviewExecutionAnalysisPayload } from "../../src/core/session/reviewExecutionAnalysis.js";
import { HttpJsonRequestError, errorCodeFromResponse, messageForHttpError } from "./http.js";
import "./reviewExecutionAnalysis.css";

type ReviewedRequest = NonNullable<ReviewExecutionAnalysisPayload["reviewedRequest"]>;
type ReviewedEvidence = NonNullable<ReviewExecutionAnalysisPayload["reviewedEvidence"]>;
type ExecutionAnalysis = ReviewExecutionAnalysisPayload["execution"];
type DisplayIntentAmount = ReviewedRequest["assetFlowPreview"]["outgoing"][number];
type ProposalReviewModel = NonNullable<ReviewedRequest["reviewModel"]>;
type HumanReadableReview = NonNullable<ReviewedEvidence["humanReadableReview"]>;
type HumanReviewAmount = NonNullable<HumanReadableReview["assetFlow"]>["outgoing"][number];
type TransactionSimulationSummary = NonNullable<ReviewedEvidence["simulation"]>;
type TransactionSimulationBalanceChange = NonNullable<TransactionSimulationSummary["balanceChanges"]>[number];
type TransactionSimulationObjectChange = NonNullable<TransactionSimulationSummary["objectChanges"]>[number];
type PtbVisualizationArtifact = NonNullable<ReviewedEvidence["ptbVisualization"]>;
type ChainReceipt = Extract<ExecutionAnalysis, { state: "success" }>["chainReceipt"];
type LabeledSessionFact = ReviewExecutionAnalysisPayload["labeledSessionFacts"][number];
type GuardianCheck = ReviewedEvidence["checks"][number];

const root = document.querySelector<HTMLElement>("#review-execution-analysis-app");
if (!root) {
  throw new Error("review execution analysis root missing");
}
const rootElement = root;
const reviewSessionId = rootElement.dataset.reviewSessionId ?? "";
const token = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";

mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default", flowchart: { useMaxWidth: true } });
let ptbRenderSequence = 0;

void loadAnalysis();

async function loadAnalysis(): Promise<void> {
  rootElement.className = "analysis-shell";
  rootElement.replaceChildren(
    element("p", "status", token ? "Loading review execution analysis..." : "Missing review token.")
  );
  if (!token) {
    return;
  }

  try {
    const payload = await requestJson<ReviewExecutionAnalysisPayload>(
      `/api/review/${encodeURIComponent(reviewSessionId)}/analysis`
    );
    renderPayload(payload);
  } catch (error) {
    rootElement.replaceChildren(
      element(
        "p",
        "error",
        messageForHttpError(error, "Could not load the review execution analysis.")
      )
    );
  }
}

function renderPayload(payload: ReviewExecutionAnalysisPayload): void {
  const header = document.createElement("header");
  header.className = "page-header";
  header.append(
    element("p", "eyebrow", "Say Ur Intent"),
    element("h1", undefined, "Review execution analysis"),
    element("p", "review-copy", payload.summary.message)
  );
  const back = document.createElement("a");
  back.className = "text-link";
  back.href = `/review/${encodeURIComponent(payload.reviewSessionId)}#${encodeURIComponent(token)}`;
  back.textContent = "Back to review";
  header.append(back);

  rootElement.replaceChildren(
    header,
    renderSessionOverview(payload),
    renderReviewedRequest(payload.reviewedRequest),
    renderReviewedEvidence(payload.reviewedEvidence),
    renderExecution(payload.execution),
    renderLabeledFacts(payload.labeledSessionFacts),
    renderUnsupportedUses(payload.unsupportedUses)
  );
}

function renderSessionOverview(payload: ReviewExecutionAnalysisPayload): HTMLElement {
  return section("Session", [
    row("Review session", payload.reviewSessionId),
    row("Session status", payload.sessionStatus),
    row("Analysis generated at", payload.generatedAt),
    row("Analysis state", payload.summary.state)
  ]);
}

function renderReviewedRequest(request: ReviewedRequest | undefined): HTMLElement {
  if (!request) {
    return section("Reviewed request", [element("p", "status", "No action plan is stored for this session.")]);
  }
  const children: HTMLElement[] = [
    row("Title", request.title),
    row("Summary", request.summary),
    row("Action", `${request.actionKind} through ${request.protocol}`),
    row("Adapter", `${request.adapterId} (${request.protocol})`),
    renderAmountPreview("Outgoing", request.assetFlowPreview.outgoing),
    renderAmountPreview("Expected incoming", request.assetFlowPreview.expectedIncoming)
  ];
  if (request.assetFlowPreview.minimumIncoming?.length) {
    children.push(renderAmountPreview("Minimum incoming", request.assetFlowPreview.minimumIncoming));
  }
  if (request.assetFlowPreview.fees?.length) {
    children.push(renderAmountPreview("Fees", request.assetFlowPreview.fees));
  }
  if (request.reviewModel) {
    children.push(renderProposalReview(request.reviewModel));
  }
  return section("Reviewed request", children);
}

function renderReviewedEvidence(evidence: ReviewedEvidence | undefined): HTMLElement {
  if (!evidence) {
    return section("Reviewed evidence", [
      element("p", "status", "No local review evidence is stored for this session.")
    ]);
  }
  const children: HTMLElement[] = [
    row("Review status", evidence.status),
    row("Updated at", evidence.updatedAt)
  ];
  if (evidence.account) {
    children.push(row("Review account", evidence.account));
  }
  if (evidence.walletReview) {
    children.push(row("Reviewed transaction commitment", evidence.walletReview.transactionMaterialCommitment));
  }
  if (evidence.adapterLifecycle) {
    children.push(
      renderFactList("Adapter stages", [
        `Completed: ${evidence.adapterLifecycle.completedStages.join(", ") || "None"}`,
        `Missing: ${evidence.adapterLifecycle.missingStages.join(", ") || "None"}`
      ])
    );
  }
  if (evidence.blockedReason) {
    children.push(row("Blocked reason", evidence.blockedReason));
  }
  if (evidence.refreshReason) {
    children.push(row("Refresh reason", evidence.refreshReason));
  }
  children.push(renderChecks(evidence.checks));
  if (evidence.humanReadableReview) {
    children.push(renderHumanReadableReview(evidence.humanReadableReview));
  }
  if (evidence.simulation) {
    children.push(renderSimulation(evidence.simulation));
  }
  if (evidence.ptbVisualization) {
    children.push(renderPtbVisualization(evidence.ptbVisualization));
  }
  return section("Reviewed evidence", children);
}

function renderExecution(execution: ExecutionAnalysis): HTMLElement {
  const children: HTMLElement[] = [row("Recorded state", execution.state), element("p", "status", execution.statusLabel)];
  if ("planId" in execution) {
    children.push(row("Plan", execution.planId));
  }
  if ("txDigest" in execution && execution.txDigest) {
    children.push(row("Transaction digest", execution.txDigest));
  }
  if ("recordedAt" in execution) {
    children.push(row("Recorded at", execution.recordedAt));
  }
  if (execution.state === "failure") {
    children.push(row("Failure reason", execution.failureReason));
  }
  if ("chainReceipt" in execution && execution.chainReceipt) {
    children.push(renderChainReceipt(execution.chainReceipt));
  }
  return section("Execution result", children);
}

function renderChainReceipt(receipt: ChainReceipt): HTMLElement {
  const children: HTMLElement[] = [
    row("Receipt source", `${receipt.source.method} on ${receipt.source.network}`),
    row("Chain identifier", receipt.source.chainIdentifier),
    row("Fetched at", receipt.source.fetchedAt),
    row("Receipt sender", receipt.sender),
    row("Chain effects", formatEffectsStatus(receipt.effectsStatus))
  ];
  children.push(renderFactList("Package calls", receipt.packageCalls.map((call) => call.target)));
  children.push(
    renderFactList(
      "Account balance changes",
      receipt.accountBalanceChanges.map((change) => `${change.direction} ${change.amountRaw} raw ${change.coinType}`)
    )
  );
  const objectTypes = Object.entries(receipt.objectTypes);
  if (objectTypes.length > 0) {
    children.push(renderFactList("Object types", objectTypes.map(([objectId, objectType]) => `${objectId}: ${objectType}`)));
  }
  return subSection("Server-read chain receipt", children);
}

function formatEffectsStatus(status: ChainReceipt["effectsStatus"]): string {
  if (status.success) {
    return "success";
  }
  return status.errorMessage
    ? `failure: ${status.errorMessage}`
    : status.errorKind
      ? `failure: ${status.errorKind}`
      : "failure";
}

function renderLabeledFacts(facts: LabeledSessionFact[]): HTMLElement {
  if (facts.length === 0) {
    return section("Labeled session facts", [
      element("p", "status", "No labeled session facts are available yet.")
    ]);
  }
  return section(
    "Labeled session facts",
    facts.map((fact) => {
      const item = document.createElement("article");
      item.className = "fact-item";
      item.append(
        element("h3", undefined, fact.label),
        row("Value", fact.value),
        row("Source", fact.source),
        element("p", "fact-meaning", fact.meaning)
      );
      return item;
    })
  );
}

function renderUnsupportedUses(items: string[]): HTMLElement {
  return section("Boundaries", [
    renderFactList("This analysis does not expand product authority", items)
  ]);
}

function renderAmountPreview(label: string, amounts: DisplayIntentAmount[]): HTMLElement {
  return renderFactList(
    label,
    amounts.map((amount) => `${amount.amount}${amount.approx ? " approx." : ""} ${amount.symbol}`)
  );
}

function renderProposalReview(model: ProposalReviewModel): HTMLElement {
  const children: HTMLElement[] = [];
  if (model.proposedAction) {
    children.push(
      row("Proposal action", `${model.proposedAction.title ?? "Untitled"} (${model.proposedAction.network ?? "unknown network"})`)
    );
    if (model.proposedAction.purpose) {
      children.push(row("Proposal purpose", model.proposedAction.purpose));
    }
  }
  if (model.evidenceUsed?.length) {
    children.push(renderFactList("Proposal evidence used", model.evidenceUsed.map((entry) => `${entry.label}: ${entry.summary}`)));
  }
  if (model.missingEvidence?.length) {
    children.push(renderFactList("Missing proposal evidence", model.missingEvidence.map((entry) => `${entry.label}: ${entry.reason}`)));
  }
  if (model.requiredUserChoices?.length) {
    children.push(renderFactList("Required user choices", model.requiredUserChoices.map((entry) => `${entry.label}: ${entry.reason}`)));
  }
  if (model.unsupportedClaims?.length) {
    children.push(renderFactList("Unsupported proposal claims", model.unsupportedClaims.map((entry) => `${entry.label}: ${entry.reason}`)));
  }
  if (model.rejectedExecutableFields?.length) {
    children.push(
      renderFactList(
        "Rejected executable fields",
        model.rejectedExecutableFields.map((entry) => `${entry.fieldName}: ${entry.reason}`)
      )
    );
  }
  if (model.nonSignableReason) {
    children.push(row("Non-signable proposal reason", `${model.nonSignableReason.code}: ${model.nonSignableReason.message}`));
  }
  return subSection("External proposal review", children);
}

function renderHumanReadableReview(review: HumanReadableReview): HTMLElement {
  const children: HTMLElement[] = [
    row("Review title", review.proposedAction.title),
    row("Review summary", review.proposedAction.summary),
    row("Network", review.proposedAction.network),
    row("Freshness", `${review.freshness.status}: ${review.freshness.reason}`)
  ];
  if (review.assetFlow) {
    children.push(renderHumanAmounts("Outgoing", review.assetFlow.outgoing));
    children.push(renderHumanAmounts("Expected incoming", review.assetFlow.expectedIncoming));
    children.push(renderHumanAmounts("Minimum incoming", review.assetFlow.minimumIncoming));
    children.push(renderHumanAmounts("Fees", review.assetFlow.fees));
  }
  children.push(renderFactList("Evidence used", review.evidenceUsed.map((entry) => `${entry.label}: ${entry.summary}`)));
  if (review.missingEvidence.length > 0) {
    children.push(renderFactList("Missing evidence", review.missingEvidence.map((entry) => `${entry.label}: ${entry.reason}`)));
  }
  if (review.requiredUserChoices.length > 0) {
    children.push(renderFactList("Required user choices", review.requiredUserChoices.map((entry) => `${entry.label}: ${entry.reason}`)));
  }
  if (review.unsupportedClaims.length > 0) {
    children.push(renderFactList("Unsupported claims", review.unsupportedClaims.map((entry) => `${entry.label}: ${entry.reason}`)));
  }
  return subSection("Human-readable review", children);
}

function renderHumanAmounts(label: string, amounts: HumanReviewAmount[]): HTMLElement {
  return renderFactList(
    label,
    amounts.map((amount) => `${amount.displayAmount ?? amount.rawAmount} ${amount.symbol} (${amount.rawAmount} raw, ${amount.coinType})`)
  );
}

function renderSimulation(simulation: TransactionSimulationSummary): HTMLElement {
  const children: HTMLElement[] = [
    row("Provider", simulation.provider),
    row("Checks enabled", simulation.checksEnabled ? "yes" : "no"),
    row("Simulation success", simulation.success ? "yes" : "no")
  ];
  if (simulation.gasCostSummary) {
    children.push(
      renderFactList("Gas cost summary", [
        `Computation cost raw: ${simulation.gasCostSummary.computationCostRaw}`,
        `Storage cost raw: ${simulation.gasCostSummary.storageCostRaw}`,
        `Storage rebate raw: ${simulation.gasCostSummary.storageRebateRaw}`,
        `Non-refundable storage fee raw: ${simulation.gasCostSummary.nonRefundableStorageFeeRaw}`
      ])
    );
  }
  if (simulation.error) {
    children.push(row("Simulation error", simulation.error));
  }
  children.push(renderSimulationBalanceChanges(simulation.balanceChanges));
  children.push(renderSimulationObjectChanges(simulation.objectChanges));
  return subSection("Review-time simulation", children);
}

function renderSimulationBalanceChanges(records: TransactionSimulationBalanceChange[] | undefined): HTMLElement {
  return renderKnownRecordList(
    "Balance changes",
    records,
    (record) => `${record.amount} raw ${record.coinType} for ${record.address}`
  );
}

function renderSimulationObjectChanges(records: TransactionSimulationObjectChange[] | undefined): HTMLElement {
  return renderKnownRecordList(
    "Object changes",
    records,
    (record) => {
      return `${record.objectId}${record.objectType ? ` (${record.objectType})` : ""}: ${record.inputState} -> ${record.outputState}, ${record.idOperation}`;
    }
  );
}

function renderKnownRecordList<T>(
  label: string,
  records: T[] | undefined,
  format: (record: T) => string
): HTMLElement {
  if (!records || records.length === 0) {
    return renderFactList(label, ["None recorded."]);
  }
  return renderFactList(label, records.map(format));
}

function renderPtbVisualization(artifact: PtbVisualizationArtifact): HTMLElement {
  const wrapper = subSection("PTB visualization", [
    row("Generated at", artifact.generatedAt),
    row("Source", `${artifact.source.adapterId} ${artifact.source.sourceKind}`)
  ]);
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
  const text = artifact.mermaid.namedText || artifact.mermaid.text;
  ptbRenderSequence += 1;
  void mermaid
    .render(`review-execution-analysis-ptb-${ptbRenderSequence}`, text)
    .then((rendered) => {
      graph.innerHTML = rendered.svg;
    })
    .catch((error: unknown) => {
      graph.classList.add("error");
      graph.textContent = `PTB graph rendering failed: ${error instanceof Error ? error.message : String(error)}`;
    });
  if (artifact.diagnostics.length > 0) {
    wrapper.append(
      renderFactList(
        "Renderer diagnostics",
        artifact.diagnostics.map((entry) => `${entry.severity} ${entry.code}: ${entry.message}`)
      )
    );
  }
  if (artifact.unsupportedUse.length > 0) {
    wrapper.append(renderFactList("Visualization limits", artifact.unsupportedUse));
  }
  return wrapper;
}

function renderChecks(checks: GuardianCheck[]): HTMLElement {
  if (checks.length === 0) {
    return renderFactList("Review checks", ["No checks were recorded."]);
  }
  const wrapper = subSection("Review checks", []);
  for (const check of checks) {
    const item = document.createElement("div");
    item.className = `check ${check.status}`;
    item.append(
      element("strong", undefined, `${check.label} (${check.status})`),
      element("small", undefined, `${check.source}: ${check.message}`)
    );
    wrapper.append(item);
  }
  return wrapper;
}

function renderFactList(title: string, items: string[]): HTMLElement {
  const wrapper = subSection(title, []);
  const list = document.createElement("ul");
  for (const item of items.length > 0 ? items : ["None recorded."]) {
    const entry = document.createElement("li");
    entry.textContent = item;
    list.append(entry);
  }
  wrapper.append(list);
  return wrapper;
}

function section(title: string, children: HTMLElement[]): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "section";
  wrapper.append(element("h2", undefined, title), ...children);
  return wrapper;
}

function subSection(title: string, children: HTMLElement[]): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "subsection";
  wrapper.append(element("h3", undefined, title), ...children);
  return wrapper;
}

function row(label: string, value: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "row";
  wrapper.append(element("span", "row-label", label), element("span", "row-value", value));
  return wrapper;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string | undefined,
  text: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  node.textContent = text;
  return node;
}

async function requestJson<T = unknown>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "x-say-ur-intent-token": token
    }
  });
  if (!response.ok) {
    throw new HttpJsonRequestError(response.status, await errorCodeFromResponse(response));
  }
  return (await response.json()) as T;
}
