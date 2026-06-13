import { FaucetPanel } from "@/components/FaucetPanel";
import { DappShell } from "@/components/DappShell";

export const metadata = { title: "Faucet · Parvalon" };

export default function FaucetPage() {
  return (
    <DappShell title="Test Faucet">
      <div className="mb-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-black/40 flex items-center">
          <span className="w-5 h-px bg-current mr-3 opacity-60" />
          Try it live
        </p>
        <h2 className="display text-3xl mt-3 text-primary">Test tokens.</h2>
        <p className="mt-2 max-w-xl text-black/60">
          The real Robinhood Chain testnet contracts Parvalon runs on. Check balances, add each token to your wallet,
          and grab them from the Robinhood faucet — then claim a dividend on what you hold.
        </p>
      </div>
      <FaucetPanel />
    </DappShell>
  );
}
