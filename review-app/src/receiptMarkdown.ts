import type {
  PublicChainReceipt,
  PublicChainReceiptBalanceChange,
  PublicChainReceiptInput
} from "../../src/core/action/suiChainReceiptReader.js";
import { mistToSui, signedRawToDisplay } from "./format.js";

// Fixed English labels for Markdown export. Export labels are deliberately
// independent of the i18n display copy so the serialized record is stable and
// testable regardless of the page locale.
const INPUT_KIND_LABELS: Record<PublicChainReceiptInput["kind"], string> = {
  object: "Owned object",
  shared_object: "Shared object",
  receiving: "Receiving object",
  pure: "Pure value",
  withdrawal: "Balance withdrawal",
  unknown: "Input"
};

// Serialize public on-chain receipt facts to Markdown for copy/paste. Pure: no
// DOM, no i18n. It mirrors exactly what the receipt page renders (status, meta,
// balance changes with decimals, gas, the PTB graph source, Move calls, inputs,
// object changes, events) and adds no verdict or evidence.
export function receiptToMarkdown(digest: string, receipt: PublicChainReceipt): string {
  const lines: string[] = ["## Receipt", "", `- Digest: \`${digest}\``];
  lines.push(`- Execution status: ${receipt.effectsStatus.success ? "success" : "failure"}`);
  if (!receipt.effectsStatus.success && receipt.effectsStatus.errorMessage) {
    lines.push(`- Error: ${receipt.effectsStatus.errorMessage}`);
  }
  if (receipt.sender) {
    lines.push(`- Sender: \`${receipt.sender}\``);
  }

  lines.push("", "### Balance changes");
  if (receipt.balanceChanges.length === 0) {
    lines.push("No balance changes were recorded.");
  } else {
    for (const change of receipt.balanceChanges) {
      lines.push(balanceChangeLine(change));
    }
  }

  lines.push("", "### Gas");
  const gas = receipt.gas;
  lines.push(`- Total fee: ${mistToSui(gas.totalMist)} SUI (${gas.totalMist} mist)`);
  lines.push(`- Computation: ${mistToSui(gas.computationMist)} SUI`);
  lines.push(`- Storage: ${mistToSui(gas.storageMist)} SUI`);
  lines.push(`- Storage rebate: ${mistToSui(gas.storageRebateMist)} SUI`);
  if (gas.budgetMist !== undefined) {
    lines.push(`- Budget: ${mistToSui(gas.budgetMist)} SUI`);
  }
  if (gas.priceMist !== undefined) {
    lines.push(`- Price: ${gas.priceMist} MIST`);
  }
  if (gas.paymentObjectId !== undefined) {
    lines.push(`- Payment object: \`${gas.paymentObjectId}\``);
  }

  if (receipt.ptbGraph) {
    lines.push("", "### Transaction graph", "```mermaid", receipt.ptbGraph.mermaid, "```");
  }

  lines.push("", "### Inputs");
  if (receipt.inputs.length === 0) {
    lines.push("No inputs were recorded.");
  } else {
    for (const inputEntry of receipt.inputs) {
      const label = INPUT_KIND_LABELS[inputEntry.kind];
      const detail = inputEntry.objectId ?? inputEntry.bytes;
      lines.push(detail ? `- ${label}: \`${detail}\`` : `- ${label}`);
    }
  }

  lines.push("", "### Move calls");
  if (receipt.packageCalls.length === 0) {
    lines.push("No Move calls were recorded.");
  } else {
    for (const call of receipt.packageCalls) {
      lines.push(`- \`${call.target}\``);
    }
  }

  lines.push("", "### Object changes");
  const objectEntries = Object.entries(receipt.objectTypes);
  if (objectEntries.length === 0) {
    lines.push("No object changes were recorded.");
  } else {
    for (const [objectId, objectType] of objectEntries) {
      lines.push(`- \`${objectId}\`: ${objectType}`);
    }
  }

  lines.push("", "### Events");
  if (receipt.events.length === 0) {
    lines.push("No events were recorded.");
  } else {
    for (const event of receipt.events) {
      lines.push(`- \`${event.eventType}\``);
    }
  }

  return lines.join("\n");
}

function balanceChangeLine(change: PublicChainReceiptBalanceChange): string {
  if (change.decimals !== undefined) {
    const display = signedRawToDisplay(change.amountRaw, change.decimals);
    const amount = change.symbol ? `${display} ${change.symbol}` : display;
    return `- \`${change.address}\`: ${amount} (${change.amountRaw} raw, ${change.coinType})`;
  }
  return `- \`${change.address}\`: ${change.amountRaw} ${change.coinType}`;
}
