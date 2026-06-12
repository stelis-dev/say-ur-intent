import { z } from "zod";
import type { AdapterLifecycle } from "../../core/action/types.js";
import {
  FLOWX_SWAP_ACTION_KIND,
  FLOWX_SWAP_ADAPTER_ID,
  FLOWX_SWAP_PROTOCOL,
  type FlowxSwapActionPlanIdentity
} from "./flowxSwapIntent.js";

export const FLOWX_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID = "flowx_swap_review_v1";

export const FLOWX_SWAP_REVIEW_LIFECYCLE_STAGES = [
  "intent_normalized",
  "pair_resolved",
  "quote_evidence_fetched",
  "quote_policy_derived",
  "transaction_material_build_or_verify",
  "digest_commitment",
  "object_ownership",
  "human_readable_review",
  "review_time_simulation"
] as const;

export type FlowxSwapReviewLifecycleStage = (typeof FLOWX_SWAP_REVIEW_LIFECYCLE_STAGES)[number];

export const flowxSwapReviewLifecycleStageSchema = z.enum(FLOWX_SWAP_REVIEW_LIFECYCLE_STAGES);

export const flowxSwapReviewLifecycleSchema = z.object({
  stageCatalogId: z.literal(FLOWX_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID),
  adapterId: z.literal(FLOWX_SWAP_ADAPTER_ID),
  protocol: z.literal(FLOWX_SWAP_PROTOCOL),
  actionKind: z.literal(FLOWX_SWAP_ACTION_KIND),
  completedStages: z.array(flowxSwapReviewLifecycleStageSchema),
  missingStages: z.array(flowxSwapReviewLifecycleStageSchema)
}).strict().superRefine((lifecycle, ctx) => {
  const expectedCompleted = FLOWX_SWAP_REVIEW_LIFECYCLE_STAGES.slice(0, lifecycle.completedStages.length);
  const expectedMissing = FLOWX_SWAP_REVIEW_LIFECYCLE_STAGES.slice(lifecycle.completedStages.length);

  if (!sameStringArray(lifecycle.completedStages, expectedCompleted)) {
    ctx.addIssue({
      code: "custom",
      path: ["completedStages"],
      message: "completedStages must be the canonical FlowX swap review lifecycle prefix"
    });
  }

  if (!sameStringArray(lifecycle.missingStages, expectedMissing)) {
    ctx.addIssue({
      code: "custom",
      path: ["missingStages"],
      message: "missingStages must be the canonical FlowX swap review lifecycle remainder"
    });
  }
});

export type FlowxSwapReviewLifecycle = z.infer<typeof flowxSwapReviewLifecycleSchema>;

type MutableFlowxSwapReviewLifecycle = {
  complete(stage: FlowxSwapReviewLifecycleStage): void;
  snapshot(): FlowxSwapReviewLifecycle;
};

const FLOWX_SWAP_REVIEW_STAGE_LABELS: Record<FlowxSwapReviewLifecycleStage, string> = {
  intent_normalized: "Intent normalized",
  pair_resolved: "FlowX pair resolved",
  quote_evidence_fetched: "FlowX route quote fetched",
  quote_policy_derived: "Quote policy derived",
  transaction_material_build_or_verify: "Transaction material build or verify",
  digest_commitment: "Digest commitment",
  object_ownership: "Object ownership",
  human_readable_review: "Human-readable review",
  review_time_simulation: "Review-time simulation"
};

export function newFlowxSwapReviewLifecycle(plan: FlowxSwapActionPlanIdentity): MutableFlowxSwapReviewLifecycle {
  const completedStages: FlowxSwapReviewLifecycleStage[] = [];
  return {
    complete(stage) {
      const expectedStage = FLOWX_SWAP_REVIEW_LIFECYCLE_STAGES[completedStages.length];
      if (stage !== expectedStage) {
        throw new Error(
          `FlowX swap review lifecycle stage '${stage}' cannot complete before '${expectedStage ?? "none"}'.`
        );
      }
      completedStages.push(stage);
    },
    snapshot() {
      return flowxSwapReviewLifecycleSchema.parse({
        stageCatalogId: FLOWX_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID,
        adapterId: plan.adapterId,
        protocol: plan.protocol,
        actionKind: plan.actionKind,
        completedStages: [...completedStages],
        missingStages: FLOWX_SWAP_REVIEW_LIFECYCLE_STAGES.filter((stage) => !completedStages.includes(stage))
      });
    }
  };
}

export function flowxSwapReviewLifecycleStageLabel(stage: FlowxSwapReviewLifecycleStage): string {
  return FLOWX_SWAP_REVIEW_STAGE_LABELS[stage];
}

export function validateFlowxSwapReviewLifecycle(lifecycle: AdapterLifecycle): void {
  flowxSwapReviewLifecycleSchema.parse(lifecycle);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
