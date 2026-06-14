"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins, Megaphone, Activity, Droplets, ArrowLeft } from "lucide-react";
import { WalletButton } from "@/components/WalletButton";
import { WrongNetworkBanner } from "@/components/WrongNetworkBanner";

const NAV = [
  { href: "/claim", label: "Claim Dividends", icon: Coins },
  { href: "/issuer", label: "Issue Action", icon: Megaphone },
  { href: "/feed", label: "CAE-1 Feed", icon: Activity },
  { href: "/faucet", label: "Faucet", icon: Droplets },
];

/** Dashboard shell for the dApp routes — sidebar + topbar, no marketing chrome.
 *  Functional content (ClaimPanel / IssuerConsole / feed) renders as children. */
export function DappShell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-surface flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-72 border-r border-border-subtle bg-surface-card flex-col z-10 shrink-0">
        <Link href="/" className="h-20 px-8 border-b border-border-subtle flex items-center space-x-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-parvalon.png" alt="Parvalon" className="w-9 h-9 rounded object-contain shrink-0" />
          <span className="font-bold text-2xl tracking-tight text-primary">Parvalon</span>
        </Link>

        <nav className="flex-1 px-4 py-8 space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-black/40 px-4 mb-4">Dashboard</div>
          {NAV.map((n) => {
            const active = pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl text-[15px] font-semibold transition-all ${
                  active ? "bg-primary text-white shadow-lg" : "text-black/60 hover:bg-black/5 hover:text-primary"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border-subtle">
          <Link
            href="/"
            className="w-full flex items-center justify-center space-x-2 px-4 py-4 rounded-xl text-[14px] font-bold text-black/60 hover:bg-black/5 hover:text-primary transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Exit dApp</span>
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-h-screen bg-surface">
        <WrongNetworkBanner />
        <header className="h-20 border-b border-border-subtle bg-[#faf9f6]/80 backdrop-blur-md flex items-center justify-between px-6 sm:px-10 shrink-0 sticky top-0 z-10">
          <h1 className="text-[20px] font-bold tracking-tight text-primary flex items-center space-x-3">
            <span className="w-1.5 h-6 bg-gradient-pulse rounded-full" />
            <span>{title}</span>
          </h1>
          <WalletButton />
        </header>
        <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
