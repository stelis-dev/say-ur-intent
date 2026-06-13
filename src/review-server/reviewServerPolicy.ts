export const ALLOWED_HOSTNAMES = ["127.0.0.1", "localhost"];

// The review page signs and then submits the signed transaction to the Sui
// mainnet fullnode directly from the browser (review-app/src/dappKitClient.ts
// `suiMainnetClient`). Execution stays on the page on purpose: the local server
// never executes transactions. That cross-origin submission must be allowlisted
// in the review/analysis page CSP `connect-src`. Use the scheme+host with no
// port: the browser issues the request on the default https port (443) and a
// CSP source that pins `:443` would not match it. Keep this in sync with the
// `suiMainnetClient` base URL.
export const SUI_BROWSER_EXECUTION_ORIGIN = "https://fullnode.mainnet.sui.io";
