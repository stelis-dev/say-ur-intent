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

Not yet implemented:

- Signable swap review.
- Limit or market order review.
- Wallet signing or execution.

No DeepBook transaction should be exposed as signable until registry validation, live quote refresh, object resolution, and `client.core.simulateTransaction` review are implemented.
