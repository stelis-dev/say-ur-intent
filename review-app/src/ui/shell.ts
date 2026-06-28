// The shared page shell: one header, the public navigation (or none on token
// pages), a mobile menu drawer, the main content area, and the full-page loading
// overlay. Every page renders into the `main` this returns and clears only that
// region; the shell chrome (header, nav) persists across the page's re-renders.
import { element, iconButton } from "./ui.js";
import { currentTheme, initTheme, toggleTheme } from "./theme.js";
import { t } from "../i18n/i18n.js";

// Public pages pass their nav key (the shared nav shows, with that link current);
// "home" shows the nav with no current link (the homepage/not-found page); token
// pages pass "token" for no navigation and no exit path.
export type ShellNav = "home" | "analytics" | "receipt" | "chart" | "token";

export type Shell = {
  root: HTMLElement;
  main: HTMLElement;
  setBusy(busy: boolean, label?: string): void;
};

const PUBLIC_NAV: ReadonlyArray<{ key: ShellNav; label: string; href: string }> = [
  { key: "analytics", label: t.shell.nav.analytics, href: "/analytics" },
  { key: "receipt", label: t.shell.nav.receipt, href: "/receipt" },
  { key: "chart", label: t.shell.nav.chart, href: "/charts/deepbook-usdc" }
];

export type ShellNavItem = { key: ShellNav; label: string; href: string; current: boolean };

// The navigation items the shell renders for a given page. Token pages get none
// (no navigation, no exit path); public pages get the three public links with the
// active page marked. Kept as a pure function so the token-mode rule is testable
// without a DOM.
export function shellNavItems(nav: ShellNav): ShellNavItem[] {
  if (nav === "token") {
    return [];
  }
  return PUBLIC_NAV.map((item) => ({
    key: item.key,
    label: item.label,
    href: item.href,
    current: item.key === nav
  }));
}

// Whether the brand mark links home. Token pages have no exit path, so their
// brand renders as plain text, not a link.
export function shellBrandIsLink(nav: ShellNav): boolean {
  return nav !== "token";
}

const SUN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const MENU_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

function brandImg(className: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = className;
  img.src = `/review-assets/${className === "ui-brand-light" ? "brand-light" : "brand-dark"}.svg`;
  img.alt = "";
  img.width = 24;
  img.height = 24;
  return img;
}

function brandNode(asLink: boolean): HTMLElement {
  const light = brandImg("ui-brand-light");
  const dark = brandImg("ui-brand-dark");
  const text = element("span", undefined, t.brand);
  if (asLink) {
    const node = document.createElement("a");
    node.className = "ui-brand";
    node.href = "/";
    node.append(light, dark, text);
    return node;
  }
  const node = element("span", "ui-brand");
  node.append(light, dark, text);
  return node;
}

function navLink(item: { label: string; href: string }, current: boolean): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = item.href;
  link.textContent = item.label;
  if (current) {
    link.setAttribute("aria-current", "page");
  }
  return link;
}

export function renderShell(mount: HTMLElement, nav: ShellNav): Shell {
  initTheme();

  const root = element("div", "ui-shell");
  const header = element("header", "ui-header");

  const navItems = shellNavItems(nav);
  header.append(brandNode(shellBrandIsLink(nav)));

  if (navItems.length > 0) {
    const navEl = element("nav", "ui-nav");
    navEl.setAttribute("aria-label", t.shell.publicPages);
    for (const item of navItems) {
      navEl.append(navLink(item, item.current));
    }
    header.append(navEl);
  }

  header.append(element("span", "ui-header-spacer"));

  const themeButton = iconButton(currentTheme() === "dark" ? SUN_ICON : MOON_ICON, t.shell.toggleTheme, () => {
    const next = toggleTheme();
    themeButton.innerHTML = next === "dark" ? SUN_ICON : MOON_ICON;
  });
  // The theme toggle comes before the mobile menu button; the menu button is the
  // last item and shows only at mobile width.
  header.append(themeButton);

  let drawer: HTMLElement | undefined;
  if (navItems.length > 0) {
    const menuButton = iconButton(MENU_ICON, t.shell.openMenu, () => {
      root.classList.toggle("ui-drawer-open");
    });
    menuButton.classList.add("ui-menu-btn");
    header.append(menuButton);
    drawer = element("div", "ui-drawer");
    for (const item of navItems) {
      drawer.append(navLink(item, item.current));
    }
  }

  const main = element("main", "ui-main");

  const overlay = element("div", "ui-overlay");
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  const box = element("div", "ui-overlay-box");
  box.append(element("div", "ui-spinner"));
  const overlayLabel = element("span", "ui-overlay-label", "Processing…");
  box.append(overlayLabel);
  overlay.append(box);

  root.append(header);
  if (drawer) {
    root.append(drawer);
  }
  root.append(main, overlay);
  mount.replaceChildren(root);

  return {
    root,
    main,
    setBusy(busy: boolean, label?: string): void {
      if (label) {
        overlayLabel.textContent = label;
      }
      if (busy) {
        root.setAttribute("aria-busy", "true");
      } else {
        root.removeAttribute("aria-busy");
      }
    }
  };
}
