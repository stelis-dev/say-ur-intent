import { mainnetPackageIds } from "@mysten/deepbook-v3";
import {
  MOVE_STDLIB_ADDRESS,
  normalizeSuiAddress,
  SUI_CLOCK_OBJECT_ID,
  SUI_FRAMEWORK_ADDRESS,
  SUI_SYSTEM_STATE_OBJECT_ID
} from "@mysten/sui/utils";
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

  it("relabels Sui framework packages and well-known system objects from pinned SDK constants", () => {
    const text = [
      "flowchart LR",
      `  command0["0: MoveCall ${SUI_FRAMEWORK_ADDRESS}::coin::zero"]`,
      `  command5["5: MoveCall ${MOVE_STDLIB_ADDRESS}::option::none"]`,
      `  input2["Input 2: Object (Shared)<br/>${SUI_CLOCK_OBJECT_ID} immutable"]`,
      `  input9["Input 9: Object (Shared)<br/>${SUI_SYSTEM_STATE_OBJECT_ID}"]`,
      `  input10["Input 10: Object (Shared)<br/>${normalizeSuiAddress("0xacc")} mutable"]`,
      ""
    ].join("\n");

    const out = applyContractNamesToMermaid(text);

    // Framework packages show their canonical Move aliases; system objects show
    // their object type. Display labels only.
    expect(out).toContain("MoveCall sui::coin::zero");
    expect(out).toContain("MoveCall std::option::none");
    expect(out).toContain("Clock immutable");
    expect(out).toContain("SuiSystemState");
    expect(out).toContain("AccumulatorRoot mutable");
    // The raw framework addresses are gone from the named graph.
    expect(out).not.toContain(SUI_FRAMEWORK_ADDRESS);
    expect(out).not.toContain(MOVE_STDLIB_ADDRESS);
    expect(out).not.toContain(SUI_CLOCK_OBJECT_ID);
  });

  it("anchors matching by context: a package only in a path, an object only as a bare id", () => {
    // A package address that is not a "::" path prefix (here a bare object slot)
    // is left raw, so a package label never leaks into a bare-id position.
    const barePackage = `input0["Input 0: Object (Owned)<br/>${SUI_FRAMEWORK_ADDRESS}"]`;
    expect(applyContractNamesToMermaid(barePackage)).toContain(SUI_FRAMEWORK_ADDRESS);

    // An object id that appears as a "::" path prefix is left raw, so an object
    // label never leaks into a package path.
    const objectInPath = `command0["0: MoveCall ${SUI_CLOCK_OBJECT_ID}::weird::call"]`;
    expect(applyContractNamesToMermaid(objectInPath)).toContain(`${SUI_CLOCK_OBJECT_ID}::weird::call`);
  });
});
