"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { PrimaryButton } from "@/components/Shared";

const NAV = [
  { href: "/#protocol", label: "Protocol" },
  { href: "/#architecture", label: "Architecture" },
  { href: "/#coverage", label: "Coverage" },
  { href: "/feed", label: "Feed" },
];

export function Header() {
  return (
    <header className="w-full sticky top-0 z-50 border-b border-border-subtle bg-[#faf9f6]/85 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 py-5 flex justify-between items-center">
        <Logo />
        <nav className="hidden md:flex space-x-10 text-[14px] font-medium text-black/70 absolute left-1/2 -translate-x-1/2">
          {NAV.map((n) => (
            <Link key={n.label} href={n.href} className="hover:text-primary transition-colors">
              {n.label}
            </Link>
          ))}
        </nav>
        <PrimaryButton href="/claim" className="px-5 py-2.5 text-[13px]">
          Launch dApp
        </PrimaryButton>
      </div>
    </header>
  );
}
