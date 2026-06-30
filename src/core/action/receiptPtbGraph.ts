import { rawTransactionToIR, transactionIRToMermaid } from "@zktx.io/ptb-model";
import { applyContractNamesToMermaid } from "./contractNameRegistry.js";

// Produce a left-to-right PTB Mermaid graph for a PUBLIC receipt straight from the
// already-fetched on-chain transaction's inputs and commands. Unlike the
// signing-flow `producePtbVisualizationArtifact`, this needs no stored material and
// no digest commitment — the transaction is the chain's own record, read by digest.
// It uses the same `@zktx.io/ptb-model` pipeline (LR, matching the review page), so
// the receipt graph and the review graph render identically.
//
// The same contract name registry the review graph uses is applied here, so
// registered packages/objects show their display name (@deepbook/core, Clock, …)
// and every other long address is shortened for the graph; the full ids stay in
// the receipt's Inputs / Move calls / Object changes sections and Markdown.
//
// Returns undefined when the model cannot render the transaction (e.g. a
// non-programmable system transaction); the page then shows a placeholder card in
// the same slot rather than collapsing the layout.
export function receiptPtbMermaid(
  transactionData: { inputs: unknown; commands: unknown }
): { text: string; namedText: string } | undefined {
  try {
    const ir = rawTransactionToIR({ inputs: transactionData.inputs, commands: transactionData.commands });
    // Emit both the raw-address graph and the registry-named graph so the receipt and
    // the review render the same toggleable graph through the shared component.
    const text = transactionIRToMermaid(ir, { direction: "LR" });
    return text.trim().length > 0 ? { text, namedText: applyContractNamesToMermaid(text) } : undefined;
  } catch {
    return undefined;
  }
}
