import { ClaimPanel } from "@/components/ClaimPanel";
import { Kicker } from "@/components/ui";

export const metadata = { title: "Claim · CorporaX" };

export default function ClaimPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
      <header className="mb-10">
        <Kicker>For holders</Kicker>
        <h1 className="display mt-3 text-[clamp(2.4rem,5vw,3.6rem)] text-ink">Claim your dividend.</h1>
        <p className="mt-3 max-w-xl text-ink-soft">
          Hold a tokenized stock that declared a dividend? It&apos;s yours. Claim it straight to your wallet — no
          jargon, no gas to worry about.
        </p>
      </header>
      <ClaimPanel />
    </div>
  );
}
