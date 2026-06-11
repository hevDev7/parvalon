import { IssuerConsole } from "@/components/IssuerConsole";
import { Kicker } from "@/components/ui";

export const metadata = { title: "Issuer · CorporaX" };

export default function IssuerPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
      <header className="mb-10">
        <Kicker>For issuers &amp; transfer-agent ops</Kicker>
        <h1 className="display mt-3 text-[clamp(2.4rem,5vw,3.6rem)] text-ink">Issuer console.</h1>
        <p className="mt-3 max-w-xl text-ink-soft">
          Run an entire corporate action — announce, snapshot, publish, fund — from one place. Transfer-agent
          operations, finally in a box.
        </p>
      </header>
      <IssuerConsole />
    </div>
  );
}
