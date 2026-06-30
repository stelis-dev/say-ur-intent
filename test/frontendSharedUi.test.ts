import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shellBrandIsLink, shellNavItems, themeToggleIcon } from "../review-app/src/ui/shell.js";

// Plan B Unit B1: the shared shell's navigation rule and the shared-vs-page
// styling boundary. These are behavioral source guards, not string-presence
// checks: the navigation assertions walk the actual returned items, and the CSS
// assertions parse each page stylesheet's selectors.

describe("shared shell navigation (Plan B B1)", () => {
  it("token pages get no navigation, no public links, and no exit path", () => {
    // The chrome the shell renders for a token page is driven entirely by these
    // pure decisions: no nav items (so no nav and no public links), and the brand
    // is not a link (no exit path). The rendered DOM is checked in the browser.
    expect(shellNavItems("token")).toEqual([]);
    expect(shellBrandIsLink("token")).toBe(false);
  });

  it("public pages get the three public links, the active one marked, none a token route, with a home exit", () => {
    const items = shellNavItems("account");
    expect(items.map((item) => item.href)).toEqual(["/account", "/receipt", "/charts/deepbook-usdc"]);
    expect(items.filter((item) => item.current).map((item) => item.key)).toEqual(["account"]);
    for (const item of items) {
      expect(/^\/(connect|review|settings)\//.test(item.href), `${item.href} must not be a token route`).toBe(false);
    }
    expect(shellBrandIsLink("account")).toBe(true);
  });

  it("the homepage shows the public nav with no current link", () => {
    const items = shellNavItems("home");
    expect(items).toHaveLength(3);
    expect(items.some((item) => item.current)).toBe(false);
  });
});

describe("theme toggle icon reflects the current theme (Plan B)", () => {
  // The toggle must show the icon for the theme that is active right now, not the
  // theme it would switch to: a moon while dark, a sun while light. The moon glyph
  // is one distinctive path; the sun is a centre circle with rays.
  it("shows a moon while dark", () => {
    const icon = themeToggleIcon("dark");
    expect(icon).toContain("M21 12.8");
    expect(icon).not.toContain("circle");
  });

  it("shows a sun while light", () => {
    const icon = themeToggleIcon("light");
    expect(icon).toContain('circle cx="12" cy="12" r="4"');
    expect(icon).not.toContain("M21 12.8");
  });
});

const BARE_INTERACTIVE_ELEMENTS = ["button", "input", "select", "textarea"];

function readCss(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function selectorsOf(cssSource: string): string[] {
  const withoutComments = cssSource.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutComments
    .split("}")
    .map((block) => block.split("{")[0] ?? "")
    .flatMap((selectorList) => selectorList.split(","))
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0 && !selector.startsWith("@"));
}

function targetsBareInteractiveElement(selector: string): boolean {
  return selector.split(/[\s>+~]+/).some((compound) => {
    const head = compound.match(/^[a-zA-Z]+/)?.[0]?.toLowerCase();
    return head !== undefined && BARE_INTERACTIVE_ELEMENTS.includes(head);
  });
}

describe("shared-vs-page styling boundary (Plan B B1)", () => {
  it("the shared stylesheet owns the ui- atomic components", () => {
    const ui = readCss("review-app/public/ui.css");
    const atoms = [
      ".ui-shell",
      ".ui-header",
      ".ui-nav",
      ".ui-btn",
      ".ui-btn-row",
      ".ui-input",
      ".ui-card",
      ".ui-row",
      ".ui-badge",
      ".ui-pill",
      ".ui-chip",
      ".ui-wallet-chip",
      ".ui-wallet-chip-dot",
      ".ui-agent-badge",
      ".ui-select",
      ".ui-status-banner",
      ".ui-detail-item",
      ".ui-ptb-graph",
      ".ui-accordion",
      ".ui-feedback",
      ".ui-toast",
      ".ui-placeholder",
      ".ui-skeleton",
      ".ui-overlay"
    ];
    for (const atom of atoms) {
      expect(ui, `ui.css declares ${atom}`).toContain(atom);
    }
  });

  // Pages migrated onto the shared module in Unit B1. Later units add their pages
  // to this list as they migrate.
  const migratedPageCss = [
    "review-app/src/account.css",
    "review-app/src/connect.css",
    "review-app/src/homepage.css",
    "review-app/src/notFound.css",
    "review-app/src/receipt.css",
    "review-app/src/review.css",
    "review-app/src/deepbookUsdcChart.css",
    "review-app/src/settings.css"
  ];

  it("migrated page stylesheets declare no ui- class rule and no bare interactive-element rule", () => {
    for (const path of migratedPageCss) {
      for (const selector of selectorsOf(readCss(path))) {
        expect(selector.includes(".ui-"), `${path}: "${selector}" must not target a shared atom`).toBe(false);
        expect(
          targetsBareInteractiveElement(selector),
          `${path}: "${selector}" must not style a bare interactive element`
        ).toBe(false);
      }
    }
  });
});
