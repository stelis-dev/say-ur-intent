import { createDAppKit } from "@mysten/dapp-kit-core";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { createAgentQSuiBrowserProvider } from "@stelis/agent-q-provider-sui/browser";
import { createAgentQSuiWalletInitializer } from "@stelis/agent-q-provider-sui/wallet-standard";

export function createLocalDAppKit() {
  // Register Agent-Q as a Wallet Standard wallet so the hardware device shows up
  // alongside browser-extension wallets in the same signing list. The browser
  // provider speaks Web Serial and is created eagerly so the wallet stays visible
  // before any USB device is chosen; it requests a serial port only inside
  // connectDevice() on a user gesture and fails closed (unavailable) when Web
  // Serial is absent. Firmware remains the signing authority — this only routes
  // sign_transaction / sign_personal_message; no keys or policy live here.
  const agentQProvider = createAgentQSuiBrowserProvider();
  return createDAppKit({
    networks: ["mainnet"],
    defaultNetwork: "mainnet",
    // Reconnect silently within the same loopback origin so the account
    // captured on the analysis page carries into the review page signing
    // section without a second wallet prompt. Storage holds the wallet
    // autoconnect preference only, never keys.
    autoConnect: true,
    slushWalletConfig: null,
    walletInitializers: [createAgentQSuiWalletInitializer({ provider: agentQProvider })],
    createClient: () => suiMainnetClient
  });
}

// Shared mainnet client: dapp-kit reads through it, and the review page submits
// signed transaction bytes through it directly. Submission stays on the page
// because not every wallet exposes sign-and-execute (Agent-Q signs only).
export const suiMainnetClient = new SuiGrpcClient({
  network: "mainnet",
  baseUrl: "https://fullnode.mainnet.sui.io:443"
});
