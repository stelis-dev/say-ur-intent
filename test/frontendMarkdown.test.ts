import { describe, expect, it } from "vitest";
import { accountSnapshotToMarkdown } from "../review-app/src/accountMarkdown.js";
import { receiptToMarkdown } from "../review-app/src/receiptMarkdown.js";
import type { PublicChainReceipt } from "../src/core/action/suiChainReceiptReader.js";

const ADDRESS = `0x${"a".repeat(64)}`;

describe("accountSnapshotToMarkdown", () => {
  it("renders the address, name, balances, NFTs, and other-object sections", () => {
    const markdown = accountSnapshotToMarkdown(ADDRESS, {
      name: "alice.sui",
      fetchedAt: "2026-06-28T00:00:00.000Z",
      balances: [
        {
          coinType: "0x2::sui::SUI",
          balance: "1500000000",
          coinBalance: "1500000000",
          addressBalance: "0",
          unit: { decimals: 9, symbol: "SUI" },
          display: { amount: "1.5", symbol: "SUI" }
        }
      ],
      nfts: [{ objectId: "0xnft1", type: "0xabc::art::Piece", name: "Cool NFT", imageUrl: "https://x/y.png" }],
      objectGroups: [{ type: "0xabc::game::Sword", count: 2 }]
    });

    expect(markdown).toBe(
      [
        "## Account snapshot",
        "",
        `- Address: \`${ADDRESS}\``,
        "- SuiNS name: alice.sui",
        "- Checked at: 2026-06-28T00:00:00.000Z",
        "",
        "### Balances",
        "",
        "| Asset | Object | Account | Total |",
        "| --- | --- | --- | --- |",
        "| SUI | 1.5 | 0 | 1.5 |",
        "",
        "### NFTs",
        "",
        "- Cool NFT (`0xnft1`)",
        "",
        "### Other objects",
        "",
        "| Type | Count |",
        "| --- | --- |",
        "| 0xabc::game::Sword | 2 |"
      ].join("\n")
    );
  });

  it("states explicit empties for each section and omits an absent name", () => {
    const markdown = accountSnapshotToMarkdown(ADDRESS, {
      fetchedAt: "2026-06-28T00:00:00.000Z",
      balances: [],
      nfts: [],
      objectGroups: []
    });
    expect(markdown).toContain("No coin balances in this snapshot.");
    expect(markdown).toContain("No NFTs in the scanned objects.");
    expect(markdown).toContain("No other objects in the scanned range.");
    expect(markdown).not.toContain("SuiNS name");
    expect(markdown).not.toContain("| Asset |");
  });

  it("escapes pipes in untrusted metadata and notes a truncated object scan", () => {
    const markdown = accountSnapshotToMarkdown(ADDRESS, {
      balances: [{ coinType: "0xc::x::Y", balance: "1", unit: {}, display: { amount: "1", symbol: "A|B" } }],
      nfts: [],
      objectGroups: [{ type: "0xp::m::T|X", count: 1 }],
      objectsTruncated: true
    });
    expect(markdown).toContain("| A\\|B | — | — | 1 |");
    expect(markdown).toContain("| 0xp::m::T\\|X | 1 |");
    expect(markdown).toContain("_Some objects beyond the scanned range are omitted._");
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
    gas: {
      totalMist: "1000",
      computationMist: "1000",
      storageMist: "0",
      storageRebateMist: "0",
      nonRefundableStorageMist: "0",
      budgetMist: "2000",
      priceMist: "1",
      paymentObjectId: `0x${"5".repeat(64)}`
    },
    inputs: [],
    events: [],
    ptbGraph: undefined,
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

  it("renders gas, a decimals balance line, inputs, events, and the PTB graph source", () => {
    const markdown = receiptToMarkdown("DiGeStAbC123", {
      ...baseReceipt,
      balanceChanges: [
        {
          index: 0,
          address: `0x${"3".repeat(64)}`,
          coinType: "0x2::sui::SUI",
          amountRaw: "-218883618256",
          direction: "decrease",
          decimals: 9,
          symbol: "SUI"
        }
      ],
      inputs: [
        { index: 0, kind: "shared_object", objectId: `0x${"a".repeat(64)}` },
        { index: 1, kind: "pure", objectId: undefined, bytes: "0x98c276f632000000" }
      ],
      events: [
        {
          index: 0,
          packageId: `0x${"2".repeat(64)}`,
          module: "pool",
          eventType: `0x${"2".repeat(64)}::pool::SwapEvent`,
          sender: `0x${"1".repeat(64)}`
        }
      ],
      ptbGraph: { mermaid: "flowchart LR\n  A-->B" }
    });
    // The decimals line shows the formatted amount and keeps the raw + coinType.
    expect(markdown).toContain(`- \`0x${"3".repeat(64)}\`: -218.883618256 SUI (-218883618256 raw, 0x2::sui::SUI)`);
    // Gas in SUI, with the raw mist on the total.
    expect(markdown).toContain("### Gas");
    expect(markdown).toContain("- Total fee: 0.000001 SUI (1000 mist)");
    expect(markdown).toContain("- Price: 1 MIST");
    expect(markdown).toContain(`- Payment object: \`0x${"5".repeat(64)}\``);
    // Inputs with fixed English labels (independent of i18n display copy).
    expect(markdown).toContain("### Inputs");
    expect(markdown).toContain(`- Shared object: \`0x${"a".repeat(64)}\``);
    expect(markdown).toContain("- Pure value: `0x98c276f632000000`");
    // Events.
    expect(markdown).toContain("### Events");
    expect(markdown).toContain(`- \`0x${"2".repeat(64)}::pool::SwapEvent\``);
    // The PTB graph source as a fenced mermaid block.
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("flowchart LR");
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
