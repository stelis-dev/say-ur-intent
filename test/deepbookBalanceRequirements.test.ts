import { describe, expect, it } from "vitest";
import { deepbookSwapBalanceRequirements } from "../src/adapters/deepbook/deepbookTransactionMaterialProducer.js";

const SUI = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
const USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

describe("deepbookSwapBalanceRequirements", () => {
  it("adds the gas budget to a SUI source requirement", () => {
    const requirements = deepbookSwapBalanceRequirements({
      sourceSymbol: "SUI",
      sourceCoinType: SUI,
      sourceDecimals: 9,
      sourceAmountRaw: 1_100_000_000n
    });
    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toMatchObject({ symbol: "SUI", requiredRaw: 1_150_000_000n });
  });

  it("requires the source coin plus a separate SUI gas reserve for non-SUI sources", () => {
    const requirements = deepbookSwapBalanceRequirements({
      sourceSymbol: "USDC",
      sourceCoinType: USDC,
      sourceDecimals: 6,
      sourceAmountRaw: 750_000n
    });
    expect(requirements).toHaveLength(2);
    expect(requirements[0]).toMatchObject({ symbol: "USDC", requiredRaw: 750_000n });
    expect(requirements[1]).toMatchObject({ symbol: "SUI", requiredRaw: 50_000_000n });
  });
});
