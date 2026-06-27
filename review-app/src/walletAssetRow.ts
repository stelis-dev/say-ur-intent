// Reads one wallet-asset balance entry from the public assets endpoint into a
// display row. The shape is the server's summarizeWalletAssets output
// (balances[].{coinType, balance, unit, display}). This reader is the single,
// tested place that depends on that contract, so a shape mismatch surfaces here
// and in its test rather than as "(unknown symbol)" on the page.
export type WalletAssetRow = { symbol: string; detail: string };

export function formatWalletAssetRow(entry: unknown): WalletAssetRow | null {
  const row = asRecord(entry);
  if (!row) {
    return null;
  }
  const display = asRecord(row.display);
  const unit = asRecord(row.unit);
  const symbol =
    asString(display?.symbol) ??
    asString(unit?.symbol) ??
    shortenCoinType(asString(row.coinType)) ??
    "(unknown coin)";
  const amount = asString(display?.amount);
  if (amount !== undefined) {
    return { symbol, detail: amount };
  }
  const raw = asString(row.balance);
  return { symbol, detail: raw !== undefined ? `raw ${raw}` : "amount unavailable" };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function shortenCoinType(coinType: string | undefined): string | undefined {
  if (!coinType) {
    return undefined;
  }
  const parts = coinType.split("::");
  return parts[parts.length - 1] || coinType;
}
