// Shared atomic UI components, built as vanilla TypeScript DOM helpers paired
// with the shared stylesheet. Every page composes these instead of defining its
// own component CSS. The stylesheet itself ships as a stable static asset
// (`review-app/public/ui.css`, served at `/review-assets/ui.css`) and is linked
// from each page's <head>, so it is not bundled per entry and is never
// code-split into an unlinked chunk.

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export type ButtonVariant = "primary" | "secondary" | "danger";

export function button(label: string, onClick: () => void, variant: ButtonVariant = "primary"): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className =
    variant === "primary" ? "ui-btn ui-btn--primary" : variant === "danger" ? "ui-btn ui-btn--danger" : "ui-btn";
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

// Inline-SVG icon button. `svgMarkup` is a trusted constant from our own code,
// never user data, so assigning it as innerHTML carries no injection surface.
export function iconButton(svgMarkup: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "ui-icon-btn";
  node.setAttribute("aria-label", ariaLabel);
  node.innerHTML = svgMarkup;
  node.addEventListener("click", onClick);
  return node;
}

export function link(text: string, href: string): HTMLAnchorElement {
  const node = document.createElement("a");
  node.className = "ui-link";
  node.textContent = text;
  node.href = href;
  return node;
}

export function input(options: {
  type?: string;
  value?: string;
  placeholder?: string;
  id?: string;
  name?: string;
}): HTMLInputElement {
  const node = document.createElement("input");
  node.className = "ui-input";
  node.type = options.type ?? "text";
  if (options.value !== undefined) {
    node.value = options.value;
  }
  if (options.placeholder !== undefined) {
    node.placeholder = options.placeholder;
  }
  if (options.id) {
    node.id = options.id;
  }
  if (options.name) {
    node.name = options.name;
  }
  node.autocomplete = "off";
  return node;
}

export function field(labelText: string, control: HTMLElement): HTMLLabelElement {
  const node = document.createElement("label");
  node.className = "ui-field";
  node.append(element("span", undefined, labelText), control);
  return node;
}

export function card(title?: string): HTMLElement {
  const node = element("section", "ui-card");
  if (title) {
    node.append(element("h2", "ui-card-title", title));
  }
  return node;
}

export function row(label: string, value: string | Node): HTMLElement {
  const node = element("div", "ui-row");
  node.append(element("span", "ui-row-label", label));
  const valueNode = element("span", "ui-row-value");
  if (typeof value === "string") {
    valueNode.textContent = value;
  } else {
    valueNode.append(value);
  }
  node.append(valueNode);
  return node;
}

export function sectionTitle(text: string): HTMLElement {
  return element("div", "ui-section-title", text);
}

export function badge(text: string): HTMLElement {
  return element("span", "ui-badge", text);
}

export type PillKind = "neutral" | "ok" | "warn" | "danger";

export function pill(text: string, kind: PillKind = "neutral"): HTMLElement {
  const suffix = kind === "ok" ? " ui-pill--ok" : kind === "warn" ? " ui-pill--warn" : kind === "danger" ? " ui-pill--danger" : "";
  return element("span", `ui-pill${suffix}`, text);
}

export type FeedbackKind = "ok" | "error";

// Result/error feedback tied to an action: persistent (it stays until the next
// render), and able to carry a diagnostic detail line.
export function feedback(kind: FeedbackKind, message: string, detail?: string): HTMLElement {
  const node = element("div", kind === "error" ? "ui-feedback ui-feedback--error" : "ui-feedback ui-feedback--ok");
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.append(element("span", undefined, message));
  if (detail) {
    node.append(element("span", "ui-feedback-detail", detail));
  }
  return node;
}

// Placeholder card shown in a slot whose content is empty, unsupported, or
// unavailable. Keeps the slot's position so the layout does not collapse.
export function placeholder(message: string): HTMLElement {
  return element("div", "ui-placeholder", message);
}

export function h1(text: string): HTMLElement {
  return element("h1", "ui-h1", text);
}

export function subtitle(text: string): HTMLElement {
  return element("p", "ui-subtitle", text);
}

// Quiet boundary/scope note (tier T4).
export function note(text: string): HTMLElement {
  return element("p", "ui-note", text);
}

// Monospace span for ids, addresses, and digests.
export function mono(text: string): HTMLElement {
  return element("span", "ui-mono", text);
}

// Inline info marker. Keeps the visible copy minimal while the full detail is a
// hover/focus tooltip (and is exposed to assistive tech via aria-label).
export function info(detail: string): HTMLElement {
  const node = element("span", "ui-info", "i");
  node.title = detail;
  node.setAttribute("aria-label", detail);
  node.setAttribute("role", "img");
  node.tabIndex = 0;
  return node;
}

// Single source for copy-to-clipboard with transient confirmation. Wired onto any
// button element so the shared copyButton atom and not-yet-migrated pages (which
// style their own bare button) share one behavior. Restores the button's prior
// label after the confirmation.
export function copyToClipboard(target: HTMLButtonElement, getText: () => string, copiedLabel: string): void {
  const idle = target.textContent ?? "";
  void navigator.clipboard
    .writeText(getText())
    .then(() => {
      target.textContent = copiedLabel;
      target.disabled = true;
      window.setTimeout(() => {
        target.textContent = idle;
        target.disabled = false;
      }, 1500);
    })
    .catch(() => {
      // Clipboard unavailable; leave the button unchanged.
    });
}

// Secondary button that copies text to the clipboard and briefly confirms. The
// text is produced lazily so the caller serializes current state at click time.
export function copyButton(label: string, getText: () => string, copiedLabel: string): HTMLButtonElement {
  const node = button(label, () => copyToClipboard(node, getText, copiedLabel), "secondary");
  return node;
}

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

// Search field: one control with the input and a magnifier button inside it on
// the right. `onSearch` fires on the button or Enter.
export function searchField(options: {
  value?: string;
  placeholder?: string;
  ariaLabel: string;
  onSearch: (value: string) => void;
}): HTMLElement {
  const wrap = element("div", "ui-search");
  const control = input({ value: options.value ?? "", placeholder: options.placeholder ?? "" });
  control.spellcheck = false;
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "ui-search-btn";
  submit.setAttribute("aria-label", options.ariaLabel);
  submit.innerHTML = SEARCH_ICON;
  submit.addEventListener("click", () => options.onSearch(control.value));
  control.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      options.onSearch(control.value);
    }
  });
  wrap.append(control, submit);
  return wrap;
}
