import { mainnetPackageIds } from "@mysten/deepbook-v3";
import { describe, expect, it } from "vitest";
import { producePtbVisualizationArtifact } from "../src/core/action/ptbVisualizationProducer.js";
import { InMemoryLocalTransactionMaterialStore } from "../src/core/session/transactionMaterialStore.js";
import { recordTestTransactionMaterial } from "./fixtures/transactionMaterial.js";

const walletAccount = `0x${"a".repeat(64)}`;
const recordedAt = new Date("2026-06-06T00:00:00.000Z");
const renderedAt = new Date("2026-06-06T00:00:02.000Z");

async function recordMaterial(includeSharedObject: boolean) {
  const materialStore = new InMemoryLocalTransactionMaterialStore();
  const { handle, digest } = await recordTestTransactionMaterial({
    materialStore,
    reviewSessionId: "rs_1",
    planId: "plan_1",
    account: walletAccount,
    now: recordedAt,
    expiresAt: new Date("2026-06-06T00:30:00.000Z"),
    includeSharedObject
  });
  return { materialStore, handle, digest };
}

describe("producePtbVisualizationArtifact", () => {
  it("renders a commitment-bound Mermaid flowchart artifact without executable material", async () => {
    const { materialStore, handle, digest } = await recordMaterial(true);
    const outcome = await producePtbVisualizationArtifact({
      materialStore,
      transactionMaterial: handle,
      transactionMaterialDigest: digest,
      adapterId: "deepbook-swap",
      planId: "plan_1",
      now: renderedAt
    });

    if (outcome.status !== "rendered") {
      throw new Error(`expected rendered artifact, got: ${JSON.stringify(outcome)}`);
    }
    expect(outcome.artifact.mermaid.diagramType).toBe("flowchart");
    expect(outcome.artifact.mermaid.text).toContain("flowchart");
    expect(outcome.artifact.source.renderer?.packageName).toBe("@zktx.io/ptb-model");
    expect(outcome.artifact.source.authority).toBe("visualization_only_not_wallet_authorization");
    expect(outcome.artifact.unsupportedUse).toContain("transaction_building_input");
    expect(outcome.artifact.executableMaterial.included).toBe(false);
    const serialized = JSON.stringify(outcome.artifact);
    expect(serialized).not.toContain("transactionBytes");
    expect(serialized).not.toContain("txmat_");
    expect(serialized).not.toContain(digest.transactionDigest);
  });

  it("emits a named graph and keeps the raw-address graph for a registered package", async () => {
    const materialStore = new InMemoryLocalTransactionMaterialStore();
    const deepbookPackage = mainnetPackageIds.DEEPBOOK_PACKAGE_ID;
    const { handle, digest } = await recordTestTransactionMaterial({
      materialStore,
      reviewSessionId: "rs_named",
      planId: "plan_named",
      account: walletAccount,
      now: recordedAt,
      expiresAt: new Date("2026-06-06T00:30:00.000Z"),
      moveCallTarget: `${deepbookPackage}::pool::swap_exact_base_for_quote`
    });

    const outcome = await producePtbVisualizationArtifact({
      materialStore,
      transactionMaterial: handle,
      transactionMaterialDigest: digest,
      adapterId: "deepbook-swap",
      planId: "plan_named",
      now: renderedAt
    });

    if (outcome.status !== "rendered") {
      throw new Error(`expected rendered artifact, got: ${JSON.stringify(outcome)}`);
    }
    // namedText (default graph) shows the registered name; text (raw, used for
    // the copyable source/audit and the toggle target) keeps the package address.
    expect(outcome.artifact.mermaid.namedText).toContain("@deepbook/core::pool::swap_exact_base_for_quote");
    expect(outcome.artifact.mermaid.namedText).not.toContain(deepbookPackage);
    expect(outcome.artifact.mermaid.text).toContain(deepbookPackage);
    expect(outcome.artifact.mermaid.text).not.toContain("@deepbook/core");
  });

  it("declines when the stored bytes do not match the bound commitment", async () => {
    const { materialStore, handle } = await recordMaterial(true);
    const foreign = await recordMaterial(false);
    const outcome = await producePtbVisualizationArtifact({
      materialStore,
      transactionMaterial: handle,
      transactionMaterialDigest: foreign.digest,
      adapterId: "deepbook-swap",
      now: renderedAt
    });

    expect(outcome.status).toBe("declined");
    if (outcome.status === "declined") {
      expect(outcome.reason).toContain("do not match the bound transaction material commitment");
    }
  });

  it("declines when the material handle is unknown to the store", async () => {
    const { handle, digest } = await recordMaterial(true);
    const emptyStore = new InMemoryLocalTransactionMaterialStore();
    const outcome = await producePtbVisualizationArtifact({
      materialStore: emptyStore,
      transactionMaterial: handle,
      transactionMaterialDigest: digest,
      adapterId: "deepbook-swap",
      now: renderedAt
    });

    expect(outcome.status).toBe("declined");
    if (outcome.status === "declined") {
      expect(outcome.reason).toContain("unavailable");
    }
  });
});
