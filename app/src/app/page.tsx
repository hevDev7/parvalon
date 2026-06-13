import { Header } from "@/components/Header";
import { SiteFooter } from "@/components/SiteFooter";
import { LandingConnectRedirect } from "@/components/LandingConnectRedirect";
import { Reveal } from "@/components/Reveal";
import { Hero, Stats } from "@/components/landing/HeroStats";
import { Protocol, Problem } from "@/components/landing/ProtocolProblem";
import { Coverage, Testimonials, ArchitectureStack } from "@/components/landing/ArchitectureStack";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <LandingConnectRedirect />
      <Header />
      <main className="flex-1">
        <Hero />
        <Protocol />
        <Reveal>
          <Stats />
        </Reveal>
        <Reveal>
          <Problem />
        </Reveal>
        <Reveal>
          <Coverage />
        </Reveal>
        <Reveal>
          <Testimonials />
        </Reveal>
        <Reveal>
          <ArchitectureStack />
        </Reveal>
      </main>
      <SiteFooter />
    </div>
  );
}
