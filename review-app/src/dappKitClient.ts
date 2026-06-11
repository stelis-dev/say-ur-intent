import { createDAppKit } from "@mysten/dapp-kit-core";
import { SuiGrpcClient } from "@mysten/sui/grpc";

export function createLocalDAppKit() {
  return createDAppKit({
    networks: ["mainnet"],
    defaultNetwork: "mainnet",
    // Reconnect silently within the same loopback origin so the account
    // captured on the analysis page carries into the review page signing
    // section without a second wallet prompt. Storage holds the wallet
    // autoconnect preference only, never keys.
    autoConnect: true,
    slushWalletConfig: null,
    createClient: () =>
      new SuiGrpcClient({
        network: "mainnet",
        baseUrl: "https://fullnode.mainnet.sui.io:443"
      })
  });
}
