import { formatWalletAssetRow, type WalletAssetRow } from "./walletAssetRow.js";
import { asRecord } from "./parse.js";

// Escape a value for a Markdown table cell: on-chain coin/object metadata is
// untrusted, so a stray pipe or newline must not break the table structure.
function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

// Serialize a public account snapshot (SuiNS name, coin balances, NFTs, and other
// owned objects) to Markdown for copy/paste. Pure: no DOM and no i18n, so the
// export is stable and directly testable. Structural labels are fixed English; the
// data (address, amounts, symbols, types) carries the meaning.
export function accountSnapshotToMarkdown(address: string, payload: Record<string, unknown>): string {
  const lines: string[] = ["## Account snapshot", "", `- Address: \`${address}\``];
  const name = typeof payload.name === "string" && payload.name.length > 0 ? payload.name : undefined;
  if (name) {
    lines.push(`- SuiNS name: ${cell(name)}`);
  }
  const fetchedAt = typeof payload.fetchedAt === "string" ? payload.fetchedAt : undefined;
  if (fetchedAt) {
    lines.push(`- Checked at: ${fetchedAt}`);
  }

  // Balances. Object = held as owned Coin objects; Account = held as an
  // address/account balance (the accumulator fast-path); Total = their sum. A dash
  // marks a breakdown the server could not provide (unknown coin decimals).
  const balances = Array.isArray(payload.balances) ? payload.balances : [];
  const rows = balances.map((entry) => formatWalletAssetRow(entry)).filter((row): row is WalletAssetRow => row !== null);
  lines.push("", "### Balances", "");
  if (rows.length === 0) {
    lines.push("No coin balances in this snapshot.");
  } else {
    lines.push("| Asset | Object | Account | Total |", "| --- | --- | --- | --- |");
    for (const row of rows) {
      lines.push(`| ${cell(row.symbol)} | ${cell(row.object ?? "—")} | ${cell(row.account ?? "—")} | ${cell(row.total)} |`);
    }
  }

  // NFTs (owned objects carrying a Display name).
  const nfts = Array.isArray(payload.nfts) ? payload.nfts : [];
  lines.push("", "### NFTs", "");
  if (nfts.length === 0) {
    lines.push("No NFTs in the scanned objects.");
  } else {
    for (const raw of nfts) {
      const nft = asRecord(raw);
      if (!nft) {
        continue;
      }
      const label =
        typeof nft.name === "string" && nft.name.length > 0
          ? nft.name
          : typeof nft.type === "string"
            ? nft.type
            : "object";
      const objectId = typeof nft.objectId === "string" ? nft.objectId : "";
      lines.push(`- ${cell(label)}${objectId ? ` (\`${objectId}\`)` : ""}`);
    }
  }

  // Other owned objects, grouped by Move type.
  const groups = Array.isArray(payload.objectGroups) ? payload.objectGroups : [];
  lines.push("", "### Other objects", "");
  if (groups.length === 0) {
    lines.push("No other objects in the scanned range.");
  } else {
    lines.push("| Type | Count |", "| --- | --- |");
    for (const raw of groups) {
      const group = asRecord(raw);
      if (!group) {
        continue;
      }
      const type = typeof group.type === "string" ? group.type : "";
      const count = typeof group.count === "number" ? group.count : 0;
      lines.push(`| ${cell(type)} | ${count} |`);
    }
  }
  if (payload.objectsTruncated === true) {
    lines.push("", "_Some objects beyond the scanned range are omitted._");
  }
  return lines.join("\n");
}
