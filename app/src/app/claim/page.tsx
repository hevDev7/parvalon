import { ClaimPanel } from "@/components/ClaimPanel";
import { DappShell } from "@/components/DappShell";

export const metadata = { title: "Claim · Parvalon" };

export default function ClaimPage() {
  return (
    <DappShell title="Claimable Assets">
      <div className="mb-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-black/40 flex items-center">
          <span className="w-5 h-px bg-current mr-3 opacity-60" />
          For holders
        </p>
        <h2 className="display text-3xl mt-3 text-primary">Claim your dividend.</h2>
        <p className="mt-2 max-w-xl text-black/60">
          Hold a tokenized stock that declared a dividend? It&apos;s yours. Claims are gasless and settle straight to
          your wallet.
        </p>
      </div>
      <ClaimPanel />
    </DappShell>
  );
}
