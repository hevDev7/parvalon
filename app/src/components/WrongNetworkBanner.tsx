"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { ACTIVE_CHAIN_ID, activeChain } from "@/lib/chain";

/** Shows when a connected wallet is on a chain other than the app's active chain,
 *  with a one-click switch. Prevents the silent-failure 'couldn't reach network'. */
export function WrongNetworkBanner() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chainId === ACTIVE_CHAIN_ID) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-6 py-2.5 text-sm sm:px-10">
      <span className="text-amber-900">
        Wrong network. Connect to <strong>{activeChain.name}</strong> (chainId {ACTIVE_CHAIN_ID}) to use Parvalon.
      </span>
      <button
        onClick={() => switchChain({ chainId: ACTIVE_CHAIN_ID as 46630 | 421614 | 31337 })}
        disabled={isPending}
        className="shrink-0 rounded-md bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-800 disabled:opacity-60"
      >
        {isPending ? "Switching…" : "Switch network"}
      </button>
    </div>
  );
}
