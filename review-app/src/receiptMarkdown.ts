import type { PublicChainReceipt } from "../../src/core/action/suiChainReceiptReader.js";

// Serialize public on-chain receipt facts to Markdown for copy/paste. Pure: no
// DOM, no i18n. It mirrors exactly what the receipt page renders (status, sender,
// balance changes, Move calls, object changes) and adds no verdict or evidence.
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
      lines.push(`- \`${change.address}\`: ${change.amountRaw} ${change.coinType}`);
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

  return lines.join("\n");
}
