export function reviewHtml(sessionId: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Say Ur Intent Review</title>
    <link rel="stylesheet" href="/review-assets/review.css">
  </head>
  <body>
    <main id="review-app" data-review-session-id="${escapeHtml(sessionId)}">
      <h1>Say Ur Intent Review</h1>
      <p>Loading local review session...</p>
    </main>
    <script type="module" src="/review-assets/review.js"></script>
  </body>
</html>`;
}

export function connectHtml(sessionId: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Say Ur Intent Connect</title>
    <link rel="stylesheet" href="/review-assets/connect.css">
  </head>
  <body>
    <main id="connect-app" data-wallet-session-id="${escapeHtml(sessionId)}">
      <h1>Connect your Sui wallet</h1>
      <p>Connect a Sui mainnet wallet to bind its address as the active account for account-bound review.</p>
    </main>
    <script type="module" src="/review-assets/connect.js"></script>
  </body>
</html>`;
}

export function analyticsHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Say Ur Intent Analytics</title>
    <link rel="stylesheet" href="/review-assets/analytics.css">
  </head>
  <body>
    ${publicNavHtml("analytics")}
    <main id="analytics-app">
      <h1>Analytics</h1>
      <p>Loading public on-chain asset analytics...</p>
    </main>
    <script type="module" src="/review-assets/analytics.js"></script>
  </body>
</html>`;
}

export function receiptHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Say Ur Intent Receipt Analytics</title>
    <link rel="stylesheet" href="/review-assets/receipt.css">
  </head>
  <body>
    ${publicNavHtml("receipt")}
    <main id="receipt-app">
      <h1>Receipt Analytics</h1>
      <p>Loading public on-chain receipt facts...</p>
    </main>
    <script type="module" src="/review-assets/receipt.js"></script>
  </body>
</html>`;
}

export function settingsHtml(sessionId: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Say Ur Intent Settings</title>
    <link rel="stylesheet" href="/review-assets/settings.css">
  </head>
  <body>
    <main id="settings-app" data-settings-session-id="${escapeHtml(sessionId)}">
      <h1>Say Ur Intent Settings</h1>
      <p id="settings-status" role="status" aria-live="polite">Loading local settings...</p>
    </main>
    <script type="module" src="/review-assets/settings.js"></script>
  </body>
</html>`;
}

export function deepbookUsdcChartHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>DeepBook USDC Candles</title>
    <link rel="stylesheet" href="/review-assets/deepbookUsdcChart.css">
  </head>
  <body>
    ${publicNavHtml("chart")}
    <main id="deepbook-usdc-chart-app">
      <h1>DeepBook USDC candles</h1>
      <p>Loading local chart page...</p>
    </main>
    <script type="module" src="/review-assets/deepbookUsdcChart.js"></script>
  </body>
</html>`;
}

// Shared navigation for the public pages only. It links to public pages and
// never to a token page (Connect, Review & Execution, Settings). It is rendered
// outside <main>, which the page script owns and clears, so the menu survives a
// re-render. No inline style (the chart page's CSP is style-src 'self').
function publicNavHtml(current: "analytics" | "receipt" | "chart"): string {
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
