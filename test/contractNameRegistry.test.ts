import { mainnetPackageIds } from "@mysten/deepbook-v3";
import { describe, expect, it } from "vitest";
import { applyContractNamesToMermaid } from "../src/core/action/contractNameRegistry.js";

describe("applyContractNamesToMermaid", () => {
  it("relabels a registered package, leaving unregistered packages and node ids untouched", () => {
    const registered = mainnetPackageIds.DEEPBOOK_PACKAGE_ID;
    const unregistered = `0x${"a".repeat(64)}`;
    const text = [
      "flowchart LR",
      `  command0["0: MoveCall ${registered}::pool::swap_exact_base_for_quote"]`,
      `  command1["1: MoveCall ${unregistered}::other::call"]`,
      ""
    ].join("\n");

    const out = applyContractNamesToMermaid(text);

    // The registered package address is replaced by its name; the name's "@" is
    // written as the Mermaid "#64;" entity so it renders as "@" without a literal
    // "@", which Mermaid v11 reads as node metadata and crashes on.
    expect(out).toContain("#64;deepbook/core::pool::swap_exact_base_for_quote");
    expect(out).not.toContain("@");
    expect(out).not.toContain(registered);
    // Unregistered packages keep their raw address.
    expect(out).toContain(`${unregistered}::other::call`);
    // Synthetic node ids are untouched, so the graph syntax stays valid.
    expect(out).toContain('command0["');
    expect(out).toContain('command1["');
  });
});
