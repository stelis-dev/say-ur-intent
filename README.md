# Say Ur Intent

Say Ur Intent is a local-first, evidence-first Sui intent toolkit for AI clients.

For natural-language Sui DeFi questions, the current release returns verified,
AI-readable evidence before transaction creation. That answer path remains
separate from account-bound DeepBook review, where the review server builds
local unsigned transaction material internally and, once every review evidence
stage completes, the local review page offers a digest-gated handoff,
user-controlled wallet signing, and execution-receipt recording. The MCP layer
and review API never sign, execute, or return transaction bytes.

Users can ask ordinary questions:

- "Can I cover a 1000 dollar payment with my assets?"
- "How much are my USD-denominated assets together?"
- "What is the shortfall?"

The broader product direction does not stop at pre-execution review. From
verified evidence, Say Ur Intent aims to carry an AI client's or MCP server's Sui
payment or action request through a human-readable local review and on to
user-controlled wallet signing and execution receipt evidence — only after Say Ur
Intent independently builds or verifies the transaction material. The three
layers below state what is implemented today, what is deliberately sequenced
next, and what stays permanently out of scope. For any
such request, Say Ur Intent explains what current verified evidence supports, what
choices remain with the user, and what claims are unsupported.

## Product Direction in Three Layers

Say Ur Intent is one product, but it must be read at three distinct layers. Do not collapse them:

- **Implemented today:** Sui mainnet evidence, local review, and signable review adapters for the DeepBook and FlowX swap routes. The account-bound DeepBook swap review builds unsigned transaction material into a local in-process material store, internally binds a Sui transaction digest to that stored material, derives object ownership, quote/policy provenance, human-readable review facts, and review-time simulation evidence from the same private review artifacts, emits a schema-validated wallet review contract with a PTB visualization on a `ready_for_wallet_review` state, and serves a digest-gated byte handoff to the same-machine review page for user-controlled wallet signing with execution receipts recorded on the session. MCP responses do not contain transaction bytes, signing data, or signing readiness.
- **Deliberately sequenced next (planned order, ships only after verified review):** server-side receipt verification against chain state, further protocol adapters beyond DeepBook and FlowX registered through the descriptor contract (protocol names appear only after a concrete support decision), and richer local analysis views. Each step ships only from independently built or verified transaction material with a human-readable local review.
- **Never (permanently unsupported at every layer):** no private-key custody, no MCP or AI autonomous execution, no forwarding of opaque external transaction bytes to a wallet, no silent settlement-token or route choice, no fiat cash-out, no P&L, no peg guarantee.

In one sentence: Say Ur Intent is a local-first Sui intent evidence and review layer that progresses from verified evidence to user-controlled wallet signing only after Say Ur Intent independently builds or verifies the transaction material and shows a human-readable local review.

DeepBook is the current Sui source for liquidity and price facts in this release.
Wallet and Sui balance reads describe held assets. DeepBook provides scoped
conversion and price evidence. DeepBook does not define the whole product.

Say Ur Intent does not custody funds, hold private keys, or autonomously trade
on behalf of users.
By current design, it does not rank venues, choose routes, make best-price
recommendations, or silently choose settlement tokens for users.

The current release can build local unsigned transaction material only inside the
account-bound DeepBook swap review path. It does not expose transaction bytes.
Wallet signing is user-controlled on the local review page after a
digest-gated handoff; MCP responses never request signatures, provide signing
readiness, or execute payments.

Current review sessions are local evidence-review records only. DeepBook review
state may show that local transaction material was built, internally bound to a
Sui transaction digest, and used to derive object ownership, quote/policy
provenance, human-readable review facts, and review-time simulation evidence.
Review sessions do not contain
public transaction bytes, signing requests, or executable wallet actions.

The current release flow is:

```text
The user states an intent in natural language.
Say Ur Intent resolves the supported Sui mainnet evidence surface.
The AI answers only from returned evidence and boundaries.
DeepBook transaction material build is an account-bound review step, not part of
the natural-language intent evidence answer.
```

The current release implements intent evidence for supported Sui mainnet reads.
It can also create a read-only, non-signable local review session from a
structured external payment or Sui action proposal. External proposal ingestion
does not trust external transaction material or send anything for wallet signing.

Key terms used below:

- Sui: the mainnet blockchain whose DeFi state this project reads.
- MCP: Model Context Protocol, the tool-calling interface used by AI clients.
- DeepBook: Sui's onchain order book protocol.
- SDK: Software Development Kit, a version-pinned library dependency used by this repository.
- gRPC and GraphQL: Sui SDK transports used by this runtime for mainnet reads.
- dApp Kit: Sui's wallet connection library for web apps.
- stdio: standard input/output, the local transport used by MCP clients to talk to this server.
- Stelis: the GitHub and npm namespace for this package. Say Ur Intent is the product and runtime name.

For setup, see [docs/MCP_SETUP.md](docs/MCP_SETUP.md).
For the MCP API reference, see [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md).
For the AI-client answer playbook, see [docs/AGENT_BEHAVIOR.md](docs/AGENT_BEHAVIOR.md).
For manual maintainer and developer utilities, see [docs/UTILITY_INDEX.md](docs/UTILITY_INDEX.md).

User-question flows for USD-denominated coverage, balance totals, and shortfall answers live in [docs/AGENT_BEHAVIOR.md](docs/AGENT_BEHAVIOR.md). The response fields for those answers live in [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md).

## What Works Today

The current release can run as a local stdio MCP server and expose mainnet Sui DeFi evidence:

- wallet balances with verified display units;
- coin-balance classification;
- USD-denominated settlement asset groups derived from pinned DeepBook SDK registry metadata;
- intent evidence with response summaries for natural-language USD-denominated payment coverage, balance-total, and shortfall questions;
- DeepBook pools, tokens, mid price, orderbook context, raw quotes, display-amount quotes, and account inventory;
- FlowX CLMM pools and indicative single-hop swap route quotes from the chain-verified pinned registry;
- user-requested bounded Sui transaction digest lookup, account activity scans, sent-function activity scans with known-wallet-only persistence, and stored normalized activity summaries;
- read-only external proposal review sessions that display proposed action, asset flow, recipient or target, freshness, missing evidence, user choices, unsupported claims, and non-signable reason;
- local Say Ur Intent review evidence and review-session status reads;
- account-bound DeepBook and FlowX swap review progress through local unsigned transaction material build, internal Sui transaction digest binding, object ownership evidence, quote/policy provenance binding, human-readable review facts, and review-time simulation evidence; when every stage completes the review reaches `ready_for_wallet_review` and the local review page offers a digest-gated byte handoff, user-controlled wallet signing, and execution-receipt recording. The MCP layer and review API never sign, execute, or return transaction bytes.

It also includes:

- a local review server bound to `127.0.0.1`;
- a local SQLite store for active account read context and review evidence;
- MCP output checks that reject forbidden executable, signing, token, seed, and
  key-material field names from responses.

## Current Limits

### Not Implemented

Server-side receipt verification against chain state is not implemented. The
full analysis page is not implemented. External proposal execution is not
implemented. Transaction material build, contract emit, digest-gated wallet
handoff, and user-controlled signing are implemented for the account-bound
DeepBook and FlowX swap review through a plan-factory registry.

External proposal ingestion is implemented only for read-only local review
sessions. It accepts structured proposal facts, rejects forbidden executable or
signing fields, recognized Sui private-key strings, valid English BIP39
mnemonic phrases, obvious sensitive markers, and suspicious raw secret-like
payloads before storage, and records why the review is non-signable.

Blocked signing is session-scoped: a review session stays blocked while
required review evidence is missing for that session (for example
`wallet_review_contract_emit_missing`). When account-bound DeepBook swap
review completes local transaction material, digest binding, object ownership,
quote/policy provenance, human-readable review evidence, and review-time
simulation evidence, the review layer emits a schema-validated
`WalletReviewAdapterContract` bound to the same transaction commitment on a
`ready_for_wallet_review` state. Wallet handoff is gated on a recomputed
digest matching that commitment, and the review page then offers
user-controlled wallet signing with the execution receipt recorded on the
session. Review-time simulation and the emitted contract are evidence about
stored local material only; they are not signing readiness, wallet readiness,
or execution readiness. They are not a user bypass state.

The signable adapter and PTB visualization boundary is documented in
`docs/SIGNABLE_ADAPTER_CONTRACT.md`. The runtime path emits
`WalletReviewAdapterContract` as pre-signing review evidence when every
required evidence stage is complete; the contract carries the transaction
commitment hash only.
The runtime path does not make wallet signing available.
It does not make wallet handoff available.
It does not make payment execution available.
It does not make executable transaction material available.
It does not make signing readiness available.

Fiat cash-out, P&L, tax, and cost-basis support are not part of the current release.

### Permanent Safety and Correctness Boundaries

These are product boundaries and must not be relaxed by ordinary feature work:

- Say Ur Intent does not custody funds, hold private keys, or autonomously trade.
- It does not treat USDC, USDT, or any USD-denominated settlement asset as fiat
  USD, a bank cash-out amount, or a USDC/USD peg guarantee.
- It does not turn quote-only conversion candidates into payment coverage, shortfall evidence, funding readiness, payment execution readiness, or signing readiness.

### Out of Scope by Current Design

These product behaviors are out of scope in the current release by design:

- It does not silently choose USDC, USDT, or another settlement token for a
  user. It can report supported settlement asset groups and can use a settlement
  token only when the user selected it explicitly.
- It does not rank venues, choose routes, or make best-price recommendations.

### Quote Response Limits

Quote tools such as `read.quote_deepbook_action` and
`read.quote_deepbook_display_amount` return scoped quote facts and raw quote
evidence only.

Their semantics mark quote output as price evidence, not payment coverage or shortfall evidence. Coverage and shortfall answers come from `read.preview_intent_evidence.responseSummary`.

For quote responses alone, these conclusions are unsupported:

- payment coverage is not available;
- shortfall contribution is not available;
- route-dependent payment support is not available;
- final min-out values are not available;
- route recommendations are not available;
- venue comparisons are not available;
- effective-price claims are not available;
- price-impact calculations are not available;
- quote-vs-mid slippage is not available;
- fiat cash-out estimates are not available;
- external market lookups are not available;
- USDC/USD peg assumptions are not available;
- P&L is not available;
- cost basis is not available;
- actionable signing data is not available.

## Developer Checkout Quickstart

This package targets Node.js 22+. Node 22 or 24 LTS is recommended.

Use this path when you download the repository from GitHub and want to test the local build in an MCP client:

```bash
git clone https://github.com/stelis-dev/say-ur-intent.git
cd say-ur-intent
npm install
npm run build
```

No Sui endpoint setup is required for the default path. For MCP stdio configuration from a local checkout, point the client at the built runtime:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/say-ur-intent/dist/runtime/start.js"]
}
```

Do not wrap the stdio server in a shell command that writes ordinary text to stdout. Stdout is reserved for MCP JSON-RPC messages; logs go to stderr.

Client-specific setup for Claude Code, Claude Desktop, Codex, and Cursor lives in [docs/MCP_SETUP.md](docs/MCP_SETUP.md). That file is the canonical setup guide; this README keeps only the short path.

To delegate local setup to an AI coding agent, tell it:

```text
Register this repository as a local stdio MCP server using the built /absolute/path/to/say-ur-intent/dist/runtime/start.js file.
Use the default Sui mainnet endpoint unless I explicitly ask for a custom provider.
```

After the MCP server is connected, use [docs/MCP_SETUP.md](docs/MCP_SETUP.md#first-use-flow) for first-use setup, [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md) for API fields and statuses, and [docs/AGENT_BEHAVIOR.md](docs/AGENT_BEHAVIOR.md) for user-question flow and response wording.

## Mainnet-Only Product Surface

Product docs, registry, AI responses, UX copy, and signable actions are mainnet-only.

Unsupported protocol experiments are not product functionality and are not included in the package docs, MCP resources, registry support lists, UX copy, or signable-action lists.

## Commands

```bash
npm install
npm run typecheck
npm run build
npm test
npm run release:check
npm run generate:deepbook-registry
npm run smoke:mainnet
```

`npm run generate:deepbook-registry` writes `registry/generated/deepbook-mainnet.json`, which is ignored by Git because generated registry data must include provenance and should be regenerated from the pinned SDK.

## MCP Tools

The canonical MCP API reference lives in [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md).

The server also exposes `read.get_server_status`. It returns the package version, evidence policy version, `implementedToolsCount`, and implemented tool list at runtime.

DeepBook pool-price context is exposed through `read.get_deepbook_mid_price`. Use `docs/MCP_TOOLS.md` for the response fields and unsupported conclusions.

Tool names use dot prefixes because the MCP spec recommends ASCII letters, digits, underscore, hyphen, and dot for tool names. `action.prepare_sui_action_review` returns a `reviewSessionId` and `reviewUrl`; it does not return executable transaction bytes.

## Documentation Map

The server exposes only a subset of repository documents as MCP resources.

Runtime-facing MCP resources currently include:

- this README;
- `docs/MCP_SETUP.md`;
- `docs/MCP_TOOLS.md`;
- `docs/WALLET_IDENTITY.md`;
- `docs/AGENT_BEHAVIOR.md`;
- `protocols/deepbook-v3.md`;
- `protocols/deepbook-margin.md`.

Protocol resources are explanatory references. Current support is declared by `read.get_server_status`, `read.list_supported_protocols`, concrete tool schemas, and concrete tool responses, not by protocol Markdown alone.

Development-only or release-review documents can define contributor rules and checks.

AI client answer behavior must be mirrored in runtime-facing instructions, resources, prompts, schemas, or returned evidence fields before it is treated as product behavior.

- `README.md`: Public entry document: product purpose, current release boundary, setup path, and documentation map.
- `docs/MCP_SETUP.md`: Setup guide: installation, MCP client connection, first-use flow, settings, and troubleshooting.
- `docs/MCP_TOOLS.md`: API reference: tool contracts, response fields, statuses, follow-up fields, and output boundaries.
- `docs/AGENT_BEHAVIOR.md`: Answer playbook: user-question flows, tool selection, and response wording boundaries.
- `docs/WALLET_IDENTITY.md`: Wallet identity reference: active-account read context and same-machine capture boundaries.
- `protocols/deepbook-v3.md`: Protocol reference only; use MCP tool responses and read.list_supported_protocols for current support.
- `protocols/deepbook-margin.md`: Protocol reference only; no margin MCP read tools or signable actions are exposed in this release.
- `docs/golden-scenarios/INTENT_EVIDENCE_MATRIX.md`: current-release question, tool-path, and standard-answer matrix for AI client release review.
- `docs/golden-scenarios/BEHAVIOR_MATRIX.md`: broader behavior scenario matrix for supported and unsupported user prompts.
- `docs/TRANSACTION_ACTIVITY_LOG.md`: transaction activity evidence, storage, scan, and summary boundaries.
- `docs/UTILITY_INDEX.md`: manual maintainer and developer utilities. Utility rows are not MCP tools unless they explicitly name an MCP tool, and source-checkout scripts are not packaged product commands.
- `docs/LOCAL_DB_ARCHITECTURE.md`: local SQLite storage boundaries for maintainers.
- `docs/SDK_API.md`: pinned SDK API notes and source-verification boundaries.
- `docs/FRONTEND_POLICY.md`: review-app frontend implementation policy for coding agents.
- `docs/SIGNABLE_ADAPTER_CONTRACT.md`: wallet-review adapter and PTB visualization contract. The review layer emits the contract and a PTB visualization as pre-signing review evidence; not signing support.
- `AGENTS.md`: root repository development contract and non-negotiable product boundaries for coding agents working on this codebase.
- `docs/AGENT_DEVELOPMENT_POLICY.md`: detailed binding development, review, documentation, source-of-truth, and completion policies for coding agents.

## For Maintainers

This section is for people operating releases, running smoke checks, changing runtime storage, or debugging startup. Normal users and MCP client users can stop at the documentation map above.

### Mainnet Read Smoke

Normal quickstart use does not require Sui endpoint setup. The smoke script is a manual maintainer check for a specific mainnet provider:

```bash
export SUI_GRPC_URL="https://fullnode.mainnet.sui.io:443"
export SUI_GRAPHQL_URL="https://graphql.mainnet.sui.io/graphql" # optional override; default is the built-in mainnet GraphQL endpoint
export SMOKE_SUI_ADDRESS="0x..."
export SMOKE_DEEPBOOK_POOL_KEY="DEEP_SUI"
export SMOKE_QUOTE_AMOUNT="1000000000" # raw integer units; for SUI, 1000000000 = 1 SUI
# Optional: export SMOKE_INSPECT_DIGEST="..."
# Optional: export SMOKE_INSPECT_RANDOM_LATEST="true"
npm run build
npm run smoke:mainnet
```

`SUI_GRPC_URL` must be only scheme, host, and explicit port. Do not include credentials, a path, query string, or fragment.
`SMOKE_SUI_ADDRESS` must be a 32-byte hex Sui address, for example `0x` followed by 64 hex characters.
`SMOKE_INSPECT_DIGEST` is optional. Use a digest whose sender or returned balance-change owner is `SMOKE_SUI_ADDRESS` to exercise the stored digest-lookup path; otherwise the lookup can still return `ok` with `persistence.stored: false`.
`SMOKE_INSPECT_RANDOM_LATEST=true` is optional and only used when `SMOKE_INSPECT_DIGEST` is unset.

It samples one digest from the latest GraphQL transaction page and calls `read.inspect_sui_transaction` without passing the smoke address.

This checks current transaction-read shape without pinning a specific user address or exercising the stored relation path.

The smoke script currently calls:

- wallet assets;
- DeepBook orderbook;
- raw-quantity quote;
- `read.scan_sui_account_activity` for `SMOKE_SUI_ADDRESS` with limit 5;
- `read.summarize_sui_activity_scan` through active account context with limit 5.

If `SMOKE_FUNCTION_TARGET` is set to a full `package::module::function`, it also calls `read.scan_sui_function_activity` and `read.summarize_sui_function_activity_scan` with limit 5.

If unset, function activity smoke is recorded as not run with `notRunReason: "missing_env"`.

Empty activity pages are valid smoke outcomes. They are recorded with `rowCount: 0` and `emptyAccepted: true`.

If `SMOKE_INSPECT_DIGEST` is set, the script also calls `read.inspect_sui_transaction` for that digest and the smoke address.

DeepBook orderbook and raw-quantity quote reads use an internal mainnet SDK simulation sender placeholder, not a user's wallet. The display-amount quote path is covered by automated tests, not by this smoke script. This smoke script does not exercise account-bound DeepBook transaction-material build or digest binding; that path needs a separate funded-account material-build smoke before smoke results are treated as product-grade proof for that review stage.

Wallet asset summaries and active-account activity summaries use the smoke address through a wallet identity session created by the smoke script. Browser wallet behavior is checked separately.

Smoke result files record activity status, row count, source, window/order flags, persistence, and evidence summary only. They do not record raw GraphQL payloads, transaction bytes, signatures, raw transaction details, or compact transaction aggregates.

### Runtime Boundary

The runtime starts these local components:

- a local SQLite store;
- a mainnet guard for the configured Sui gRPC endpoint;
- the local review HTTP server on `127.0.0.1`;
- the stdio MCP transport.

The GraphQL endpoint is also mainnet-guarded when it is saved through settings, imported from a local-data backup, or first used by Sui activity tools.

Stdout is reserved for MCP JSON-RPC messages. Logs go to stderr.

### Local Data

The runtime creates a local SQLite file for account read context and Say Ur Intent review activity evidence. Users do not install a database server separately.

Override the app data directory only when needed:

```bash
export SAY_UR_INTENT_DATA_DIR="/path/to/local/app-data"
```

The stored active account is for reading wallet state only. It does not let the toolkit sign transactions on your behalf.

User-requested bounded transaction scans can store normalized facts only when a transaction is related to a known local wallet. This product does not run a background or complete wallet history indexer.

The default Sui mainnet gRPC and GraphQL endpoints are stored in the local SQLite settings table on first run.

To inspect settings or change local data, ask your AI client to create a Say Ur Intent local settings session and open the returned settings URL in the same machine's system browser.

Endpoint changes apply after the MCP server restarts.
