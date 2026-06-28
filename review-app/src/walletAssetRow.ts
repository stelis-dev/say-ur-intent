// Reads one wallet-asset balance entry from the public assets endpoint into a
// display row. The shape is the server's summarizeWalletAssets output
// (balances[].{coinType, balance, coinBalance, addressBalance, unit, display}).
// This reader is the single, tested place that depends on that contract, so a
// shape mismatch surfaces here and in its test rather than as "(unknown symbol)"
// on the page.
//
// `total` is the coin's full balance. `object` and `account` split that total by
// how it is held — as owned Coin objects (coinBalance) versus an address/account
// balance (addressBalance, the accumulator fast-path). They are present only when
// the coin decimals are known, so the split can be formatted as a decimal rather
// than shown as a misleading raw integer.
import { rawToDisplay } from "./format.js";
import { asRecord, asString } from "./parse.js";

export type WalletAssetRow = {
  symbol: string;
  total: string;
  object: string | undefined;
  account: string | undefined;
};

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
  const decimals = typeof unit?.decimals === "number" ? unit.decimals : undefined;

  // Total prefers the server-formatted display amount; otherwise format the raw
  // balance with known decimals, else keep the raw integer with a marker.
  const displayAmount = asString(display?.amount);
  const rawBalance = asString(row.balance);
  let total: string;
  if (displayAmount !== undefined) {
    total = displayAmount;
  } else if (rawBalance !== undefined) {
    total = (decimals !== undefined ? safeFormat(rawBalance, decimals) : undefined) ?? `raw ${rawBalance}`;
  } else {
    total = "amount unavailable";
  }

  // The held-as breakdown is only meaningful when we can format it; without
  // decimals, raw integers for object/account would mislead, so omit them.
  let object: string | undefined;
  let account: string | undefined;
  if (decimals !== undefined) {
    const coinBalance = asString(row.coinBalance);
    const addressBalance = asString(row.addressBalance);
    object = coinBalance !== undefined ? safeFormat(coinBalance, decimals) : undefined;
    account = addressBalance !== undefined ? safeFormat(addressBalance, decimals) : undefined;
  }

  return { symbol, total, object, account };
}

// Format a raw integer amount, returning undefined for a non-integer string so a
// malformed on-chain value degrades instead of throwing through the whole render.
function safeFormat(raw: string, decimals: number): string | undefined {
  try {
    return rawToDisplay(raw, decimals);
  } catch {
    return undefined;
  }
}

function shortenCoinType(coinType: string | undefined): string | undefined {
  if (!coinType) {
    return undefined;
  }
  const parts = coinType.split("::");
  return parts[parts.length - 1] || coinType;
}
