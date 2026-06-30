# Frontend Policy

Say Ur Intent frontend pages are local review and wallet-context surfaces. They
exist to show server-validated facts, capture explicit wallet gestures, and
keep AI reasoning separate from wallet authority.

The current release ships the Connect page, the public Account page, the local
settings page, a review page that can display server-computed review state, the
public Receipt Analytics page, and the DeepBook USDC chart page. The review server may build local unsigned
DeepBook or FlowX swap transaction material during account-bound review, but the
frontend does not receive transaction bytes outside the digest-gated handoff.
The review page offers a sign action only on a
`ready_for_wallet_review` state whose wallet account matches the reviewed
account; it never builds transactions in the frontend.

## Role

Current release frontend surfaces may capture wallet identity, display review
state, request refresh when allowed, and report page-local signed-digest or
failure events for server-owned receipt handling. They do not submit wallet
signatures or decide final chain receipt truth.

It is not a trading dashboard, AI chat, portfolio app, alert surface, analytics screen, or safety oracle.

## Display Priority

Show the minimum facts needed for the user's decision first:

1. What is happening?
2. Can the user proceed?
3. What happens if the user proceeds?
4. What is the next action?

Technical details sit in their own cards below the primary decision — always
visible there, never crowding the primary card — with their granular per-record
lists behind compact details controls inside those cards. Raw protocol data must
not dominate the primary screen.

## Information Source

Primary UI may render only server-validated structured data. AI-generated interpretation must not appear as trusted review fact.

The frontend must not compute quote truth, readiness, blocked status, safety, or
final execution truth. In the current release, it may render state, connect a
wallet, ask the server to refresh, revoke wallet identity when that action
exists, and report the signed digest or local failure event that starts
server-owned receipt handling. The public Receipt Analytics page must render
only the server-read receipt facts from the receipt endpoint and must not call
Sui RPC, dapp-kit, or wallet APIs.

## Wallet Identity

Wallet identity is the product path for active-account reads and account-bound review. Manual address entry is not a product path for the review UI or wallet identity flow. MCP explicit-address inputs for public coin balance snapshots are separate read-only tool inputs and do not create active account context.

Sender-independent DeepBook market reads do not require wallet identity. Wallet identity capture is not signing authorization.

The user must be able to see the active wallet account when connected.

Reusable identity sessions may set an ambient read context after the user connects a wallet. This read context remains until the user clears it or replaces it with another wallet identity. It must be presented as active account context, not login, signing authorization, custody, or permission for transactions.

When a wallet exposes multiple accounts, Say Ur Intent captures the account returned by the wallet connection result. The UI must display that account clearly. Choosing a different account requires replacing the active account context with another wallet identity connection.

## Review Surface

Each action review is a separate ceremony. The review screen prioritizes asset flow over protocol internals.

Required primary facts:

- action summary
- send amount
- expected receive or minimum receive
- current review status
- next action

When a user can spend more than the displayed send amount, the top-level asset flow must show the spend limit with explicit language such as `up to`. Do not hide max spend in secondary details when it changes the user's decision.

`assetFlowPreview` entries with `amountKind: "display_intent"` are display-only proposal facts. They are different from review-time `assetFlowActual`, simulation summaries, and balance changes, and the frontend must not use them as signing input, minimum receive, or transaction-building input.

When a plan includes `reviewModel`, the review page must show the external
proposal source, proposed action, asset flow, recipient or target, freshness,
missing evidence, required user choices, unsupported claims, blocking checks,
and `nonSignableReason`. These fields are review annotations only. They are not
transaction material. They are not route selection or settlement-token
selection. They are not wallet readiness, signing readiness, or execution
safety.

In the current release, the review page reconnects the bound active account, reloads the active account context, and requests account-bound review computation. It does not create a wallet identity session; wallet identity sessions are created only on the Connect page.

It renders server-returned review checks for the resolved direct pool, raw quote evidence, quote freshness, derived raw min-out policy, DEEP fee raw evidence, and internal digest commitment.
It may also render a server-returned check that local unsigned DeepBook swap
transaction material was built and kept internal to the review server.
It may render `reviewState.humanReadableReview` when the server returns it. That
summary is displayable review evidence projected from server-verified private
review artifacts. The frontend must not recompute its quote truth, object
ownership, freshness, blocked status, or readiness.
It may render `reviewState.simulation` when the server returns it. That summary
is a redacted projection from private review-time simulation evidence for stored
local transaction material. The frontend must not recompute simulation truth.
The frontend must not extract transaction bytes or a public digest from it.
The frontend must not treat it as wallet readiness or signing readiness.
The frontend must not treat it as execution readiness or proof of wallet
submission.

It must keep those checks as review evidence only.
It must not treat them as public transaction bytes, wallet readiness, signing readiness, route quality, or execution safety.

Compact secondary facts:

- venue or protocol
- quote timestamp
- gas estimate when available
- max spend when available

Details:

- pool ID
- package ID
- object changes
- balance changes
- simulation summary
- Review checks

Review checks are generally details. Failed checks and warning checks that determine the current `blocked` or `refresh_required` status must be elevated next to the status banner so the user can understand the reason without opening details.

If the server returns a `PtbVisualizationArtifact`, the frontend may render only
Mermaid flowchart text plus diagnostics. The panel must show the generated time,
source, diagnostics, and unsupported-use boundary when those fields are present.
The Mermaid graph may show a registered Move Registry package name in place of a
registered package address, with a control to switch back to raw addresses and a
copyable Mermaid source that keeps raw addresses; that name is a package identity
label, not a safety, trust, route-quality, or signing-readiness signal, and any
package that is not registered keeps its raw address.
It must not store or render executable transaction material, wallet signature
requests, private-key material, or arbitrary Move calls. A PTB graph is not a
sign action, not a transaction-building action, not a wallet readiness signal,
not a signing readiness signal, not a payment execution readiness signal, not a
route-quality signal, and not an execution-safety signal.

## Current Release State Rules

The review page is a state wizard with three displayed steps (Review, Sign,
Result) over nine page states. Every state keeps the same constant layout: the
step indicator, a one-line state headline, the constant Transaction card
(plan-level values that fill in with reviewed values), the state-specific
block, and an always-visible Audit record card (its copy-as-Markdown action a
title-bar icon, its record sections behind nested disclosures). The ready state
additionally shows an always-visible Transaction details card (estimated balance
changes, the gas breakdown, and the PTB graph) below the Transaction card. Only
the current state's actions are rendered;
out-of-state buttons are removed, not disabled.

The sign action appears only on `ready_for_wallet_review` with an emitted
wallet review contract, a connected wallet whose account equals the reviewed
account, and a successful digest-gated handoff. The signing step shows no wallet picker:
dapp-kit autoconnect restores the wallet recorded for the active account on the
fixed-port origin, and the sign action stays gated on the connected account
matching the reviewed account. When autoconnect cannot establish a connection -
for example after a reload or in a new tab, or for a hardware signer whose
device session is not restored automatically - the signing step may offer a
targeted reconnect for the one recorded wallet. That reconnect is not a wallet
picker: it resumes the recorded wallet's signer session, and the sign action
stays gated on the connected account matching the reviewed account. While a handoff is outstanding the server locks the session
(state recomputes are refused) and the page shows a signing-in-progress state
whose only action is cancel. Other states render:

- `refresh_required` and an expired quote: hide the sign action and show the
  refresh action with the safe-funds copy.
- `blocked`: hide the sign action and show a human-readable reason plus the
  retry action.
- recorded execution result: show the receipt card (status, digest, failure
  reason, and server-read chain receipt facts when present) with no review or
  sign actions; the session is finished. The receipt card shows the server-read
  chain receipt facts inline; the public Receipt Analytics page can also read
  on-chain receipt facts by transaction digest.
- `expired`: show expiration and a concrete restart path. The default restart path is to return to the AI client and request a new wallet identity or review session.

External proposal review sessions are non-signable. Their primary action is to
inspect the review facts and return to the AI client with any remaining user
choices.

## Receipt Analytics Page

The review page shows the server-read chain receipt facts inline on a recorded
execution result. There is no separate per-session analysis page.

The public Receipt Analytics page is served from `/receipt` and reads on-chain
receipt facts for any transaction digest through `GET /api/receipt?digest=`. It
is separate from the Connect page at `/connect/:id`, which binds the active
account, and the public Account page at `/account`, which reads public
on-chain asset balances for an address. It takes no session token; a `?token`
query is rejected.

The page is read-only. It renders only the server-read receipt facts (execution
status, sender, balance changes, object changes, and Move calls) returned by the
receipt endpoint. It shows no review evidence, labeled session facts, signing
data, or wallet state.

It must not import dapp-kit, Sui clients, wallet connection code, transaction
builders, or signing controls. It must not call chain RPC from the browser,
recompute digest/sender/effects consistency, or present the page as approval. It
is not wallet readiness, not signing readiness, and not a new verification
authority. Receipt truth is owned by the server receipt reader.

The `Audit record` card remains a compact audit and copy surface on the review
page — always visible, with its record sections behind nested disclosures. It
must not grow into a second full analysis view.

## Actions

Each state should expose at most one primary action.

The review page may show an account-bound review action when an active account is present and no review state has been recorded for the selected plan.

It may also show that action when the server status requires refreshed account-bound evidence.

That action asks the local review server to compute review state.
It is not a sign action, frontend transaction-building action, wallet readiness signal, signing readiness signal, or route-quality signal.

Do not show a quote/evidence refresh button unless the quote expired, the
status is `refresh_required`, or no review state has been recorded yet.

Do not automatically close tabs after terminal results. Do not silently renew identity sessions. Do not edit amount, slippage, target asset, or venue on the frontend; revisions go back through AI and MCP.

Loading and waiting states must use plain status copy. For wallet identity, use copy such as `Finish or cancel the request in your wallet popup`. For signing, keep the user's attention on the wallet popup and do not add extra choices.

If a terminal or unrecoverable frontend error occurs, show one clear message and one recovery route. Examples: invalid token, missing session, expired session, unsupported chain, or no compatible wallet.

## Language

Use short, direct, non-promotional copy.

Do not say:

- safe
- recommended
- best
- guaranteed
- approved by AI

Prefer:

- ready for wallet review
- refresh required
- blocked
- expected receive
- minimum receive
- checked at

Source fields may keep protocol-facing names such as `fetchedAt`. Frontend labels should map them to user-facing copy such as `checked at`.

Frontend labels stay in English. Localization must preserve protocol names, token symbols, object IDs, package IDs, and reason enums without translation.

## Shared UI And Design Principles

The frontend pages share one design-token set and one set of atomic UI
components: vanilla TypeScript DOM helpers in `review-app/src/ui` plus the shared
stylesheet `review-app/public/ui.css`, served at `/review-assets/ui.css`. There is
no React, Vue, Svelte, or client router. Pages compose the shared atoms and keep
only their own layout, container, third-party-sizing, and composition CSS. The
shared atoms are addressed by `ui-` prefixed classes that only the shared
stylesheet declares; a page stylesheet declares no `ui-` class rule and no bare
button, input, select, or textarea rule.

The shared UI follows these durable principles:

1. Always-actionable controls: every actionable control shows hover, active, and
   keyboard-focus feedback. Controls are inert only during the deliberate,
   clearly-signaled async lock. Status and errors are conveyed as text, not color
   alone.
2. One consistent system: all pages share one shell, one component set, and the
   same element positions. Public pages carry the shared navigation; token pages
   carry none.
3. Multi-step pages show their full set of steps and mark the current step.
4. A region keeps its position across state and data availability; when content is
   empty, unsupported, or unavailable, the region shows a placeholder card in its
   place rather than collapsing or restructuring the layout.
5. Time-based progress and quantitative completeness use different components: a
   progress bar only when a real value advances it, an indeterminate overlay for
   an unknown-duration wait, and a count plus checklist for an already-known
   "N of M".
6. An action's result or error is tied to that action, stays visible, and carries
   enough detail to diagnose afterward.
7. Restraint: each page shows only the information it needs, with generous spacing.
8. Information depth by importance: each page ranks its information and renders the
   primary answer first and most prominent, audit and technical detail in their
   own cards below the primary with granular records behind disclosures, and
   boundary notes quiet, using a two-weight type scale (regular and medium) where
   size, color, and spacing carry the hierarchy.

Theme: one light and dark token set with a toggle. A shared theme helper stores
only the theme value (`light` or `dark`) under one fixed storage key; it never
reads or writes a token, session id, wallet account, or any other state. The
theme is the `data-theme` attribute on the document root and is applied through
CSS variables with no inline styles, so it works under the strictest page CSP.

Icons are SVG files or inline SVG, never an icon font or a CDN. The favicon
(`favicon.svg`) and the theme-specific brand marks (`brand-light.svg`,
`brand-dark.svg`) are served from `/review-assets/`; the header shows the brand
mark for the active theme.

## Navigation

The public pages share one navigation menu: Account (`/account`), Receipt
Analytics (`/receipt`), and the DeepBook USDC chart (`/charts/deepbook-usdc`).
The menu links only to public pages and never to a token page. It is
server-rendered outside the page's `main` element, so the page script, which owns
`main`, never removes it. Pages migrated onto the shared shell instead render this
navigation through the shell and clear only their own main region, so the shell's
header and navigation persist across the page's re-renders. The public homepage at
`/` and the HTML not-found page are public pages on the shared shell; an unmatched
page request returns the not-found page, while API and asset requests keep their
JSON error body.

Token pages — Connect, Review & Execution, and Settings — have no navigation to
other pages. Each is opened only through its agent-issued token URL, so every
outcome is shown on the page itself with a path back to the AI client. A token
page never links to another page, and a public page never links to a token page.

## Security

Tokens must not be accepted in query strings. Wallet addresses must not be written to local event logs in plaintext. Private keys, signatures, transaction bytes, and arbitrary Move calls must not appear in frontend state.

CSP should prefer external assets and avoid inline script or inline style. Host, Origin, and session token validation are mandatory for state-changing APIs.

Wallet and review screens must be keyboard reachable and screen-reader labeled. Status and error changes must be exposed as text, not color alone.

Native push notifications are out of scope. A frontend may use low-authority browser affordances such as document title changes for off-tab terminal results, but only after server status changes.

Each session URL represents one independent tab surface. Cross-tab state sharing is out of scope unless a shared local store is explicitly designed. That shared local store is now explicitly designed — the shared SQLite database (see docs/LOCAL_DB_ARCHITECTURE.md) — so live review and session state is shared across local clients through it, while the frontend still does not share state directly between browser tabs.

## Out Of Scope

The frontend must not add:

- price charts
- candlesticks
- portfolio dashboards
- AI chat
- trading recommendations
- alerts
- automatic transaction history dashboard pages
- multi-wallet comparison
- saved plans or bookmarks
- arbitrary strategy controls

The exclusions above target automatic, background-indexed, or
recommendation-style surfaces. User-requested local record views are allowed
only inside their narrow surfaces: the public Account page shows a wallet
asset snapshot at a fetched timestamp for an address from public on-chain reads,
and the public Receipt Analytics page shows server-read on-chain receipt facts
for one transaction digest. Summaries of
locally stored review and activity records are available only through the MCP
read tools, not a browser page. These views
must not add P&L, valuation, performance, tax claims, or route ranking. They
must not add background indexing.
