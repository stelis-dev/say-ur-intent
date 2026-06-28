import { formatWalletAssetRow, type WalletAssetRow } from "./walletAssetRow.js";

// Escape a value for a Markdown table cell: on-chain coin metadata is untrusted,
// so a stray pipe or newline must not break the table structure.
function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

// Serialize a public asset snapshot to Markdown for copy/paste. Pure: no DOM and
// no i18n, so the export is stable and directly testable. Structural labels are
// fixed English; the data (address, amounts, symbols) carries the meaning.
export function assetSnapshotToMarkdown(address: string, payload: Record<string, unknown>): string {
  const lines: string[] = ["## Asset snapshot", "", `- Address: \`${address}\``];
  const fetchedAt = typeof payload.fetchedAt === "string" ? payload.fetchedAt : undefined;
  if (fetchedAt) {
    lines.push(`- Checked at: ${fetchedAt}`);
  }
  lines.push("");

  const balances = Array.isArray(payload.balances) ? payload.balances : [];
  const rows = balances
    .map((entry) => formatWalletAssetRow(entry))
    .filter((row): row is WalletAssetRow => row !== null);

  if (rows.length === 0) {
    lines.push("No coin balances in this snapshot.");
  } else {
    lines.push("| Asset | Amount |", "| --- | --- |");
    for (const row of rows) {
      lines.push(`| ${cell(row.symbol)} | ${cell(row.detail)} |`);
    }
  }
  return lines.join("\n");
}
