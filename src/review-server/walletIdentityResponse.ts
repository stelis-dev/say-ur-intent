import type { CreatedWalletIdentitySession } from "../core/session/sessionStore.js";
import { walletIdentityPollingHint } from "../core/session/walletIdentity.js";

export function walletIdentitySessionResponse(wallet: CreatedWalletIdentitySession, baseUrl: string) {
  return {
    walletSessionId: wallet.session.id,
    walletUrl: `${baseUrl}/analysis/${wallet.session.id}#${wallet.token}`,
    status: wallet.session.status,
    expiresAt: wallet.session.expiresAt,
    lastActivityAt: wallet.session.lastActivityAt,
    openTarget: "system_browser" as const,
    accessScope: "same_machine_loopback" as const,
    pollingHint: walletIdentityPollingHint()
  };
}
