import {
  computeDeepbookSwapReviewEvidence,
  type DeepbookPtbVisualizationProducer,
  type DeepbookSwapReviewQuoteSource
} from "./deepbook/deepbookReviewEvidence.js";
import {
  DEEPBOOK_SWAP_ACTION_KIND,
  DEEPBOOK_SWAP_ADAPTER_ID,
  DEEPBOOK_SWAP_PROTOCOL,
  isDeepbookSwapActionPlanIdentity
} from "./deepbook/deepbookSwapIntent.js";
import { DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID } from "./deepbook/deepbookReviewLifecycle.js";
import type {
  DeepbookSwapTransactionMaterialDigestProducer,
  DeepbookSwapTransactionMaterialProducer
} from "./deepbook/deepbookTransactionMaterialProducer.js";
import type {
  DeepbookSwapHumanReadableReviewProducer
} from "./deepbook/deepbookHumanReviewProducer.js";
import {
  computeFlowxSwapReviewEvidence,
  type FlowxPtbVisualizationProducer,
  type FlowxSwapReviewQuoteSource
} from "./flowx/flowxSwapReviewEvidence.js";
import {
  FLOWX_SWAP_ACTION_KIND,
  FLOWX_SWAP_ADAPTER_ID,
  FLOWX_SWAP_PROTOCOL,
  isFlowxSwapActionPlanIdentity
} from "./flowx/flowxSwapIntent.js";
import { FLOWX_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID } from "./flowx/flowxSwapReviewLifecycle.js";
import type {
  FlowxSwapTransactionMaterialDigestProducer,
  FlowxSwapTransactionMaterialProducer
} from "./flowx/flowxSwapTransactionMaterialProducer.js";
import type {
  FlowxSwapHumanReadableReviewProducer
} from "./flowx/flowxSwapHumanReviewProducer.js";
import type { ReviewTimeSimulationProducer } from "../core/action/reviewTimeSimulationEvidence.js";
import type { TransactionObjectOwnershipProducer } from "../core/action/transactionObjectOwnershipProducer.js";
import {
  unsupportedDeepbookSwapPlanIdentityCheck,
  unsupportedFlowxSwapPlanIdentityCheck
} from "../core/review/reviewChecks.js";
import { blockedReviewResult } from "../core/review/reviewComputationResult.js";
import type {
  ReviewAdapterEvidenceComputer,
  ReviewAdapterMap
} from "../core/review/reviewComputation.js";

export type DeepbookReviewAdapterWiring = {
  deepbookQuoteSource: DeepbookSwapReviewQuoteSource;
  deepbookDeepBalanceSource?: ((account: string) => Promise<string>) | undefined;
  deepbookTransactionMaterialProducer?: DeepbookSwapTransactionMaterialProducer | undefined;
  deepbookTransactionMaterialDigestProducer?: DeepbookSwapTransactionMaterialDigestProducer | undefined;
  transactionObjectOwnershipProducer?: TransactionObjectOwnershipProducer | undefined;
  deepbookHumanReadableReviewProducer?: DeepbookSwapHumanReadableReviewProducer | undefined;
  reviewTimeSimulationProducer?: ReviewTimeSimulationProducer | undefined;
  ptbVisualizationProducer?: DeepbookPtbVisualizationProducer | undefined;
};

export type FlowxReviewAdapterWiring = {
  flowxQuoteSource: FlowxSwapReviewQuoteSource;
  flowxTransactionMaterialProducer?: FlowxSwapTransactionMaterialProducer | undefined;
  flowxTransactionMaterialDigestProducer?: FlowxSwapTransactionMaterialDigestProducer | undefined;
  transactionObjectOwnershipProducer?: TransactionObjectOwnershipProducer | undefined;
  flowxHumanReadableReviewProducer?: FlowxSwapHumanReadableReviewProducer | undefined;
  reviewTimeSimulationProducer?: ReviewTimeSimulationProducer | undefined;
  ptbVisualizationProducer?: FlowxPtbVisualizationProducer | undefined;
};

/**
 * Named per-adapter wiring. A protocol whose wiring field is absent is simply
 * not registered - the platform then reports unsupported_action for its plans
 * instead of running with partial producers.
 */
export type SupportedReviewAdapterWiring = {
  deepbook: DeepbookReviewAdapterWiring;
  flowx?: FlowxReviewAdapterWiring | undefined;
};

/**
 * One registered review adapter. The platform owns the safety gates (typed
 * evidence claims, commitment equality, digest-gated handoff); a descriptor
 * supplies only protocol-specific plan creation and evidence computation.
 */
export type ReviewAdapterDescriptor = {
  adapterId: string;
  protocol: string;
  actionKind: string;
  stageCatalogId: string;
  computeReview: ReviewAdapterEvidenceComputer;
};

export function buildSupportedReviewAdapterDescriptors(
  wiring: SupportedReviewAdapterWiring
): ReviewAdapterDescriptor[] {
  const descriptors: ReviewAdapterDescriptor[] = [
    {
      adapterId: DEEPBOOK_SWAP_ADAPTER_ID,
      protocol: DEEPBOOK_SWAP_PROTOCOL,
      actionKind: DEEPBOOK_SWAP_ACTION_KIND,
      stageCatalogId: DEEPBOOK_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID,
      computeReview: deepbookSwapEvidenceComputer(wiring.deepbook)
    }
  ];
  if (wiring.flowx) {
    descriptors.push({
      adapterId: FLOWX_SWAP_ADAPTER_ID,
      protocol: FLOWX_SWAP_PROTOCOL,
      actionKind: FLOWX_SWAP_ACTION_KIND,
      stageCatalogId: FLOWX_SWAP_REVIEW_LIFECYCLE_STAGE_CATALOG_ID,
      computeReview: flowxSwapEvidenceComputer(wiring.flowx)
    });
  }
  return descriptors;
}

function deepbookSwapEvidenceComputer(wiring: DeepbookReviewAdapterWiring): ReviewAdapterEvidenceComputer {
  return async (input) => {
    if (!isDeepbookSwapActionPlanIdentity(input.plan)) {
      return {
        result: blockedReviewResult("unsupported_action", [unsupportedDeepbookSwapPlanIdentityCheck()])
      };
    }
    return computeDeepbookSwapReviewEvidence({
      reviewSessionId: input.reviewSessionId,
      plan: input.plan,
      account: input.account,
      now: input.now,
      quoteSource: wiring.deepbookQuoteSource,
      deepBalanceSource: wiring.deepbookDeepBalanceSource,
      transactionMaterialProducer: wiring.deepbookTransactionMaterialProducer,
      transactionMaterialDigestProducer: wiring.deepbookTransactionMaterialDigestProducer,
      transactionObjectOwnershipProducer: wiring.transactionObjectOwnershipProducer,
      humanReadableReviewProducer: wiring.deepbookHumanReadableReviewProducer,
      reviewTimeSimulationProducer: wiring.reviewTimeSimulationProducer,
      ptbVisualizationProducer: wiring.ptbVisualizationProducer
    });
  };
}

function flowxSwapEvidenceComputer(wiring: FlowxReviewAdapterWiring): ReviewAdapterEvidenceComputer {
  return async (input) => {
    if (!isFlowxSwapActionPlanIdentity(input.plan)) {
      return {
        result: blockedReviewResult("unsupported_action", [unsupportedFlowxSwapPlanIdentityCheck()])
      };
    }
    return computeFlowxSwapReviewEvidence({
      reviewSessionId: input.reviewSessionId,
      plan: input.plan,
      account: input.account,
      now: input.now,
      quoteSource: wiring.flowxQuoteSource,
      transactionMaterialProducer: wiring.flowxTransactionMaterialProducer,
      transactionMaterialDigestProducer: wiring.flowxTransactionMaterialDigestProducer,
      transactionObjectOwnershipProducer: wiring.transactionObjectOwnershipProducer,
      humanReadableReviewProducer: wiring.flowxHumanReadableReviewProducer,
      reviewTimeSimulationProducer: wiring.reviewTimeSimulationProducer,
      ptbVisualizationProducer: wiring.ptbVisualizationProducer
    });
  };
}

export function buildSupportedReviewAdapters(wiring: SupportedReviewAdapterWiring): ReviewAdapterMap {
  const adapters: Record<string, ReviewAdapterEvidenceComputer> = {};
  for (const descriptor of buildSupportedReviewAdapterDescriptors(wiring)) {
    adapters[descriptor.adapterId] = descriptor.computeReview;
  }
  return adapters;
}
