import { describe, expect, it } from "vitest";
import {
  ADAPTER_PROMPT_SURFACES,
  adapterPromptSurfaceSchema,
  promptNameFor,
  shorthandActions,
  type AdapterPromptSurface
} from "../src/adapters/adapterPromptSurfaces.js";
import { buildSupportedReviewAdapterDescriptors } from "../src/adapters/reviewAdapters.js";

const unusedProducer = () => {
  throw new Error("not used by descriptor metadata");
};

const descriptorMetadata = buildSupportedReviewAdapterDescriptors({
  deepbookQuoteSource: { quoteDeepbookDisplayAmount: unusedProducer },
  deepbookTransactionMaterialProducer: unusedProducer,
  deepbookTransactionMaterialDigestProducer: unusedProducer,
  transactionObjectOwnershipProducer: unusedProducer,
  deepbookHumanReadableReviewProducer: unusedProducer,
  reviewTimeSimulationProducer: unusedProducer,
  ptbVisualizationProducer: unusedProducer
});

describe("adapter prompt surfaces", () => {
  it("validates every registered surface against the schema", () => {
    for (const surface of ADAPTER_PROMPT_SURFACES) {
      expect(() => adapterPromptSurfaceSchema.parse(surface)).not.toThrow();
    }
  });

  it("binds every surface to a registered adapter descriptor", () => {
    const adapterIds = new Set(descriptorMetadata.map((descriptor) => descriptor.adapterId));
    for (const surface of ADAPTER_PROMPT_SURFACES) {
      expect(adapterIds.has(surface.adapterId)).toBe(true);
    }
  });

  it("produces unique action-first prompt names", () => {
    const names = ADAPTER_PROMPT_SURFACES.map((surface) => promptNameFor(surface));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("swap-deep");
  });

  it("drops the bare-action shorthand once two protocols share an action", () => {
    const competitor: AdapterPromptSurface = {
      ...ADAPTER_PROMPT_SURFACES[0]!,
      adapterId: "other-swap",
      protocolSlug: "other"
    };
    const single = shorthandActions(ADAPTER_PROMPT_SURFACES);
    expect(single.get("swap")?.protocolSlug).toBe("deep");
    const contested = shorthandActions([...ADAPTER_PROMPT_SURFACES, competitor]);
    expect(contested.has("swap")).toBe(false);
  });
});
