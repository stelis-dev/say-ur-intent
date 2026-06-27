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
    // Reconnect silently within the same loopback origin so the account bound on
    // the Connect page carries into the Review & Execution signing section
    // without a second wallet prompt. Storage holds the wallet autoconnect
    // preference only, never keys.
    autoConnect: true,
    slushWalletConfig: null,
    walletInitializers: [createAgentQSuiWalletInitializer({ provider: agentQProvider })],
    createClient: () => suiMainnetClient
  });
}

// Shared mainnet client: dapp-kit reads through it, and the Review & Execution
// page submits signed transaction bytes through it directly. Submission stays on
// the page because not every wallet exposes sign-and-execute (Agent-Q signs only).
// The base URL host is allowlisted in the wallet pages' CSP connect-src (Connect,
// Review & Execution, Analytics; src/review-server/reviewServerPolicy.ts
// SUI_BROWSER_EXECUTION_ORIGIN); keep the two in sync or the browser submission
// is blocked by CSP.
export const suiMainnetClient = new SuiGrpcClient({
  network: "mainnet",
  baseUrl: "https://fullnode.mainnet.sui.io:443"
});

// localStorage key dapp-kit uses to remember the selected wallet+address for
// per-origin autoConnect. The Connect, Review & Execution, and Analytics pages
// read it to show a "reconnecting" placeholder until autoConnect settles, instead
// of flashing the wallet picker first.
export const WALLET_SELECTION_STORAGE_KEY = "mysten-dapp-kit:selected-wallet-and-address";

export function hasStoredWalletSelection(): boolean {
  try {
    return window.localStorage.getItem(WALLET_SELECTION_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

// Parse the stored selection the same way dapp-kit's autoConnect does: the value
// is "<walletId>:<address>:<intents>". The public Analytics page (which has no
// server session to read a bound wallet from) uses the walletId to offer a
// reconnect of that one stored wallet, never a wallet picker.
export function getStoredWalletSelection(): { walletId: string; address: string } | null {
  try {
    const raw = window.localStorage.getItem(WALLET_SELECTION_STORAGE_KEY);
    if (!raw) return null;
    const [walletId, address] = raw.split(":");
    if (!walletId || !address) return null;
    return { walletId, address };
  } catch {
    return null;
  }
}
