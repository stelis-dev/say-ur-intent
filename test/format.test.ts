import { describe, expect, it } from "vitest";
import { mistToSui, rawToDisplay, signedRawToDisplay, SUI_DECIMALS } from "../review-app/src/format.js";

// The shared client-side amount formatter (used by the review and receipt pages).
// These walk the real BigInt math so a regression in padding, trimming, or sign
// handling is caught, not just the function's existence.

describe("rawToDisplay", () => {
  it("places the decimal point and trims trailing zeros", () => {
    expect(rawToDisplay("1500000000", 9)).toBe("1.5");
    expect(rawToDisplay("1000000000", 9)).toBe("1");
    expect(rawToDisplay("5000000", 6)).toBe("5");
    expect(rawToDisplay("1", 9)).toBe("0.000000001");
    expect(rawToDisplay("0", 9)).toBe("0");
  });

  it("keeps every integer digit for large raw amounts (no float rounding)", () => {
    // 218.883618256 SUI — the kind of amount that would lose precision as a float.
    expect(rawToDisplay("218883618256", 9)).toBe("218.883618256");
  });

  it("treats zero decimals as a plain integer", () => {
    expect(rawToDisplay("42", 0)).toBe("42");
  });
});

describe("signedRawToDisplay", () => {
  it("preserves the sign and formats the magnitude", () => {
    expect(signedRawToDisplay("-218883618256", 9)).toBe("-218.883618256");
    expect(signedRawToDisplay("1193043120", 9)).toBe("1.19304312");
  });

  it("never renders a negative zero", () => {
    expect(signedRawToDisplay("0", 9)).toBe("0");
    expect(signedRawToDisplay("-0", 9)).toBe("0");
  });
});

describe("mistToSui", () => {
  it("formats mist using the known SUI decimals", () => {
    expect(SUI_DECIMALS).toBe(9);
    expect(mistToSui("275256")).toBe("0.000275256");
    expect(mistToSui("1000000000")).toBe("1");
  });
});
