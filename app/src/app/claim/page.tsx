import { ClaimPanel } from "@/components/ClaimPanel";
import { GuillocheSeal } from "@/components/Guilloche";
import { Kicker } from "@/components/ui";

export const metadata = { title: "Claim · CorporaX" };

export default function ClaimPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
      <header className="relative mb-10">
        <GuillocheSeal className="pointer-events-none absolute -top-8 right-0 hidden h-40 w-40 md:block" />
        <Kicker>For holders</Kicker>
        <h1 className="display mt-3 text-[clamp(2.4rem,5vw,3.6rem)] text-ink">Claim your dividend.</h1>
        <p className="mt-3 max-w-xl text-ink-soft">
          Hold a tokenized stock that declared a dividend? It’s yours. Claims are gasless and settle straight to your
          wallet.
        </p>
      </header>
      <ClaimPanel />
    </div>
  );
}
