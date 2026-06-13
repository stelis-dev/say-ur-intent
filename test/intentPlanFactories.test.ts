import { describe, expect, it } from "vitest";
import {
  INTENT_PLAN_FACTORIES,
  resolveIntentPlanFactory,
  swapIntentInputSchema,
  type IntentPlanFactory
} from "../src/adapters/intentPlanFactories.js";
import { ADAPTER_PROMPT_SURFACES } from "../src/adapters/adapterPromptSurfaces.js";
import { SUPPORTED_PROTOCOLS } from "../src/mcp/tools/read/index.js";

const competitor: IntentPlanFactory = {
  ...INTENT_PLAN_FACTORIES[0]!,
  adapterId: "other-swap",
  protocolSlug: "other",
  protocol: "OtherSwap"
};

describe("intent plan factories", () => {
  it("resolves a single registered protocol without an explicit slug", () => {
    const single = INTENT_PLAN_FACTORIES.filter((factory) => factory.protocolSlug === "deep");
    const resolution = resolveIntentPlanFactory(single, "swap");
    expect(resolution.status).toBe("resolved");
    if (resolution.status === "resolved") {
      expect(resolution.factory.adapterId).toBe("deepbook-swap");
    }
  });

  it("requires an explicit protocol now that two protocols register swap", () => {
    const resolution = resolveIntentPlanFactory(INTENT_PLAN_FACTORIES, "swap");
    expect(resolution).toMatchObject({
      status: "protocol_choice_required",
      available: ["deep", "flowx"]
    });
    const flowx = resolveIntentPlanFactory(INTENT_PLAN_FACTORIES, "swap", "flowx");
    expect(flowx.status).toBe("resolved");
    if (flowx.status === "resolved") {
      expect(flowx.factory.adapterId).toBe("flowx-swap");
      expect(flowx.factory.protocol).toBe("FlowXCLMM");
    }
  });

  it("refuses to pick a venue silently once two protocols share an action", () => {
    const contested = [...INTENT_PLAN_FACTORIES, competitor];
    const resolution = resolveIntentPlanFactory(contested, "swap");
    expect(resolution).toMatchObject({
      status: "protocol_choice_required",
      available: ["deep", "flowx", "other"]
    });
    const explicit = resolveIntentPlanFactory(contested, "swap", "other");
    expect(explicit.status).toBe("resolved");
  });

  it("reports unknown protocols with the available slugs", () => {
    const resolution = resolveIntentPlanFactory(INTENT_PLAN_FACTORIES, "swap", "nope");
    expect(resolution).toMatchObject({ status: "unknown_protocol", available: ["deep", "flowx"] });
  });

  it("reports unsupported action kinds", () => {
    expect(resolveIntentPlanFactory(INTENT_PLAN_FACTORIES, "stake")).toMatchObject({
      status: "unsupported_action"
    });
  });

  it("keeps factory slugs aligned with the prompt surfaces", () => {
    for (const factory of INTENT_PLAN_FACTORIES) {
      const surface = ADAPTER_PROMPT_SURFACES.find((candidate) => candidate.adapterId === factory.adapterId);
      expect(surface, factory.adapterId).toBeDefined();
      expect(surface?.action).toBe(factory.actionKind);
      expect(surface?.protocolSlug).toBe(factory.protocolSlug);
    }
  });

  it("accepts the protocol-neutral swap intent with and without a protocol slug", () => {
    const base = {
      type: "swap",
      from: { symbol: "SUI", amount: "1" },
      to: { symbol: "USDC" },
      maxSlippageBps: 50
    };
    expect(swapIntentInputSchema.safeParse(base).success).toBe(true);
    expect(swapIntentInputSchema.safeParse({ ...base, protocol: "deep" }).success).toBe(true);
  });

  it("orders swap protocols consistently across selection, prompt, and status surfaces", () => {
    const factoryOrder = INTENT_PLAN_FACTORIES.filter((factory) => factory.actionKind === "swap").map(
      (factory) => factory.protocolSlug
    );
    const surfaceOrder = ADAPTER_PROMPT_SURFACES.filter((surface) => surface.action === "swap").map(
      (surface) => surface.protocolSlug
    );
    // The user picks a venue from these surfaces, so they must offer the same
    // order; "deep before flowx" lives in three registries and would otherwise
    // drift.
    expect(factoryOrder).toEqual(["deep", "flowx"]);
    expect(surfaceOrder).toEqual(factoryOrder);
    // The status list leads with the swap venues in the same order before the
    // notes-only margin entry.
    const statusSwapVenues = SUPPORTED_PROTOCOLS.map((protocol) => protocol.id).filter(
      (id) => id === "deepbook-v3" || id === "flowx-clmm"
    );
    expect(statusSwapVenues).toEqual(["deepbook-v3", "flowx-clmm"]);
  });
});
