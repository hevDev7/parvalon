"use client";

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-white/40 mb-6">{title}</h4>
      <ul className="space-y-4 text-[14px] font-medium text-white/80">
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} className="hover:text-white transition-colors">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-inverse-surface text-white pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 border-b border-white/10 pb-16">
        <div className="lg:col-span-5 pr-8">
          <div className="flex items-center space-x-2 mb-6">
            <span className="w-8 h-8 rounded shrink-0 overflow-hidden relative">
              <span className="absolute inset-0 bg-gradient-pulse" />
            </span>
            <span className="font-bold text-2xl tracking-tight">Parvalon</span>
          </div>
          <p className="text-white/60 text-[15px] mb-10 leading-relaxed max-w-md">
            The permissionless corporate-actions and dividend protocol for tokenized stocks. Built on Robinhood Chain —
            Arbitrum Orbit L2.
          </p>
          <form className="relative mb-8 max-w-sm" onSubmit={(e) => e.preventDefault()}>
            <input
              className="w-full bg-white/5 border border-white/10 rounded-lg py-3.5 px-5 text-[14px] text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-colors font-medium"
              placeholder="you@email.com"
              type="email"
            />
            <button
              className="absolute right-1.5 top-1.5 bottom-1.5 bg-white text-black font-semibold text-[13px] px-5 rounded hover:bg-gray-200 transition-colors flex items-center"
              type="submit"
            >
              Subscribe
            </button>
          </form>
        </div>

        <div className="lg:col-span-7 grid grid-cols-2 md:grid-cols-4 gap-8">
          <FooterCol
            title="Protocol"
            links={[
              ["Registry", "/#architecture"],
              ["Distributor", "/#architecture"],
              ["CAE-1 Spec", "/feed"],
            ]}
          />
          <FooterCol
            title="App"
            links={[
              ["Claim", "/claim"],
              ["Issuer", "/issuer"],
              ["Feed", "/feed"],
            ]}
          />
          <FooterCol
            title="Developers"
            links={[
              ["GET /api/actions", "/api/actions"],
              ["Documentation", "#"],
              ["GitHub", "#"],
            ]}
          />
          <FooterCol
            title="Ecosystem"
            links={[
              ["Robinhood Chain", "#"],
              ["Arbitrum", "#"],
            ]}
          />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 mt-8 flex flex-col sm:flex-row gap-2 justify-between items-start sm:items-center text-[13px] text-white/40 font-medium tracking-wide">
        <p>© {year} Parvalon · MIT · Built on Robinhood Chain</p>
        <div className="flex gap-6 font-mono uppercase">
          <span>Status: Operational</span>
        </div>
      </div>
    </footer>
  );
}
