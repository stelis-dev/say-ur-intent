// Page HTML shells served by the review server. Each page is a minimal document:
// the shared <head> (charset, viewport, title, favicon, the page stylesheet) and
// a mount element plus the page's module script. The shared UI module renders the
// header, navigation, and content into the mount on the public pages it has
// already migrated; pages not yet migrated keep their existing body. `data-theme`
// defaults to light on <html> so there is no unstyled flash before the theme
// helper applies the stored or preferred theme.

type PageDocumentOptions = {
  title: string;
  css: string;
  js: string;
  body: string;
  // Pages migrated onto the shared UI module link the shared stylesheet; pages
  // not yet migrated keep only their own stylesheet so the shared global rules
  // (box-sizing, body tokens) do not shift their existing layout.
  ui: boolean;
};

function pageDocument(options: PageDocumentOptions): string {
  const uiLink = options.ui ? `    <link rel="stylesheet" href="/review-assets/ui.css">\n` : "";
  return `<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${options.title}</title>
    <link rel="icon" type="image/svg+xml" href="/review-assets/favicon.svg">
${uiLink}    <link rel="stylesheet" href="/review-assets/${options.css}">
  </head>
  <body>
${options.body}
    <script type="module" src="/review-assets/${options.js}"></script>
  </body>
</html>`;
}

export function homeHtml(): string {
  return pageDocument({
    title: "Say Ur Intent",
    css: "homepage.css",
    js: "homepage.js",
    ui: true,
    body: `    <div id="home-app"></div>`
  });
}

export function notFoundHtml(): string {
  return pageDocument({
    title: "Page not found · Say Ur Intent",
    css: "notFound.css",
    js: "notFound.js",
    ui: true,
    body: `    <div id="not-found-app"></div>`
  });
}

export function reviewHtml(sessionId: string): string {
  return pageDocument({
    title: "Say Ur Intent Review",
    css: "review.css",
    js: "review.js",
    ui: false,
    body: `    <main id="review-app" data-review-session-id="${escapeHtml(sessionId)}">
      <h1>Say Ur Intent Review</h1>
      <p>Loading local review session...</p>
    </main>`
  });
}

export function connectHtml(sessionId: string): string {
  return pageDocument({
    title: "Say Ur Intent Connect",
    css: "connect.css",
    js: "connect.js",
    ui: false,
    body: `    <main id="connect-app" data-wallet-session-id="${escapeHtml(sessionId)}">
      <h1>Connect your Sui wallet</h1>
      <p>Connect a Sui mainnet wallet to bind its address as the active account for account-bound review.</p>
    </main>`
  });
}

export function analyticsHtml(): string {
  return pageDocument({
    title: "Say Ur Intent Analytics",
    css: "analytics.css",
    js: "analytics.js",
    ui: true,
    body: `    <div id="analytics-app"></div>`
  });
}

export function receiptHtml(): string {
  return pageDocument({
    title: "Say Ur Intent Receipt Analytics",
    css: "receipt.css",
    js: "receipt.js",
    ui: false,
    body: `    ${publicNavHtml("receipt")}
    <main id="receipt-app">
      <h1>Receipt Analytics</h1>
      <p>Loading public on-chain receipt facts...</p>
    </main>`
  });
}

export function settingsHtml(sessionId: string): string {
  return pageDocument({
    title: "Say Ur Intent Settings",
    css: "settings.css",
    js: "settings.js",
    ui: false,
    body: `    <main id="settings-app" data-settings-session-id="${escapeHtml(sessionId)}">
      <h1>Say Ur Intent Settings</h1>
      <p id="settings-status" role="status" aria-live="polite">Loading local settings...</p>
    </main>`
  });
}

export function deepbookUsdcChartHtml(): string {
  return pageDocument({
    title: "DeepBook USDC Candles",
    css: "deepbookUsdcChart.css",
    js: "deepbookUsdcChart.js",
    ui: false,
    body: `    ${publicNavHtml("chart")}
    <main id="deepbook-usdc-chart-app">
      <h1>DeepBook USDC candles</h1>
      <p>Loading local chart page...</p>
    </main>`
  });
}

// Shared navigation for the public pages not yet migrated to the shared shell
// (Receipt Analytics and the DeepBook chart). It links to public pages only,
// never to a token page, and is rendered outside <main>, which the page script
// owns and clears, so the menu survives a re-render. Migrated public pages render
// their navigation through the shared shell instead.
function publicNavHtml(current: "receipt" | "chart"): string {
  const links: Array<{ key: "analytics" | "receipt" | "chart"; href: string; label: string }> = [
    { key: "analytics", href: "/analytics", label: "Analytics" },
    { key: "receipt", href: "/receipt", label: "Receipt Analytics" },
    { key: "chart", href: "/charts/deepbook-usdc", label: "DeepBook USDC Chart" }
  ];
  const items = links.map((link) =>
    link.key === current
      ? `<span aria-current="page">${link.label}</span>`
      : `<a href="${link.href}">${link.label}</a>`
  );
  return `<nav class="public-nav" aria-label="Public pages">${items.join(" | ")}</nav>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return replacements[char] ?? char;
  });
}
