import { renderShell } from "./ui/shell.js";
import { element, h1, link, subtitle } from "./ui/ui.js";
import { t } from "./i18n/i18n.js";
import "./notFound.css";

const mount = document.querySelector<HTMLElement>("#not-found-app");
if (!mount) {
  throw new Error("not-found app root missing");
}
const shell = renderShell(mount, "home");

// A real recovery anchor (the shared link atom), so the browser's link semantics
// work — open in a new tab, copy the address, follow normally.
const actions = element("div", "not-found-actions");
actions.append(link(t.notFound.home, "/"));

const content = element("div", "not-found");
content.append(h1(t.notFound.title), subtitle(t.notFound.lede), actions);

shell.main.replaceChildren(content);
