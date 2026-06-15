import { Transaction } from "@mysten/sui/transactions";
import { rawTransactionToIR, transactionIRToMermaid } from "@zktx.io/ptb-model";
import { applyContractNamesToMermaid } from "./contractNameRegistry.js";
import {
  PTB_VISUALIZATION_CONTRACT_VERSION,
  PTB_VISUALIZATION_REQUIRED_UNSUPPORTED_USES,
  ptbVisualizationArtifactSchema,
  type PtbVisualizationArtifact
} from "./signableAdapterContract.js";
import type {
  LocalTransactionMaterialDigestCommitment,
  LocalTransactionMaterialHandle,
  LocalTransactionMaterialStore
} from "../session/transactionMaterialStore.js";

export const PTB_VISUALIZATION_RENDERER = {
  name: "transactionIRToMermaid",
  packageName: "@zktx.io/ptb-model",
  version: "0.5.0"
} as const;

export type PtbVisualizationProducerInput = {
  materialStore: Pick<LocalTransactionMaterialStore, "getTransactionMaterial">;
  transactionMaterial: LocalTransactionMaterialHandle;
  transactionMaterialDigest: LocalTransactionMaterialDigestCommitment;
  adapterId: string;
  planId?: string | undefined;
  now: Date;
};

export type PtbVisualizationOutcome =
  | { status: "rendered"; artifact: PtbVisualizationArtifact }
  | { status: "declined"; reason: string };

export async function producePtbVisualizationArtifact(
  input: PtbVisualizationProducerInput
): Promise<PtbVisualizationOutcome> {
  const material = input.materialStore.getTransactionMaterial(input.transactionMaterial, input.now);
  if (!material) {
    return { status: "declined", reason: "transaction material is unavailable for visualization" };
  }

  let mermaidText: string;
  try {
    const transaction = Transaction.from(material.transactionBytes);
    const recomputedDigest = await transaction.getDigest();
    if (recomputedDigest !== input.transactionMaterialDigest.transactionDigest) {
      return {
        status: "declined",
        reason: "stored transaction bytes do not match the bound transaction material commitment"
      };
    }
    const data = transaction.getData();
    const ir = rawTransactionToIR({ inputs: data.inputs, commands: data.commands });
    mermaidText = transactionIRToMermaid(ir, { direction: "LR" });
  } catch (error) {
    return {
      status: "declined",
      reason: `ptb renderer failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  const candidate = {
    contractVersion: PTB_VISUALIZATION_CONTRACT_VERSION,
    artifactKind: "ptb_visualization",
    generatedAt: input.now.toISOString(),
    source: {
      adapterId: input.adapterId,
      ...(input.planId !== undefined ? { planId: input.planId } : {}),
      sourceKind: "review_time_generated_transaction_kind",
      authority: "visualization_only_not_wallet_authorization",
      renderer: PTB_VISUALIZATION_RENDERER
    },
    mermaid: {
      diagramType: "flowchart",
      // text keeps raw package addresses (truth/audit and copyable source);
      // namedText relabels registered packages with their Move Registry name for
      // the default graph, with a review-page toggle back to raw addresses.
      text: mermaidText,
      namedText: applyContractNamesToMermaid(mermaidText)
    },
    diagnostics: [],
    unsupportedUse: [...PTB_VISUALIZATION_REQUIRED_UNSUPPORTED_USES],
    executableMaterial: {
      included: false,
      policy: "mcp_and_review_ui_outputs_must_not_include_executable_transaction_material"
    }
  };

  const parsed = ptbVisualizationArtifactSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    return {
      status: "declined",
      reason: `ptb visualization artifact rejected: ${path ? `${path}: ` : ""}${issue?.message ?? "unknown issue"}`
    };
  }
  return { status: "rendered", artifact: parsed.data };
}
