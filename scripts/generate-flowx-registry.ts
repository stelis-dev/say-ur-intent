import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  FLOWX_CLMM_MAINNET,
  FLOWX_PINNED_COINS,
  FLOWX_PINNED_POOLS,
  assertFlowxRegistryShape
} from "../src/core/read/flowxRegistry.js";

/**
 * Re-verifies the pinned FlowX CLMM registry against live Sui mainnet and
 * writes the audit snapshot. This script never rewrites the pinned module -
 * any drift fails the run so a human re-probes and updates the pins
 * deliberately.
 */
const GRPC_URL = process.env.SAY_UR_INTENT_SUI_GRPC_URL ?? "https://fullnode.mainnet.sui.io:443";
const outputPath = resolve("registry/generated/flowx-mainnet.json");

assertFlowxRegistryShape();

const client = new SuiGrpcClient({ baseUrl: GRPC_URL, network: "mainnet" });

const failures: string[] = [];

function check(label: string, expected: string, actual: string | undefined): void {
  if (expected !== actual) {
    failures.push(`${label}: pinned ${expected} but chain returned ${actual ?? "nothing"}`);
  }
}

// 1) Package identity: current storage id resolves and originates from the pinned original id.
const pkg = await client.movePackageService.getPackage({ packageId: FLOWX_CLMM_MAINNET.currentPackageId }).response;
check("clmm package storageId", FLOWX_CLMM_MAINNET.currentPackageId, pkg.package?.storageId);
check("clmm package originalId", FLOWX_CLMM_MAINNET.originalPackageId, pkg.package?.originalId);

// 2) Shared config objects exist with the pinned types and shared versions.
const configObjects = await client.core.getObjects({
  objectIds: [FLOWX_CLMM_MAINNET.poolRegistry.objectId, FLOWX_CLMM_MAINNET.versioned.objectId]
});
const [registryObject, versionedObject] = configObjects.objects;
if (registryObject === undefined || registryObject instanceof Error) {
  failures.push(`pool registry object: ${registryObject instanceof Error ? registryObject.message : "missing"}`);
} else {
  check("pool registry type", FLOWX_CLMM_MAINNET.poolRegistry.type, registryObject.type);
  check(
    "pool registry initialSharedVersion",
    FLOWX_CLMM_MAINNET.poolRegistry.initialSharedVersion,
    registryObject.owner.$kind === "Shared" ? registryObject.owner.Shared.initialSharedVersion : undefined
  );
}
if (versionedObject === undefined || versionedObject instanceof Error) {
  failures.push(`versioned object: ${versionedObject instanceof Error ? versionedObject.message : "missing"}`);
} else {
  check("versioned type", FLOWX_CLMM_MAINNET.versioned.type, versionedObject.type);
  check(
    "versioned initialSharedVersion",
    FLOWX_CLMM_MAINNET.versioned.initialSharedVersion,
    versionedObject.owner.$kind === "Shared" ? versionedObject.owner.Shared.initialSharedVersion : undefined
  );
}

// 3) Every pinned pool: discoverable as a registry dynamic-field child with the
//    pinned pair types, fee rate, and tick spacing.
const pinnedPoolIds = new Set(FLOWX_PINNED_POOLS.map((pool) => pool.poolId));
const discovered = new Map<string, { valueType: string }>();
let cursor: string | null = null;
do {
  const page = await client.core.listDynamicFields({
    parentId: FLOWX_CLMM_MAINNET.poolRegistry.objectId,
    limit: 1000,
    ...(cursor === null ? {} : { cursor })
  });
  for (const field of page.dynamicFields) {
    if (field.$kind === "DynamicObject" && pinnedPoolIds.has(field.childId)) {
      discovered.set(field.childId, { valueType: field.valueType });
    }
  }
  cursor = page.hasNextPage ? page.cursor : null;
} while (cursor !== null);

const poolObjects = await client.core.getObjects({
  objectIds: FLOWX_PINNED_POOLS.map((pool) => pool.poolId),
  include: { json: true }
});
const poolStates: Record<string, unknown>[] = [];
for (const [index, pool] of FLOWX_PINNED_POOLS.entries()) {
  if (!discovered.has(pool.poolId)) {
    failures.push(`pool ${pool.poolKey}: not found among registry dynamic fields`);
  }
  const object = poolObjects.objects[index];
  if (object === undefined || object instanceof Error) {
    failures.push(`pool ${pool.poolKey}: object fetch failed`);
    continue;
  }
  const json = object.json as Record<string, unknown> | undefined;
  const feeRate = typeof json?.swap_fee_rate === "string" ? Number(json.swap_fee_rate) : undefined;
  const tickSpacing = typeof json?.tick_spacing === "number" ? json.tick_spacing : undefined;
  const coinTypeX = typeof json?.coin_type_x === "string" ? `0x${json.coin_type_x}` : undefined;
  const coinTypeY = typeof json?.coin_type_y === "string" ? `0x${json.coin_type_y}` : undefined;
  check(`pool ${pool.poolKey} coinTypeX`, pool.coinTypeX, coinTypeX);
  check(`pool ${pool.poolKey} coinTypeY`, pool.coinTypeY, coinTypeY);
  check(`pool ${pool.poolKey} feeRate`, String(pool.feeRate), feeRate === undefined ? undefined : String(feeRate));
  check(
    `pool ${pool.poolKey} tickSpacing`,
    String(pool.tickSpacing),
    tickSpacing === undefined ? undefined : String(tickSpacing)
  );
  poolStates.push({
    poolKey: pool.poolKey,
    poolId: pool.poolId,
    observedAtVersion: object.version,
    liquidity: json?.liquidity,
    sqrtPrice: json?.sqrt_price,
    reserveX: json?.reserve_x,
    reserveY: json?.reserve_y,
    locked: json?.locked
  });
}

if (failures.length > 0) {
  process.stderr.write(`FlowX registry verification failed:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}

const registry = {
  generatedAt: new Date().toISOString(),
  network: "mainnet",
  source: "Sui mainnet direct reads (gRPC) verified against src/core/read/flowxRegistry.ts pins",
  generator: "scripts/generate-flowx-registry.ts",
  note:
    "This file is local policy/known metadata plus a verification-time state sample, not live liquidity, balances, quotes, or final execution truth.",
  protocol: FLOWX_CLMM_MAINNET,
  coins: FLOWX_PINNED_COINS,
  pools: FLOWX_PINNED_POOLS,
  verificationSample: poolStates
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
process.stderr.write(`Verified pins against mainnet and generated ${outputPath}\n`);
