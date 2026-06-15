# DeepBookV3

This file is a protocol reference for AI and human readers. It is not a runtime registry, not a supported-protocol list, not a live liquidity source, not a route recommendation source, and not a signing-readiness signal.

Current product support is declared by `read.get_server_status`, `read.list_supported_protocols`, concrete MCP tool schemas, and concrete MCP tool responses. This note only explains DeepBookV3 protocol concepts that those runtime surfaces may reference.

DeepBookV3 is the first protocol domain for Say Ur Intent.

Protocol concepts referenced by current runtime evidence include:

- Mainnet package and pool metadata through the pinned `@mysten/deepbook-v3` SDK constants.
- Read-only protocol and pool listing.
- Read-only orderbook context through pinned DeepBook SDK simulation reads.
- Read-only raw-quantity and display-amount quotes through pinned DeepBook SDK simulation reads.

DeepBook orderbook, raw-quantity quote, and display-amount quote reads use an internal SDK simulation sender placeholder. They do not require wallet connection because these market reads are not wallet-account reads.

Signable swap review for the account-bound DeepBook swap route is part of current runtime support; `read.list_supported_protocols` and the concrete MCP tool responses are the authoritative status. Before a `ready_for_wallet_review` state allows user-controlled signing on the local review page, the review server validates the pinned registry, refreshes the live quote, resolves objects, and runs `client.core.simulateTransaction` review.

Out of scope:

- Limit or market order review.

The MCP layer and review API do not sign, execute, or return transaction bytes. Wallet signing and execution happen only in the user's wallet from the local review page.
