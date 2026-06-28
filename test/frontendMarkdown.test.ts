import { describe, expect, it } from "vitest";
import { assetSnapshotToMarkdown } from "../review-app/src/analyticsMarkdown.js";
import { receiptToMarkdown } from "../review-app/src/receiptMarkdown.js";
import type { PublicChainReceipt } from "../src/core/action/suiChainReceiptReader.js";

const ADDRESS = `0x${"a".repeat(64)}`;

describe("assetSnapshotToMarkdown", () => {
  it("renders the address, checked-at, and a balances table from display fields", () => {
    const markdown = assetSnapshotToMarkdown(ADDRESS, {
      fetchedAt: "2026-06-28T00:00:00.000Z",
      balances: [
        { coinType: "0x2::sui::SUI", balance: "1500000000", unit: { symbol: "SUI" }, display: { amount: "1.5", symbol: "SUI" } },
        { coinType: "0xb::usdc::USDC", balance: "5000000", unit: { symbol: "USDC" }, display: { amount: "5.00", symbol: "USDC" } }
      ]
    });

    expect(markdown).toBe(
      [
        "## Asset snapshot",
        "",
        `- Address: \`${ADDRESS}\``,
        "- Checked at: 2026-06-28T00:00:00.000Z",
        "",
        "| Asset | Amount |",
        "| --- | --- |",
        "| SUI | 1.5 |",
        "| USDC | 5.00 |"
      ].join("\n")
    );
  });

  it("states explicitly when a snapshot has no coin balances", () => {
    const markdown = assetSnapshotToMarkdown(ADDRESS, { fetchedAt: "2026-06-28T00:00:00.000Z", balances: [] });
    expect(markdown).toContain("No coin balances in this snapshot.");
    expect(markdown).not.toContain("| Asset | Amount |");
  });

  it("escapes a pipe in untrusted coin metadata so the table cannot break", () => {
    const markdown = assetSnapshotToMarkdown(ADDRESS, {
      balances: [{ coinType: "0xc::x::Y", balance: "1", unit: {}, display: { amount: "1", symbol: "A|B" } }]
    });
    expect(markdown).toContain("| A\\|B | 1 |");
    // Omitting fetchedAt drops the checked-at line rather than printing "undefined".
    expect(markdown).not.toContain("Checked at");
  });
});

describe("receiptToMarkdown", () => {
  const baseReceipt: PublicChainReceipt = {
    txDigest: "DiGeStAbC123",
    sender: `0x${"1".repeat(64)}`,
    effectsStatus: { success: true },
    packageCalls: [
      { commandIndex: 0, packageId: `0x${"2".repeat(64)}`, module: "pool", function: "swap", target: `0x${"2".repeat(64)}::pool::swap` }
    ],
    balanceChanges: [
      { index: 0, address: `0x${"3".repeat(64)}`, coinType: "0x2::sui::SUI", amountRaw: "-1000", direction: "decrease" }
    ],
    objectTypes: { [`0x${"4".repeat(64)}`]: "0x2::coin::Coin<0x2::sui::SUI>" },
    chainIdentifier: "35834a8a",
    fetchedAt: "2026-06-28T00:00:00.000Z"
  };

  it("renders status, sender, balance changes, Move calls, and object changes", () => {
    const markdown = receiptToMarkdown("DiGeStAbC123", baseReceipt);
    expect(markdown).toContain("- Digest: `DiGeStAbC123`");
    expect(markdown).toContain("- Execution status: success");
    expect(markdown).toContain(`- Sender: \`${baseReceipt.sender}\``);
    expect(markdown).toContain("### Balance changes");
    expect(markdown).toContain(`- \`${baseReceipt.balanceChanges[0]!.address}\`: -1000 0x2::sui::SUI`);
    expect(markdown).toContain("### Move calls");
    expect(markdown).toContain(`- \`0x${"2".repeat(64)}::pool::swap\``);
    expect(markdown).toContain("### Object changes");
    expect(markdown).toContain("0x2::coin::Coin<0x2::sui::SUI>");
  });

  it("shows the failure status and error message", () => {
    const markdown = receiptToMarkdown("DiGeStAbC123", {
      ...baseReceipt,
      effectsStatus: { success: false, errorMessage: "MoveAbort(code 7)" }
    });
    expect(markdown).toContain("- Execution status: failure");
    expect(markdown).toContain("- Error: MoveAbort(code 7)");
  });

  it("records explicit empties instead of dropping sections", () => {
    const markdown = receiptToMarkdown("DiGeStAbC123", {
      ...baseReceipt,
      sender: undefined,
      packageCalls: [],
      balanceChanges: [],
      objectTypes: {}
    });
    expect(markdown).toContain("No balance changes were recorded.");
    expect(markdown).toContain("No Move calls were recorded.");
    expect(markdown).toContain("No object changes were recorded.");
    expect(markdown).not.toContain("- Sender:");
  });
});
