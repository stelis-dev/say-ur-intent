import { describe, expect, it } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { actionPlanSchema } from "../src/core/action/schemas.js";
import { findForbiddenMcpFields } from "../src/core/action/forbiddenFields.js";
import { externalProposalToActionPlan } from "../src/core/proposal/externalProposalReview.js";
import { externalProposalSchema } from "../src/core/proposal/schemas.js";
import { computeReviewState } from "../src/core/review/reviewComputation.js";
import { prepareExternalProposalReviewUserAnswerUse } from "../src/mcp/responseGuidance.js";

const now = new Date("2026-05-25T00:00:00.000Z");
const walletAccount = `0x${"a".repeat(64)}`;

describe("external proposal review foundation", () => {
  it("turns an external payment proposal into a non-signable review model", () => {
    const proposal = externalProposalSchema.parse({
      type: "payment",
      id: "payment_1",
      source: { kind: "mcp_server", name: "external-payments" },
      network: "sui:mainnet",
      createdAt: "2026-05-24T23:59:00.000Z",
      expiresAt: "2026-05-25T00:10:00.000Z",
      purpose: "Pay invoice 42",
      payment: {
        amount: { amountDisplay: "100", denomination: "USD" },
        recipient: { address: walletAccount },
        target: "invoice_42"
      },
      requiredUserChoices: ["Confirm the recipient belongs to the invoice."]
    });

    const plan = externalProposalToActionPlan(proposal, now);

    expect(actionPlanSchema.safeParse(plan).success).toBe(true);
    expect(findForbiddenMcpFields(plan)).toEqual([]);
    expect(plan).toMatchObject({
      actionKind: "payment",
      adapterId: "external-proposal-review",
      protocol: "Sui",
      assetFlowPreview: {
        outgoing: [{ amount: "100", symbol: "USD", amountKind: "display_intent" }],
        expectedIncoming: []
      },
      adapterData: {
        implementationStatus: "read_only_review_only",
        requestedIntent: {
          type: "payment",
          payment: {
            amount: {
              amountKind: "display_proposal"
            }
          }
        }
      }
    });
    expect(plan.reviewModel).toMatchObject({
      proposalId: "payment_1",
      proposalType: "payment",
      proposedAction: {
        purpose: "Pay invoice 42",
        recipient: { address: walletAccount },
        target: "invoice_42"
      },
      freshness: {
        status: "current"
      },
      nonSignableReason: {
        code: "external_proposal_review_only",
        blockedCapabilities: expect.arrayContaining(["transaction_building", "wallet_signing"])
      }
    });
    expect(plan.reviewModel?.requiredUserChoices.map((choice) => choice.id)).toEqual(
      expect.arrayContaining(["source_required_choice_1", "choose_settlement_asset"])
    );
    expect(plan.reviewModel?.unsupportedClaims.map((claim) => claim.id)).toEqual(
      expect.arrayContaining([
        "signing_readiness",
        "route_recommendation",
        "settlement_token_selection",
        "fiat_usd_cash_out",
        "profit_or_pnl"
      ])
    );
    expect(plan.reviewModel?.rejectedExecutableFields.map((field) => field.fieldName)).toEqual(
      expect.arrayContaining(["transactionBytes", "signingRequest", "privateKey", "routeSelectedPlan"])
    );
    expect(plan.reviewModel?.blockingChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "proposal_declared_mainnet",
          status: "warning",
          source: "proposal"
        })
      ])
    );
  });

  it("keeps symbol-only payment assets as required user choices", () => {
    const proposal = externalProposalSchema.parse({
      type: "payment",
      id: "payment_symbol_only",
      source: { kind: "mcp_server", name: "external-payments" },
      network: "sui:mainnet",
      createdAt: "2026-05-24T23:59:00.000Z",
      purpose: "Pay invoice 42",
      payment: {
        amount: { amountDisplay: "100", symbol: "USDC" },
        recipient: { address: walletAccount }
      }
    });

    const plan = externalProposalToActionPlan(proposal, now);

    expect(plan.reviewModel?.missingEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "settlement_asset_selection" })
      ])
    );
    expect(plan.reviewModel?.requiredUserChoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "choose_settlement_asset" })
      ])
    );
    expect(plan.reviewModel?.unsupportedClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "settlement_token_selection" })
      ])
    );
  });

  it("treats external coinType as declared but still unverified", () => {
    const proposal = externalProposalSchema.parse({
      type: "payment",
      id: "payment_coin_type",
      source: { kind: "mcp_server", name: "external-payments" },
      network: "sui:mainnet",
      createdAt: "2026-05-24T23:59:00.000Z",
      purpose: "Pay invoice 42",
      payment: {
        amount: { amountDisplay: "100", symbol: "USDC", coinType: `0x${"b".repeat(64)}::coin::USDC` },
        recipient: { address: walletAccount }
      }
    });

    const plan = externalProposalToActionPlan(proposal, now);

    expect(plan.reviewModel?.missingEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "settlement_asset_metadata_verification" })
      ])
    );
    const requiredChoiceIds = plan.reviewModel?.requiredUserChoices.map((choice) => choice.id) ?? [];
    expect(requiredChoiceIds).not.toContain("choose_settlement_asset");
    expect(requiredChoiceIds).toContain("confirm_settlement_asset");
    expect(plan.reviewModel?.unsupportedClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "settlement_token_selection" })
      ])
    );
  });

  it("keeps settlement-token selection unsupported in MCP answer guidance and review models", () => {
    const proposal = externalProposalSchema.parse({
      type: "payment",
      id: "payment_coin_type_guidance",
      source: { kind: "mcp_server", name: "external-payments" },
      network: "sui:mainnet",
      createdAt: "2026-05-24T23:59:00.000Z",
      purpose: "Pay invoice 42",
      payment: {
        amount: { amountDisplay: "100", symbol: "USDC", coinType: `0x${"b".repeat(64)}::coin::USDC` },
        recipient: { address: walletAccount }
      }
    });

    const guidance = prepareExternalProposalReviewUserAnswerUse();
    const plan = externalProposalToActionPlan(proposal, now);

    expect(guidance.cannotAnswer).toContain("settlement_token_selection");
    expect(plan.reviewModel?.unsupportedClaims.map((claim) => claim.id)).toContain(
      "settlement_token_selection"
    );
  });

  it("keeps external Sui action targets descriptive and blocked", async () => {
    const proposal = externalProposalSchema.parse({
      type: "sui_action",
      id: "action_1",
      source: { kind: "ai_client", name: "assistant-proposal" },
      network: "sui:mainnet",
      createdAt: "2026-05-24T23:59:00.000Z",
      purpose: "Stake-like action proposal",
      action: {
        actionKind: "stake",
        target: {
          packageId: "0x1",
          module: "staking",
          function: "request_add_stake"
        },
        recipient: { label: "validator" },
        assetFlow: [
          {
            direction: "outgoing",
            amount: { amountDisplay: "1", symbol: "SUI" },
            recipient: { label: "validator" }
          }
        ]
      },
      assumptions: ["Validator target was selected by the external source."]
    });

    const plan = externalProposalToActionPlan(proposal, now);
    const state = await computeReviewState({
      reviewSessionId: "review_1",
      plan,
      account: walletAccount,
      now
    });

    expect(plan.reviewModel).toMatchObject({
      proposalType: "sui_action",
      proposedAction: {
        target: {
          packageId: "0x1",
          module: "staking",
          function: "request_add_stake"
        }
      },
      missingEvidence: expect.arrayContaining([
        expect.objectContaining({ id: "action_adapter_support" })
      ]),
      unsupportedClaims: expect.arrayContaining([
        expect.objectContaining({ id: "source_assumptions_unverified" })
      ])
    });
    expect(state).toMatchObject({
      reviewSessionId: "review_1",
      planId: plan.id,
      account: walletAccount,
      status: "blocked",
      blockedReason: "proposal_review_only"
    });
    expect(state.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining(["external_proposal_contract", "external_proposal_review_only"])
    );
  });

  it("rejects executable material hidden inside allowed proposal text values", () => {
    const baseProposal = {
      type: "payment",
      id: "payment_1",
      source: { kind: "mcp_server", name: "external-payments" },
      network: "sui:mainnet",
      createdAt: "2026-05-24T23:59:00.000Z",
      purpose: "Pay invoice",
      payment: {
        amount: { amountDisplay: "100", symbol: "USDC" },
        recipient: { address: walletAccount }
      }
    };
    const longEncodedPayload = "A".repeat(180);
    const rawHexSecretLikeText = "f".repeat(64);
    const rawBase64SecretLikeText = "A".repeat(43) + "=";
    const candidates = [
      {
        ...baseProposal,
        source: {
          ...baseProposal.source,
          reference: `external-reference-${longEncodedPayload}`
        }
      },
      {
        ...baseProposal,
        purpose: "Submit a signing request for this payment."
      },
      {
        ...baseProposal,
        assumptions: ["A route-selected plan was already chosen by the source."]
      },
      {
        ...baseProposal,
        requiredUserChoices: ["Paste a private key before continuing."]
      },
      {
        ...baseProposal,
        payment: {
          ...baseProposal.payment,
          target: "transactionBytes=abc123"
        }
      },
      {
        ...baseProposal,
        purpose: `raw secret-like value ${rawHexSecretLikeText}`
      },
      {
        ...baseProposal,
        requiredUserChoices: [`raw secret-like value ${rawBase64SecretLikeText}`]
      }
    ];

    for (const candidate of candidates) {
      expect(externalProposalSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("rejects recognized Sui private key and valid mnemonic material before plan storage", () => {
    const baseProposal = {
      type: "payment",
      id: "payment_1",
      source: { kind: "mcp_server", name: "external-payments" },
      network: "sui:mainnet",
      createdAt: "2026-05-24T23:59:00.000Z",
      purpose: "Pay invoice",
      payment: {
        amount: { amountDisplay: "100", symbol: "USDC" },
        recipient: { address: walletAccount }
      }
    };
    // Generated per run so no secret-format material is committed to source or
    // git history. A fresh keypair yields a valid `suiprivkey1...` string that
    // exercises the private-key pattern guard, and a fresh BIP39 mnemonic
    // exercises the validateMnemonic guard.
    const privateKey = Ed25519Keypair.generate().getSecretKey();
    const mnemonic = generateMnemonic(wordlist);
    const candidates = [
      { ...baseProposal, source: { ...baseProposal.source, reference: privateKey } },
      { ...baseProposal, assumptions: [mnemonic] }
    ];

    for (const candidate of candidates) {
      expect(externalProposalSchema.safeParse(candidate).success).toBe(false);
      expect(() => externalProposalToActionPlan(candidate as never, now)).toThrow();
    }
  });

  it("requires display proposal amounts to use positive decimal text", () => {
    const baseProposal = {
      type: "payment",
      id: "payment_1",
      source: { kind: "mcp_server", name: "external-payments" },
      network: "sui:mainnet",
      createdAt: "2026-05-24T23:59:00.000Z",
      purpose: "Pay invoice",
      payment: {
        amount: { amountDisplay: "100", symbol: "USDC" },
        recipient: { address: walletAccount }
      }
    };

    for (const amountDisplay of ["one hundred", "1e3", "-1", "0", "0.0", "1,000", " 1"]) {
      expect(
        externalProposalSchema.safeParse({
          ...baseProposal,
          payment: {
            ...baseProposal.payment,
            amount: { ...baseProposal.payment.amount, amountDisplay }
          }
        }).success
      ).toBe(false);
    }

    for (const amountDisplay of ["100", "100.25", "0.5"]) {
      expect(
        externalProposalSchema.safeParse({
          ...baseProposal,
          payment: {
            ...baseProposal.payment,
            amount: { ...baseProposal.payment.amount, amountDisplay }
          }
        }).success
      ).toBe(true);
    }
  });

  it("rejects executable fields and non-mainnet proposal declarations", () => {
    const baseProposal = {
      type: "payment",
      id: "payment_1",
      source: { kind: "mcp_server", name: "external-payments" },
      network: "sui:mainnet",
      createdAt: "2026-05-24T23:59:00.000Z",
      purpose: "Pay invoice",
      payment: {
        amount: { amountDisplay: "100", symbol: "USDC" },
        recipient: { address: walletAccount }
      }
    };

    expect(externalProposalSchema.safeParse({ ...baseProposal, transactionBytes: "abc" }).success).toBe(false);
    expect(
      externalProposalSchema.safeParse({
        ...baseProposal,
        payment: { ...baseProposal.payment, signingRequest: { digest: "abc" } }
      }).success
    ).toBe(false);
    expect(externalProposalSchema.safeParse({ ...baseProposal, network: "sui:testnet" }).success).toBe(false);
  });
});
