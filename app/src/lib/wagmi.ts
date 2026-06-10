import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { anvil, arbitrumSepolia, robinhoodTestnet } from "@/lib/chain";

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/**
 * wagmi config — the production-solid EOA base (always available). The gasless
 * claim path (relayer leveraging claim-on-behalf) and an optional Alchemy
 * Account Kit passkey signer layer on top; see lib/relay.ts and
 * docs/PRODUCTION-READINESS.md. All target chains are registered so the active
 * one (NEXT_PUBLIC_CHAIN_ID) just works.
 */
export const wagmiConfig = createConfig({
  chains: [robinhoodTestnet, arbitrumSepolia, anvil],
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: "CorporaX", preference: "all" }),
    ...(wcProjectId ? [walletConnect({ projectId: wcProjectId, showQrModal: true })] : []),
  ],
  transports: {
    [robinhoodTestnet.id]: http(),
    [arbitrumSepolia.id]: http(),
    [anvil.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
