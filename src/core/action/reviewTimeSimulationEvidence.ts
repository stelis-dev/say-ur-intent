import type { SuiClientTypes } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { z } from "zod";
import { assertNoForbiddenMcpFields } from "./forbiddenFields.js";
import {
  WALLET_REVIEW_REQUIRED_SIMULATION_FIELDS
} from "./signableAdapterContract.js";
import type {
  BlockedReason,
  ReviewCheck,
  SuccessfulTransactionSimulationSummary
} from "./types.js";
import {
  failReviewCheck,
  passReviewCheck
} from "./reviewCheckResults.js";
import {
  makeRawU64StringSchema,
  makeSignedRawIntegerStringSchema,
  parseRawU64
} from "../numeric/rawU64.js";
import {
  normalizedSuiAddressSchema,
  parseSuiAddress,
  suiTransactionDigestSchema
} from "../suiAddress.js";
import { normalizeCoinType } from "../read/coinMetadata.js";
import type {
  LocalTransactionMaterialDigestCommitment,
  LocalTransactionMaterialHandle,
  LocalTransactionMaterialStore
} from "../session/transactionMaterialStore.js";
import {
  LocalTransactionMaterialStoreError,
  verifyLocalTransactionMaterialArtifacts
} from "../session/transactionMaterialStore.js";

export const REVIEW_TIME_SIMULATION_EVIDENCE_VERSION =
  "review-time-simulation-v1";

const isoUtcStringSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Expected ISO 8601 UTC timestamp");

const simulationRequiredFieldSchema = z.enum(WALLET_REVIEW_REQUIRED_SIMULATION_FIELDS);

const simulationBalanceChangeSchema = z.object({
  address: normalizedSuiAddressSchema,
  coinType: z.string().min(1).max(512).refine((value) => {
    try {
      return normalizeCoinType(value) === value;
    } catch {
      return false;
    }
  }, "Expected a normalized Sui struct tag coin type"),
  amount: makeSignedRawIntegerStringSchema("balanceChanges[].amount")
}).strict();

const simulationObjectChangeSchema = z.object({
  objectId: normalizedSuiAddressSchema,
  objectType: z.string().min(1).max(512).optional(),
  inputState: z.string().min(1).max(80),
  outputState: z.string().min(1).max(80),
  idOperation: z.string().min(1).max(80)
}).strict();

const simulationTransactionSummarySchema = z.object({
  sender: normalizedSuiAddressSchema,
  gasPaymentCount: z.number().int().min(1),
  inputCount: z.number().int().min(0),
  commandCount: z.number().int().min(0),
  gasBudgetRaw: makeRawU64StringSchema("gasBudgetRaw").optional(),
  gasPriceRaw: makeRawU64StringSchema("gasPriceRaw").optional()
}).strict();

const simulationGasCostSummarySchema = z.object({
  computationCostRaw: makeRawU64StringSchema("computationCostRaw"),
  storageCostRaw: makeRawU64StringSchema("storageCostRaw"),
  storageRebateRaw: makeRawU64StringSchema("storageRebateRaw"),
  nonRefundableStorageFeeRaw: makeRawU64StringSchema("nonRefundableStorageFeeRaw")
}).strict();

export const reviewTimeSimulationEvidenceSchema = z.object({
  evidenceVersion: z.literal(REVIEW_TIME_SIMULATION_EVIDENCE_VERSION),
  materialId: z.string().min(1),
  reviewSessionId: z.string().min(1),
  planId: z.string().min(1),
  account: normalizedSuiAddressSchema,
  transactionDigest: suiTransactionDigestSchema,
  kind: z.literal("review_time_simulation"),
  provider: z.literal("client.core.simulateTransaction"),
  network: z.literal("sui:mainnet"),
  checksEnabled: z.literal(true),
  requiredFields: z.array(simulationRequiredFieldSchema).min(WALLET_REVIEW_REQUIRED_SIMULATION_FIELDS.length),
  missingFields: z.array(simulationRequiredFieldSchema).default([]),
  status: z.literal("success"),
  simulatedAt: isoUtcStringSchema,
  expiresAt: isoUtcStringSchema,
  effects: z.object({
    transactionDigest: suiTransactionDigestSchema,
    gasCostSummary: simulationGasCostSummarySchema,
    changedObjectCount: z.number().int().min(0)
  }).strict(),
  balanceChanges: z.array(simulationBalanceChangeSchema),
  objectChanges: z.array(simulationObjectChangeSchema),
  transaction: simulationTransactionSummarySchema
}).strict().superRefine((value, ctx) => {
  if (!WALLET_REVIEW_REQUIRED_SIMULATION_FIELDS.every((field) => value.requiredFields.includes(field))) {
    ctx.addIssue({
      code: "custom",
      path: ["requiredFields"],
      message: "review-time simulation evidence must include every required simulation field"
    });
  }
  if (value.missingFields.length !== 0) {
    ctx.addIssue({
      code: "custom",
      path: ["missingFields"],
      message: "successful review-time simulation evidence must not have missing fields"
    });
  }
  if (value.effects.transactionDigest !== value.transactionDigest) {
    ctx.addIssue({
      code: "custom",
      path: ["effects", "transactionDigest"],
      message: "simulation effects transaction digest must match evidence transactionDigest"
    });
  }
  if (value.effects.changedObjectCount !== value.objectChanges.length) {
    ctx.addIssue({
      code: "custom",
      path: ["effects", "changedObjectCount"],
      message: "simulation changedObjectCount must match objectChanges length"
    });
  }
});

export type ReviewTimeSimulationEvidence = z.infer<typeof reviewTimeSimulationEvidenceSchema>;

export type ReviewTimeSimulationClient = {
  core: {
    simulateTransaction(input: SuiClientTypes.SimulateTransactionOptions<{
      transaction: true;
      effects: true;
      balanceChanges: true;
      objectTypes: true;
    }>): Promise<SuiClientTypes.SimulateTransactionResult<{
      transaction: true;
      effects: true;
      balanceChanges: true;
      objectTypes: true;
    }>>;
  };
};

export type ReviewTimeSimulationProducerInput = {
  transactionMaterial: LocalTransactionMaterialHandle;
  transactionMaterialDigest: LocalTransactionMaterialDigestCommitment;
  now: Date;
};

export type ReviewTimeSimulationProducerOutcome =
  | {
      status: "completed";
      evidence: ReviewTimeSimulationEvidence;
      checks: ReviewCheck[];
    }
  | {
      status: "blocked";
      blockedReason: BlockedReason;
      checks: [ReviewCheck, ...ReviewCheck[]];
    }
  | {
      status: "refresh_required";
      refreshReason: "quote_stale" | "simulation_transient_failure";
      checks: [ReviewCheck, ...ReviewCheck[]];
    };

export type ReviewTimeSimulationProducer = (
  input: ReviewTimeSimulationProducerInput
) => ReviewTimeSimulationProducerOutcome | Promise<ReviewTimeSimulationProducerOutcome>;

export type ReviewTimeSimulationProducerOptions = {
  client: ReviewTimeSimulationClient;
  materialStore: Pick<LocalTransactionMaterialStore, "getTransactionMaterial">;
  network: "mainnet";
  chainIdentifier: string;
  expectedChainIdentifier: string;
};

export function parseReviewTimeSimulationEvidence(
  value: ReviewTimeSimulationEvidence
): ReviewTimeSimulationEvidence {
  return reviewTimeSimulationEvidenceSchema.parse(value);
}

export function verifyReviewTimeSimulationEvidence(input: {
  transactionMaterial: LocalTransactionMaterialHandle;
  transactionMaterialDigest: LocalTransactionMaterialDigestCommitment;
  evidence: ReviewTimeSimulationEvidence;
  now?: Date | undefined;
}): ReviewTimeSimulationEvidence {
  const evidence = parseReviewTimeSimulationEvidence(input.evidence);
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new Error("now must be a valid Date");
  }

  if (
    evidence.materialId !== input.transactionMaterial.materialId ||
    evidence.reviewSessionId !== input.transactionMaterial.reviewSessionId ||
    evidence.planId !== input.transactionMaterial.planId ||
    evidence.account !== input.transactionMaterial.account ||
    evidence.expiresAt !== input.transactionMaterial.expiresAt ||
    evidence.transactionDigest !== input.transactionMaterialDigest.transactionDigest
  ) {
    throw new Error("review-time simulation evidence must match material and digest identity");
  }

  if (
    input.transactionMaterialDigest.materialId !== input.transactionMaterial.materialId ||
    input.transactionMaterialDigest.reviewSessionId !== input.transactionMaterial.reviewSessionId ||
    input.transactionMaterialDigest.planId !== input.transactionMaterial.planId ||
    input.transactionMaterialDigest.account !== input.transactionMaterial.account ||
    input.transactionMaterialDigest.expiresAt !== input.transactionMaterial.expiresAt
  ) {
    throw new Error("transaction material digest must match material identity before review-time simulation evidence is accepted");
  }

  const materialCreatedAtMs = Date.parse(input.transactionMaterial.createdAt);
  const simulatedAtMs = Date.parse(evidence.simulatedAt);
  const expiresAtMs = Date.parse(evidence.expiresAt);
  if (simulatedAtMs < materialCreatedAtMs || simulatedAtMs > nowMs || simulatedAtMs >= expiresAtMs) {
    throw new Error("review-time simulation simulatedAt must be between material creation, now, and material expiry");
  }
  if (expiresAtMs <= nowMs) {
    throw new Error("review-time simulation evidence must not be expired");
  }
  if (evidence.transaction.sender !== evidence.account) {
    throw new Error("review-time simulation transaction sender must match reviewed account");
  }

  assertNoForbiddenMcpFields(evidence);
  return evidence;
}

export function publicTransactionSimulationSummaryFromEvidence(
  evidenceInput: ReviewTimeSimulationEvidence
): SuccessfulTransactionSimulationSummary {
  const evidence = parseReviewTimeSimulationEvidence(evidenceInput);
  const summary: SuccessfulTransactionSimulationSummary = {
    provider: evidence.provider,
    checksEnabled: evidence.checksEnabled,
    success: true,
    gasCostSummary: { ...evidence.effects.gasCostSummary },
    balanceChanges: evidence.balanceChanges.map((change) => ({ ...change })),
    objectChanges: evidence.objectChanges.map((change) => ({ ...change }))
  };
  assertNoForbiddenMcpFields(summary);
  return summary;
}

export function createReviewTimeSimulationProducer(
  options: ReviewTimeSimulationProducerOptions
): ReviewTimeSimulationProducer {
  return async (input) => {
    if (options.network !== "mainnet" || options.chainIdentifier !== options.expectedChainIdentifier) {
      return {
        status: "blocked",
        blockedReason: "network_mismatch",
        checks: [
          failReviewCheck(
            "review_time_simulation_network_mismatch",
            "Review-time simulation network",
            "Review-time simulation requires a verified Sui mainnet gRPC endpoint and matching mainnet chain identifier.",
            "network"
          )
        ]
      };
    }

    let parsed;
    try {
      parsed = await verifyLocalTransactionMaterialArtifacts({
        materialStore: options.materialStore,
        transactionMaterial: input.transactionMaterial,
        transactionMaterialDigest: input.transactionMaterialDigest,
        now: input.now
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stored transaction material could not be verified.";
      const check = failReviewCheck(
        "review_time_simulation_material_unavailable",
        "Review-time simulation material",
        message,
        "adapter"
      );
      if (error instanceof LocalTransactionMaterialStoreError && /expired|unavailable/i.test(message)) {
        return { status: "refresh_required", refreshReason: "quote_stale", checks: [check] };
      }
      return { status: "blocked", blockedReason: "object_resolution_failed", checks: [check] };
    }

    const material = options.materialStore.getTransactionMaterial(parsed.transactionMaterial, input.now);
    if (!material) {
      return {
        status: "refresh_required",
        refreshReason: "quote_stale",
        checks: [
          failReviewCheck(
            "review_time_simulation_material_unavailable",
            "Review-time simulation material",
            "Review-time simulation could not run because the stored local transaction material is unavailable or expired.",
            "adapter"
          )
        ]
      };
    }

    let simulationResult;
    try {
      simulationResult = await options.client.core.simulateTransaction({
        transaction: material.transactionBytes,
        include: {
          transaction: true,
          effects: true,
          balanceChanges: true,
          objectTypes: true
        },
        checksEnabled: true
      });
    } catch (error) {
      const classification = classifySimulationException(error);
      if (classification.status === "refresh_required") {
        return {
          status: "refresh_required",
          refreshReason: "simulation_transient_failure",
          checks: [
            failReviewCheck(
              "review_time_simulation_transient_failure",
              "Review-time simulation",
              "Review-time simulation could not reach the Sui simulation endpoint or timed out before returning a result. Refreshing the review may retry this transport-level simulation step.",
              "simulation"
            )
          ]
        };
      }
      return {
        status: "blocked",
        blockedReason: classification.blockedReason,
        checks: [
          failReviewCheck(
            "review_time_simulation_exception_blocked",
            "Review-time simulation",
            "Review-time simulation threw a non-transient error before returning a result. The review is blocked until the transaction material, simulation request shape, or adapter implementation is corrected.",
            "simulation"
          )
        ]
      };
    }

    const simulatedTransaction = simulationResult.$kind === "Transaction"
      ? simulationResult.Transaction
      : simulationResult.FailedTransaction;
    if (simulationResult.$kind !== "Transaction" || !simulatedTransaction.status.success) {
      const failureReason = simulationFailureReason(simulatedTransaction.status);
      const checks: [ReviewCheck, ...ReviewCheck[]] = [
        failReviewCheck(
          "review_time_simulation_result_failed",
          "Review-time simulation",
          `Review-time simulation did not succeed: ${failureReason}`,
          "simulation"
        )
      ];
      return {
        status: "blocked",
        blockedReason: blockedReasonForSimulationFailure(failureReason),
        checks
      };
    }

    let recomputedTransactionDigest: string;
    try {
      recomputedTransactionDigest = await Transaction.from(material.transactionBytes).getDigest();
    } catch {
      return {
        status: "blocked",
        blockedReason: "object_resolution_failed",
        checks: [
          failReviewCheck(
            "review_time_simulation_result_invalid",
            "Review-time simulation",
            "Stored transaction material bytes could not produce a Sui transaction digest for the simulation binding.",
            "simulation"
          )
        ]
      };
    }

    let evidence;
    try {
      evidence = createReviewTimeSimulationEvidenceFromTransaction({
        transactionMaterial: parsed.transactionMaterial,
        transactionMaterialDigest: parsed.transactionMaterialDigest,
        recomputedTransactionDigest,
        transaction: simulatedTransaction,
        simulatedAt: input.now
      });
      verifyReviewTimeSimulationEvidence({
        transactionMaterial: parsed.transactionMaterial,
        transactionMaterialDigest: parsed.transactionMaterialDigest,
        evidence,
        now: input.now
      });
    } catch (error) {
      return {
        status: "blocked",
        blockedReason: "object_resolution_failed",
        checks: [
          failReviewCheck(
            "review_time_simulation_result_invalid",
            "Review-time simulation",
            error instanceof Error ? error.message : "Review-time simulation returned incomplete or invalid required fields.",
            "simulation"
          )
        ]
      };
    }

    return {
      status: "completed",
      evidence,
      checks: [
        passReviewCheck(
          "review_time_simulation_evidence",
          "Review-time simulation",
          "Simulated the stored local unsigned transaction material with validation checks enabled and bound the resulting effects, balance changes, object types, and transaction summary to the internal transaction digest. This is review evidence only, not wallet handoff, signing readiness, or execution readiness.",
          "simulation"
        )
      ]
    };
  };
}

function createReviewTimeSimulationEvidenceFromTransaction(input: {
  transactionMaterial: LocalTransactionMaterialHandle;
  transactionMaterialDigest: LocalTransactionMaterialDigestCommitment;
  recomputedTransactionDigest: string;
  transaction: SuiClientTypes.Transaction<{
    transaction: true;
    effects: true;
    balanceChanges: true;
    objectTypes: true;
  }>;
  simulatedAt: Date;
}): ReviewTimeSimulationEvidence {
  // The digest binding is recomputed locally from the exact bytes submitted to
  // the simulation endpoint. Public fullnodes differ in whether they echo the
  // transaction digest back, so node-provided digests are cross-checks only.
  if (input.recomputedTransactionDigest !== input.transactionMaterialDigest.transactionDigest) {
    throw new Error("simulated transaction digest must match the stored material digest");
  }
  const nodeDigest = input.transaction.digest;
  if (nodeDigest !== undefined && nodeDigest !== input.transactionMaterialDigest.transactionDigest) {
    throw new Error("simulation node returned a different transaction digest than the submitted bytes");
  }
  const effectsDigest = input.transaction.effects?.transactionDigest;
  if (effectsDigest !== undefined && effectsDigest !== input.transactionMaterialDigest.transactionDigest) {
    throw new Error("simulated effects digest must match the stored material digest");
  }
  if (!input.transaction.transaction) {
    throw new Error("simulation result is missing parsed transaction data");
  }
  if (!input.transaction.effects) {
    throw new Error("simulation result is missing effects");
  }
  if (!input.transaction.balanceChanges) {
    throw new Error("simulation result is missing balance changes");
  }
  if (!input.transaction.objectTypes) {
    throw new Error("simulation result is missing object types");
  }

  const transactionSummary = summarizeSimulatedTransaction(input.transaction.transaction);
  const evidence = {
    evidenceVersion: REVIEW_TIME_SIMULATION_EVIDENCE_VERSION,
    materialId: input.transactionMaterial.materialId,
    reviewSessionId: input.transactionMaterial.reviewSessionId,
    planId: input.transactionMaterial.planId,
    account: input.transactionMaterial.account,
    transactionDigest: input.transactionMaterialDigest.transactionDigest,
    kind: "review_time_simulation",
    provider: "client.core.simulateTransaction",
    network: "sui:mainnet",
    checksEnabled: true,
    requiredFields: [...WALLET_REVIEW_REQUIRED_SIMULATION_FIELDS],
    missingFields: [],
    status: "success",
    simulatedAt: input.simulatedAt.toISOString(),
    expiresAt: input.transactionMaterial.expiresAt,
    effects: {
      transactionDigest: input.transaction.effects.transactionDigest,
      gasCostSummary: summarizeGasCost(input.transaction.effects.gasUsed),
      changedObjectCount: input.transaction.effects.changedObjects.length
    },
    balanceChanges: input.transaction.balanceChanges.map((change) => ({
      address: normalizeSimulationAddress(change.address, "balance change address"),
      coinType: normalizeCoinType(change.coinType),
      amount: change.amount
    })),
    objectChanges: input.transaction.effects.changedObjects.map((change) => ({
      objectId: normalizeSimulationAddress(change.objectId, "object change objectId"),
      ...(input.transaction.objectTypes[change.objectId]
        ? { objectType: input.transaction.objectTypes[change.objectId] }
        : {}),
      inputState: change.inputState,
      outputState: change.outputState,
      idOperation: change.idOperation
    })),
    transaction: transactionSummary
  } satisfies ReviewTimeSimulationEvidence;
  return reviewTimeSimulationEvidenceSchema.parse(evidence);
}

function summarizeGasCost(gasUsed: SuiClientTypes.GasCostSummary): ReviewTimeSimulationEvidence["effects"]["gasCostSummary"] {
  const computationCost = parseRawU64(gasUsed.computationCost, "computationCost");
  const storageCost = parseRawU64(gasUsed.storageCost, "storageCost");
  const storageRebate = parseRawU64(gasUsed.storageRebate, "storageRebate");
  const nonRefundableStorageFee = parseRawU64(gasUsed.nonRefundableStorageFee, "nonRefundableStorageFee");
  return {
    computationCostRaw: computationCost.toString(),
    storageCostRaw: storageCost.toString(),
    storageRebateRaw: storageRebate.toString(),
    nonRefundableStorageFeeRaw: nonRefundableStorageFee.toString()
  };
}

function summarizeSimulatedTransaction(
  transaction: SuiClientTypes.TransactionData
): ReviewTimeSimulationEvidence["transaction"] {
  if (transaction.sender === null || transaction.sender === undefined) {
    throw new Error("simulation transaction sender is missing");
  }
  const sender = normalizeSimulationAddress(transaction.sender, "transaction sender");
  const gasData = transaction.gasData as {
    payment?: unknown[] | null;
    budget?: string | number | null;
    price?: string | number | null;
  };
  return {
    sender,
    gasPaymentCount: Array.isArray(gasData.payment) ? gasData.payment.length : 0,
    inputCount: transaction.inputs.length,
    commandCount: transaction.commands.length,
    ...(gasData.budget === null || gasData.budget === undefined
      ? {}
      : { gasBudgetRaw: parseRawU64(String(gasData.budget), "gasBudgetRaw").toString() }),
    ...(gasData.price === null || gasData.price === undefined
      ? {}
      : { gasPriceRaw: parseRawU64(String(gasData.price), "gasPriceRaw").toString() })
  };
}

function normalizeSimulationAddress(value: string, label: string): string {
  const normalized = parseSuiAddress(value);
  if (!normalized) {
    throw new Error(`simulation ${label} must be a valid Sui address`);
  }
  return normalized;
}

function simulationFailureReason(status: SuiClientTypes.ExecutionStatus): string {
  if (status.success) {
    return "simulation succeeded";
  }
  const error = status.error;
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.length > 0) {
      return maybeMessage;
    }
    return JSON.stringify(error);
  }
  return "unknown simulation failure";
}

function blockedReasonForSimulationFailure(failureReason: string): BlockedReason {
  if (/gas/i.test(failureReason)) {
    return "insufficient_gas";
  }
  if (/balance|coin|insufficient/i.test(failureReason)) {
    return "insufficient_balance";
  }
  return "object_resolution_failed";
}

type SimulationExceptionClassification =
  | { status: "refresh_required" }
  | { status: "blocked"; blockedReason: BlockedReason };

function classifySimulationException(error: unknown): SimulationExceptionClassification {
  if (isTransientSimulationException(error)) {
    return { status: "refresh_required" };
  }
  return { status: "blocked", blockedReason: "object_resolution_failed" };
}

function isTransientSimulationException(error: unknown): boolean {
  const code = errorCode(error);
  if (
    code === "UNAVAILABLE" ||
    code === "DEADLINE_EXCEEDED" ||
    code === "RESOURCE_EXHAUSTED" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === 4 ||
    code === 8 ||
    code === 14
  ) {
    return true;
  }

  const message = errorMessage(error).toLowerCase();
  if (message.length === 0) {
    return false;
  }

  return [
    /\b(grpc|rpc|transport|network|endpoint|connection|connect|socket|fetch)\b[\s\S]{0,80}\b(unavailable|timeout|timed out|deadline|reset|refused|failed|hang up|exhausted)\b/,
    /\b(unavailable|timeout|timed out|deadline exceeded|temporarily unavailable|service unavailable|gateway timeout|too many requests)\b[\s\S]{0,80}\b(grpc|rpc|transport|network|endpoint|connection|connect|socket|fetch)\b/,
    /\b(econnreset|econnrefused|etimedout|enotfound|eai_again|socket hang up|fetch failed|network error|deadline exceeded|request timeout|service unavailable|gateway timeout|too many requests)\b/
  ].some((pattern) => pattern.test(message));
}

function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const value = (error as { code?: unknown; status?: unknown }).code ??
    (error as { status?: unknown }).status;
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "";
}
