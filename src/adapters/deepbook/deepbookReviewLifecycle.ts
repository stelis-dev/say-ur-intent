import { z } from "zod";
import type { AdapterLifecycle } from "../../core/action/types.js";
import {
  DEEPBOOK_SWAP_ACTION_KIND,
  DEEPBOOK_SWAP_ADAPTER_ID,
  DEEPBOOK_SWAP_PROTOCOL,
  type DeepbookSwapActionPlanIdentity
} from "./deepbookSwapIntent.js";

export const DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID = "deepbook_swap_review_v1";

export const DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGES = [
  "intent_normalized",
  "pool_resolved",
  "quote_evidence_fetched",
  "quote_policy_derived",
  "transaction_material_build_or_verify",
  "digest_commitment",
  "object_ownership",
  "human_readable_review",
  "review_time_simulation"
] as const;

export type DeepbookSwapReviewLifecycleStage =
  (typeof DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGES)[number];

export const deepbookSwapReviewLifecycleStageSchema = z.enum(DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGES);

export const deepbookSwapReviewLifecycleSchema = z.object({
  stageCatalogId: z.literal(DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID),
  adapterId: z.literal(DEEPBOOK_SWAP_ADAPTER_ID),
  protocol: z.literal(DEEPBOOK_SWAP_PROTOCOL),
  actionKind: z.literal(DEEPBOOK_SWAP_ACTION_KIND),
  completedStages: z.array(deepbookSwapReviewLifecycleStageSchema),
  missingStages: z.array(deepbookSwapReviewLifecycleStageSchema)
}).strict().superRefine((lifecycle, ctx) => {
  const expectedCompleted = DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGES.slice(
    0,
    lifecycle.completedStages.length
  );
  const expectedMissing = DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGES.slice(
    lifecycle.completedStages.length
  );

  if (!sameStringArray(lifecycle.completedStages, expectedCompleted)) {
    ctx.addIssue({
      code: "custom",
      path: ["completedStages"],
      message: "completedStages must be the canonical DeepBook swap review lifecycle prefix"
    });
  }

  if (!sameStringArray(lifecycle.missingStages, expectedMissing)) {
    ctx.addIssue({
      code: "custom",
      path: ["missingStages"],
      message: "missingStages must be the canonical DeepBook swap review lifecycle remainder"
    });
  }
});

export type DeepbookSwapReviewLifecycle = z.infer<typeof deepbookSwapReviewLifecycleSchema>;

type MutableDeepbookSwapReviewLifecycle = {
  complete(stage: DeepbookSwapReviewLifecycleStage): void;
  snapshot(): DeepbookSwapReviewLifecycle;
};

const DEEPBOOK_SWAP_REVIEW_STAGE_LABELS: Record<DeepbookSwapReviewLifecycleStage, string> = {
  intent_normalized: "Intent normalized",
  pool_resolved: "DeepBook pool resolved",
  quote_evidence_fetched: "DeepBook quote evidence fetched",
  quote_policy_derived: "Quote policy derived",
  transaction_material_build_or_verify: "Transaction material build or verify",
  digest_commitment: "Digest commitment",
  object_ownership: "Object ownership",
  human_readable_review: "Human-readable review",
  review_time_simulation: "Review-time simulation"
};

export function newDeepbookSwapReviewLifecycle(
  plan: DeepbookSwapActionPlanIdentity
): MutableDeepbookSwapReviewLifecycle {
  const completedStages: DeepbookSwapReviewLifecycleStage[] = [];
  return {
    complete(stage) {
      const expectedStage = DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGES[completedStages.length];
      if (stage !== expectedStage) {
        throw new Error(
          `DeepBook swap review lifecycle stage '${stage}' cannot complete before '${expectedStage ?? "none"}'.`
        );
      }
      completedStages.push(stage);
    },
    snapshot() {
      return deepbookSwapReviewLifecycleSchema.parse({
        stageCatalogId: DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID,
        adapterId: plan.adapterId,
        protocol: plan.protocol,
        actionKind: plan.actionKind,
        completedStages: [...completedStages],
        missingStages: DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGES.filter(
          (stage) => !completedStages.includes(stage)
        )
      });
    }
  };
}

export function deepbookSwapReviewLifecycleStageLabel(
  stage: DeepbookSwapReviewLifecycleStage
): string {
  return DEEPBOOK_SWAP_REVIEW_STAGE_LABELS[stage];
}

export function validateDeepbookSwapReviewLifecycle(lifecycle: AdapterLifecycle): void {
  deepbookSwapReviewLifecycleSchema.parse(lifecycle);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
