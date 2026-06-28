import { renderShell } from "./ui/shell.js";
import { element } from "./ui/ui.js";
import { t } from "./i18n/i18n.js";
import "./homepage.css";

const mount = document.querySelector<HTMLElement>("#home-app");
if (!mount) {
  throw new Error("home app root missing");
}
const shell = renderShell(mount, "home");

// Inline SVG icons (trusted constants), themed via currentColor.
const WALLET_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 12h.01"/><path d="M3 9V7a2 2 0 0 1 2-2h12"/></svg>';
const RECEIPT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v16l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6"/><path d="M9 11h6"/></svg>';
const CHART_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5v14h16"/><path d="M8 15l3-3 3 2 4-5"/></svg>';

const CARDS: ReadonlyArray<{ href: string; icon: string; title: string; desc: string }> = [
  { href: "/analytics", icon: WALLET_ICON, title: t.home.cards.analytics.title, desc: t.home.cards.analytics.desc },
  { href: "/receipt", icon: RECEIPT_ICON, title: t.home.cards.receipt.title, desc: t.home.cards.receipt.desc },
  { href: "/charts/deepbook-usdc", icon: CHART_ICON, title: t.home.cards.chart.title, desc: t.home.cards.chart.desc }
];

function homeCard(card: { href: string; icon: string; title: string; desc: string }): HTMLElement {
  const node = document.createElement("a");
  node.className = "ui-card home-card";
  node.href = card.href;
  const icon = element("div", "home-card-icon");
  icon.innerHTML = card.icon;
  node.append(icon, element("h2", "ui-card-title", card.title), element("p", "home-card-desc", card.desc));
  return node;
}

const hero = element("div", "home-hero");
hero.append(element("h1", "home-hook", t.home.hook), element("p", "home-lede", t.home.lede));

const cards = element("div", "home-cards");
for (const card of CARDS) {
  cards.append(homeCard(card));
}

shell.main.replaceChildren(hero, cards, element("p", "home-agent-note", t.home.agentNote));
