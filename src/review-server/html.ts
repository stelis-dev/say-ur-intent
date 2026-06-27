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

export function reviewExecutionAnalysisHtml(sessionId: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Say Ur Intent Review Execution Analysis</title>
    <link rel="stylesheet" href="/review-assets/reviewExecutionAnalysis.css">
  </head>
  <body>
    <main id="review-execution-analysis-app" data-review-session-id="${escapeHtml(sessionId)}">
      <h1>Review Execution Analysis</h1>
      <p>Loading local review execution analysis...</p>
    </main>
    <script type="module" src="/review-assets/reviewExecutionAnalysis.js"></script>
  </body>
</html>`;
}

export function analysisHtml(sessionId: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Say Ur Intent Analysis</title>
    <link rel="stylesheet" href="/review-assets/analysis.css">
  </head>
  <body>
    <main id="analysis-app" data-wallet-session-id="${escapeHtml(sessionId)}">
      <h1>Say Ur Intent Analysis</h1>
      <p>Connect a Sui mainnet wallet to provide an account address for account-bound checks.</p>
    </main>
    <script type="module" src="/review-assets/analysis.js"></script>
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
    <main id="deepbook-usdc-chart-app">
      <h1>DeepBook USDC candles</h1>
      <p>Loading local chart page...</p>
    </main>
    <script type="module" src="/review-assets/deepbookUsdcChart.js"></script>
  </body>
</html>`;
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
