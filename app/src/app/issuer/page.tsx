import { IssuerConsole } from "@/components/IssuerConsole";
import { DappShell } from "@/components/DappShell";

export const metadata = { title: "Issuer · Parvalon" };

export default function IssuerPage() {
  return (
    <DappShell title="Issue Corporate Action">
      <div className="mb-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-black/40 flex items-center">
          <span className="w-5 h-px bg-current mr-3 opacity-60" />
          For issuers &amp; transfer-agent ops
        </p>
        <h2 className="display text-3xl mt-3 text-primary">Issuer console.</h2>
        <p className="mt-2 max-w-xl text-black/60">
          Run an entire corporate action — announce, snapshot, publish, fund — from one place. The full transfer-agent
          workflow, in four signed transactions.
        </p>
      </div>
      <IssuerConsole />
    </DappShell>
  );
}
