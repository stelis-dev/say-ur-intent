import { mainnetPackageIds } from "@mysten/deepbook-v3";

/**
 * Pinned contract-name registry for review-time display labels.
 *
 * Maps a verified mainnet package address to its registered Move Registry (MVR)
 * name so the PTB visualization can show a human-readable label instead of a raw
 * address. The name is a display label only: only registered addresses are
 * relabeled, any package that is not registered keeps its raw address, and the
 * raw address stays available in the artifact (the review page can toggle back
 * to addresses and the copyable Mermaid source keeps raw addresses). A
 * registered name is package identity, not a safety, trust, or signing-readiness
 * signal.
 *
 * The single current entry is the DeepBook swap package the account-bound
 * DeepBook swap review builds with. Its address is taken directly from
 * `@mysten/deepbook-v3` `mainnetPackageIds.DEEPBOOK_PACKAGE_ID` (the same
 * constant the swap MoveCall targets, so the registry address always matches the
 * address that appears in the PTB and follows a pinned SDK version). The
 * `@deepbook/core` MVR name is confirmed by live review after deploy.
 */

export type ContractNameEntry = {
  /** Mainnet package address. */
  readonly address: string;
  /** Registered Move Registry (MVR) name shown as a display label. */
  readonly name: string;
  /** Provenance of the entry. */
  readonly source: string;
};

export const CONTRACT_NAME_REGISTRY: readonly ContractNameEntry[] = [
  {
    address: mainnetPackageIds.DEEPBOOK_PACKAGE_ID,
    name: "@deepbook/core",
    source: "deepbook_v3_sdk_mainnet_package_id"
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

const NAME_BY_ADDRESS: ReadonlyMap<string, string> = new Map(
  CONTRACT_NAME_REGISTRY.flatMap((entry) => {
    const normalized = normalizeContractAddress(entry.address);
    return normalized === undefined ? [] : [[normalized, entry.name] as const];
  })
);

/**
 * Replace every registered package address in PTB Mermaid label text with its
 * registered name. Only exact normalized-address matches are replaced; unknown
 * addresses are left unchanged. Mermaid node ids are synthetic (`command0`,
 * `input0`, ...) and the address only appears inside quoted label text.
 *
 * Registered names are Move Registry names like `@deepbook/core`. Mermaid v11
 * reads a literal `@` as node/edge metadata syntax even inside a quoted label
 * and crashes the renderer, so the inserted name's `@` is written as the Mermaid
 * decimal entity `#64;`, which renders as `@` without a literal `@` in the
 * source. The copyable Mermaid source keeps raw addresses (it is built from the
 * unmodified text), so this only affects the named, rendered graph.
 */
export function applyContractNamesToMermaid(mermaidText: string): string {
  let text = mermaidText;
  for (const [address, name] of NAME_BY_ADDRESS) {
    if (text.includes(address)) {
      text = text.split(address).join(mermaidSafeName(name));
    }
  }
  return text;
}

/**
 * Escape characters that break Mermaid label parsing. A literal `@` triggers
 * Mermaid v11 node/edge metadata syntax (even inside quotes) and throws, so it
 * is written as the `#64;` decimal entity, which renders as `@`. Other Move
 * Registry name characters (letters, `/`, `-`, `_`, `.`, `:`) are valid in
 * Mermaid label text.
 */
function mermaidSafeName(name: string): string {
  return name.replace(/@/g, "#64;");
}
