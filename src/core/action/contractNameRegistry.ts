import { mainnetPackageIds } from "@mysten/deepbook-v3";
import {
  MOVE_STDLIB_ADDRESS,
  normalizeSuiAddress,
  SUI_CLOCK_OBJECT_ID,
  SUI_COIN_REGISTRY_OBJECT_ID,
  SUI_DENY_LIST_OBJECT_ID,
  SUI_FRAMEWORK_ADDRESS,
  SUI_RANDOM_OBJECT_ID,
  SUI_SYSTEM_ADDRESS,
  SUI_SYSTEM_STATE_OBJECT_ID
} from "@mysten/sui/utils";
import { DEEPBOOK_SOURCE_FIELD_VALUES } from "../read/deepbookSourceOwners.js";

/**
 * Pinned name registries for review-time PTB display labels.
 *
 * A PTB graph shows two distinct kinds of address, matched in two distinct
 * contexts, so they are kept as two registries:
 *
 *  - {@link PACKAGE_NAME_REGISTRY} — packages, which appear as a MoveCall target
 *    or type path (`<address>::module::name`). Relabeled only in that path
 *    position. DeepBook is labeled by its Move Registry (MVR) name
 *    `@deepbook/core`; the Sui framework packages by their canonical Move aliases
 *    (`std` = 0x1, `sui` = 0x2, `sui_system` = 0x3).
 *  - {@link OBJECT_NAME_REGISTRY} — well-known shared system objects, which appear
 *    as an object input (a bare object id). Relabeled only as a bare id, by their
 *    object type (`SuiSystemState` = 0x5, `Clock` = 0x6, `Random` = 0x8,
 *    `DenyList` = 0x403, `CoinRegistry` = 0xc, `AccumulatorRoot` = 0xacc — the
 *    root for address-based balances).
 *
 * The label is display only: only registered addresses are relabeled, anything
 * unregistered is shortened for the display graph, and the full raw address stays
 * available in the artifact (the review page toggles back to addresses and the
 * copyable Mermaid source keeps full raw addresses). A label is address identity,
 * not a safety, trust, or signing-readiness signal.
 *
 * Every address comes from a pinned SDK constant rather than a hard-coded literal:
 * DeepBook from `@mysten/deepbook-v3` `mainnetPackageIds.DEEPBOOK_PACKAGE_ID` (the
 * same constant the swap MoveCall targets) and the framework/system addresses from
 * `@mysten/sui/utils`. The one exception is the accumulator root (`0xacc`), which
 * `@mysten/sui` currently defines only internally (not an exported constant); it
 * is written as `normalizeSuiAddress("0xacc")`, exactly as the SDK does. The
 * `@deepbook/core` MVR name is confirmed by live review after deploy; the
 * framework labels are Sui genesis constants.
 */

export type ContractNameEntry = {
  /** Mainnet package or well-known object address. */
  readonly address: string;
  /** Human-readable display label (MVR name, Move alias, or object type). */
  readonly name: string;
  /** Provenance of the entry. */
  readonly source: string;
};

/** Packages, relabeled only where they appear as a `<address>::...` path. */
export const PACKAGE_NAME_REGISTRY: readonly ContractNameEntry[] = [
  {
    address: mainnetPackageIds.DEEPBOOK_PACKAGE_ID,
    name: "@deepbook/core",
    source: DEEPBOOK_SOURCE_FIELD_VALUES.sdkMainnetPackageId
  },
  {
    address: MOVE_STDLIB_ADDRESS,
    name: "std",
    source: "sui_sdk_move_stdlib_address"
  },
  {
    address: SUI_FRAMEWORK_ADDRESS,
    name: "sui",
    source: "sui_sdk_framework_address"
  },
  {
    address: SUI_SYSTEM_ADDRESS,
    name: "sui_system",
    source: "sui_sdk_system_address"
  }
];

/** Well-known shared system objects, relabeled only as a bare object id. */
export const OBJECT_NAME_REGISTRY: readonly ContractNameEntry[] = [
  {
    address: SUI_SYSTEM_STATE_OBJECT_ID,
    name: "SuiSystemState",
    source: "sui_sdk_system_state_object_id"
  },
  {
    address: SUI_CLOCK_OBJECT_ID,
    name: "Clock",
    source: "sui_sdk_clock_object_id"
  },
  {
    address: SUI_RANDOM_OBJECT_ID,
    name: "Random",
    source: "sui_sdk_random_object_id"
  },
  {
    address: SUI_DENY_LIST_OBJECT_ID,
    name: "DenyList",
    source: "sui_sdk_deny_list_object_id"
  },
  {
    address: SUI_COIN_REGISTRY_OBJECT_ID,
    name: "CoinRegistry",
    source: "sui_sdk_coin_registry_object_id"
  },
  {
    // Address-based balances (coin reservation / fast path) reference the
    // accumulator root object. @mysten/sui defines this id only internally as
    // normalizeSuiAddress("0xacc") (not an exported constant), so mirror it here.
    address: normalizeSuiAddress("0xacc"),
    name: "AccumulatorRoot",
    source: "sui_accumulator_root_object_id_0xacc"
  }
];

/**
 * Normalize a Sui address or package id to `0x` + 64 lowercase hex, or return
 * undefined when the input is not a well-formed Sui address. Short forms are
 * left-padded with zeros so different-width forms of the same address compare
 * equal.
 */
function normalizeContractAddress(value: string): string | undefined {
  const lower = value.trim().toLowerCase();
  const body = lower.startsWith("0x") ? lower.slice(2) : lower;
  if (body.length === 0 || body.length > 64 || !/^[0-9a-f]+$/.test(body)) {
    return undefined;
  }
  return `0x${body.padStart(64, "0")}`;
}

function buildNameMap(entries: readonly ContractNameEntry[]): ReadonlyMap<string, string> {
  return new Map(
    entries.flatMap((entry) => {
      const normalized = normalizeContractAddress(entry.address);
      return normalized === undefined ? [] : [[normalized, entry.name] as const];
    })
  );
}

const PACKAGE_NAME_BY_ADDRESS = buildNameMap(PACKAGE_NAME_REGISTRY);
const OBJECT_NAME_BY_ADDRESS = buildNameMap(OBJECT_NAME_REGISTRY);

/**
 * Replace registered addresses in PTB Mermaid label text with their display
 * names. Mermaid node ids are synthetic (`command0`, `input0`, ...), so an
 * address only appears inside quoted label text, and matching is context-aware:
 *
 *  - A package is relabeled only where it is a path prefix (`<address>::`), the
 *    form a MoveCall target or type path takes — never a bare object id.
 *  - A well-known object is relabeled only where it is a bare id (not followed by
 *    `::`), the form an object input takes — never a package path.
 *
 * Unknown addresses (no registered name) are shortened for the display graph
 * (leading zeros collapsed, long ids middle-elided); the full address stays in
 * the artifact's raw `text` stream for audit and copy. Matching uses the full
 * `0x` + 64-hex address form the PTB renderer (`@zktx.io/ptb-model`) emits; the
 * registry keys are normalized to that same form.
 *
 * Registered package names may be Move Registry names like `@deepbook/core`;
 * Mermaid v11 reads a literal `@` as node/edge metadata syntax even inside a
 * quoted label and crashes the renderer, so an inserted `@` is written as the
 * decimal entity `#64;`, which renders as `@` without a literal `@`. The copyable
 * Mermaid source keeps raw addresses (it is built from the unmodified text), so
 * this only affects the rendered graph.
 */
export function applyContractNamesToMermaid(mermaidText: string): string {
  let text = mermaidText;
  // Packages: only in path position (`<address>::...`).
  for (const [address, name] of PACKAGE_NAME_BY_ADDRESS) {
    text = text.split(`${address}::`).join(`${mermaidSafeName(name)}::`);
  }
  // Objects: only as a bare id (anything but a `::` path prefix).
  for (const [address, name] of OBJECT_NAME_BY_ADDRESS) {
    const safe = mermaidSafeName(name);
    text = text.replace(new RegExp(`${address}(?!::)`, "g"), () => safe);
  }
  // Any address still present (no registered name) is shortened for the display
  // graph; its `::module::name` suffix, if any, is left intact. The full address
  // is untouched in the raw `text` stream the artifact keeps for audit and copy.
  text = text.replace(/0x[0-9a-f]{40,64}(?![0-9a-f])/gi, (address) => shortenAddressForDisplay(address));
  return text;
}

/**
 * Escape characters that break Mermaid label parsing. A literal `@` triggers
 * Mermaid v11 node/edge metadata syntax (even inside quotes) and throws, so it
 * is written as the `#64;` decimal entity, which renders as `@`. The other
 * registered label characters (letters, `/`, `-`, `_`, `.`, `:`) are valid in
 * Mermaid label text.
 */
function mermaidSafeName(name: string): string {
  return name.replace(/@/g, "#64;");
}

/**
 * Shorten an unregistered full-length address for the display graph: collapse
 * leading zeros so low ids read compactly (`0x...0002` -> `0x2`), and middle-elide
 * a genuinely long id (`0x123456...cdef`). Display only — the raw `text` stream
 * keeps the full address for audit and copy. Uses ASCII `...` (a Mermaid-valid
 * label character) rather than a unicode ellipsis.
 */
function shortenAddressForDisplay(address: string): string {
  const body = address.slice(2).replace(/^0+/, "");
  if (body.length === 0) {
    return "0x0";
  }
  if (body.length <= 12) {
    return `0x${body}`;
  }
  return `0x${body.slice(0, 6)}...${body.slice(-4)}`;
}
