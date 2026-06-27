import { describe, expect, it } from "vitest";
import { formatWalletAssetRow } from "../review-app/src/walletAssetRow.js";

describe("wallet asset row formatting", () => {
  it("reads the real summarizeWalletAssets entry shape (display amount + symbol)", () => {
    const entry = {
      balance: "1180514208",
      coinType: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
      unit: { status: "available", decimals: 9, symbol: "SUI", name: "Sui" },
      display: { amount: "1.180514208", symbol: "SUI", source: "raw_balance_with_verified_decimals" }
    };
    expect(formatWalletAssetRow(entry)).toEqual({ symbol: "SUI", detail: "1.180514208" });
  });

  it("falls back to the raw balance and a derived symbol when the unit is unavailable", () => {
    const entry = {
      balance: "4344929000",
      coinType: "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL",
      unit: { status: "unavailable", reason: "coin_metadata_unavailable" }
    };
    expect(formatWalletAssetRow(entry)).toEqual({ symbol: "WAL", detail: "raw 4344929000" });
  });

  it("prefers the unit symbol when there is no display block", () => {
    const entry = { balance: "5", coinType: "0xabc::foo::FOO", unit: { status: "available", symbol: "FOOBAR" } };
    expect(formatWalletAssetRow(entry)).toEqual({ symbol: "FOOBAR", detail: "raw 5" });
  });

  it("reports amount unavailable when neither a display amount nor a raw balance is present", () => {
    expect(formatWalletAssetRow({ coinType: "0xabc::foo::FOO" })).toEqual({
      symbol: "FOO",
      detail: "amount unavailable"
    });
  });

  it("uses a generic label when even the coin type is missing", () => {
    expect(formatWalletAssetRow({ balance: "9" })).toEqual({ symbol: "(unknown coin)", detail: "raw 9" });
  });

  it("returns null for non-object entries", () => {
    expect(formatWalletAssetRow(null)).toBeNull();
    expect(formatWalletAssetRow("SUI")).toBeNull();
    expect(formatWalletAssetRow(42)).toBeNull();
  });
});
