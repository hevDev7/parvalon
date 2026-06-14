import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { SiteFooter } from "@/components/SiteFooter";
import { deployments } from "@/generated/deployments";
import { ROBINHOOD } from "@/lib/tokens";

export const metadata = {
  title: "Documentation · Parvalon",
  description: "Complete developer & issuer documentation for Parvalon — the permissionless corporate-actions and dividend protocol on Robinhood Chain.",
};

const CHAIN_ID = 46630;
const RPC = "https://rpc.testnet.chain.robinhood.com";
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const GITHUB = "https://github.com/hevDev7/parvalon";
const d = deployments[String(CHAIN_ID)];

const NAV: [string, string][] = [
  ["Overview", "overview"],
  ["Quickstart", "quickstart"],
  ["Architecture", "architecture"],
  ["Lifecycle", "lifecycle"],
  ["Deployed contracts", "contracts"],
  ["Tokens & decimals", "tokens"],
  ["Record date (Orbit)", "record-date"],
  ["Snapshot & Merkle proofs", "snapshot"],
  ["Issuer flow", "issuer"],
  ["Claiming & gasless", "claiming"],
  ["CAE-1 events", "events"],
  ["REST API", "api"],
  ["TypeScript SDK", "sdk"],
  ["Test faucet", "faucet"],
  ["Security & limitations", "security"],
  ["Resources", "resources"],
];

/* ----------------------------------------------------------- primitives */
function Section({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-border-subtle pt-14 first:border-t-0 first:pt-0">
      <p className="kicker mb-3 flex items-center">
        <span className="mr-3 h-px w-5 bg-current opacity-50" />
        {kicker}
      </p>
      <h2 className="display text-3xl text-primary sm:text-4xl">{title}</h2>
      <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-black/70">{children}</div>
    </section>
  );
}

function Code({ children, lang }: { children: string; lang?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-inverse-surface">
      {lang && (
        <div className="border-b border-white/10 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-white/35">{lang}</div>
      )}
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-relaxed text-white/85">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="tabular rounded bg-surface-inset px-1.5 py-0.5 text-[0.85em] text-primary">{children}</code>;
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border-subtle py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="font-semibold text-primary">{k}</span>
      <span className="flex items-center gap-2">
        <a href={`${EXPLORER}/address/${v}`} target="_blank" rel="noreferrer" className="tabular break-all text-[12.5px] text-brand hover:underline">
          {v}
        </a>
        {note && <span className="shrink-0 rounded bg-surface-inset px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-black/45">{note}</span>}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- page */
export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Header />

      {/* Hero */}
      <header className="border-b border-border-subtle bg-surface-card">
        <div className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-gradient-pulse" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-black/45">Developer Documentation</span>
          </div>
          <h1 className="display mt-5 max-w-3xl text-5xl text-primary sm:text-6xl">
            Build on <span className="text-gradient-pulse">Parvalon</span>.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-black/60">
            The permissionless corporate-actions and dividend protocol for tokenized stocks — running on the real
            Robinhood Chain tokens, with no token cooperation required. Everything below is the live system: contracts,
            tokens, events, API, and SDK.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5 font-mono text-[12px]">
            {[
              ["chainId", String(CHAIN_ID)],
              ["L2", "Arbitrum Orbit"],
              ["payout", "USDG · 6 dp"],
              ["license", "MIT"],
            ].map(([k, v]) => (
              <span key={k} className="rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-black/60">
                <span className="text-black/35">{k}</span> <span className="text-primary">{v}</span>
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Body: sticky TOC + content */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 gap-12 px-6 py-16">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-28">
            <p className="kicker mb-4">On this page</p>
            <ul className="space-y-1.5 border-l border-border-subtle">
              {NAV.map(([label, id]) => (
                <li key={id}>
                  <a href={`#${id}`} className="-ml-px block border-l border-transparent py-1 pl-4 text-[13.5px] text-black/55 transition hover:border-primary hover:text-primary">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-16">
          {/* ---------------------------------------------------- Overview */}
          <Section id="overview" kicker="01 — What it is" title="A permissionless overlay, not an integration.">
            <p>
              Tokenization solved <strong>issuance and trading</strong> for ~2,000 tokenized stocks. It did not solve
              what happens <em>after</em> a share is minted: dividends, splits, record dates — the corporate-actions
              lifecycle. Parvalon is that missing layer, built as an overlay that works on tokens it does not control.
            </p>
            <ul className="space-y-2.5">
              {[
                ["Snapshot via eth_getLogs", "Reconstructs the holder set at any historical block from a token's Transfer logs — permissionlessly, with zero cooperation from the token contract."],
                ["Record-date semantics", "Ownership is fixed at a record block; payment follows. The snapshot block is the record date, mapping 1:1 to traditional markets."],
                ["Claim against a Merkle root", "Holders claim pro-rata USDG against a published root with O(1) gas, claim-on-behalf, and optional gasless relaying."],
                ["A machine-readable feed", "A standardized CAE-1 event stream + a GET /api/actions feed so lending markets, AMMs and agents can react to corporate actions."],
              ].map(([t, b]) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-pulse" />
                  <span>
                    <strong className="text-primary">{t}.</strong> {b}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              The split is deliberate: the <strong>registry governs state</strong> (and never touches value), and the{" "}
              <strong>distributor custodies and settles value</strong> (and is the only contract allowed to advance an
              action into <Mono>CLAIMABLE</Mono> / <Mono>FINALIZED</Mono>). Both are immutable, no-proxy, no-delegatecall.
            </p>
          </Section>

          {/* ---------------------------------------------------- Quickstart */}
          <Section id="quickstart" kicker="02 — Get going" title="Quickstart.">
            <p>The dApp targets Robinhood Chain testnet ({CHAIN_ID}) out of the box. Four surfaces:</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["/feed", "Live CAE-1 feed of every recorded action + GET /api/actions JSON."],
                ["/faucet", "Add the real tokens to your wallet and check balances."],
                ["/issuer", "Announce → snapshot → publish → fund a dividend on a real stock."],
                ["/claim", "Claim a dividend you're owed; gasless and settled to your wallet."],
              ].map(([r, b]) => (
                <div key={r} className="rounded-xl border border-border-subtle bg-surface-card p-5">
                  <p className="tabular font-semibold text-primary">{r}</p>
                  <p className="mt-1.5 text-[14px] text-black/55">{b}</p>
                </div>
              ))}
            </div>
            <p>Add the network to your wallet:</p>
            <Code lang="wallet · add network">{`Network name:  Robinhood Chain Testnet
RPC URL:       ${RPC}
Chain ID:      ${CHAIN_ID}
Currency:      ETH
Explorer:      ${EXPLORER}`}</Code>
            <p>Run the dApp locally against the live deployment (zero config — the chain defaults to {CHAIN_ID}):</p>
            <Code lang="bash">{`git clone ${GITHUB}.git && cd parvalon
npm install
npm -w @parvalon/app run dev   # http://localhost:3000`}</Code>
          </Section>

          {/* ---------------------------------------------------- Architecture */}
          <Section id="architecture" kicker="03 — How it fits together" title="Architecture.">
            <Code lang="topology">{`┌────────────────────────────────────────────────────────────┐
│                    Parvalon dApp (Next.js)                 │
│  /claim · /issuer · /feed · /faucet · GET /api/actions     │
│  wagmi/viem · gasless claims via relayer (claim-on-behalf) │
└───────────────┬───────────────────────────┬────────────────┘
                │ write                      │ read Transfer logs
                ▼                            ▼
┌──────────────────────────┐   ┌──────────────────────────────┐
│ CorporateActionRegistry  │◄──│  Snapshot CLI (TypeScript)    │
│  announce / publish /    │root│  getLogs → balances @ record │
│  state · per-asset issuer│   │  StandardMerkleTree + proofs  │
│  CAE-1 events · D3 oracle │   └──────────────────────────────┘
└───────────┬──────────────┘
            │ DISTRIBUTOR_ROLE (lifecycle)
            ▼
┌──────────────────────────┐   ┌──────────────────────────────┐
│ DividendDistributor      │◄─►│ USDG (payout, 6dp) · stocks   │
│  fund / claim / sweep /  │   │ (snapshot source, read-only)  │
│  cancelPublishedAction   │   └──────────────────────────────┘
│  Merkle verify + bitmap  │
└──────────────────────────┘`}</Code>
            <p>
              The <strong>D3 oracle seam</strong> (<Mono>IActionSource</Mono>) is swappable: an issuer-fed{" "}
              <Mono>AdminActionSource</Mono> on testnet, a Chainlink-Functions adapter in production — the registry never
              changes when provenance is upgraded.
            </p>
          </Section>

          {/* ---------------------------------------------------- Lifecycle */}
          <Section id="lifecycle" kicker="04 — The state machine" title="Action lifecycle.">
            <p>Forward-only transitions, each guarded on-chain. Value never moves until funding.</p>
            <Code lang="states">{`ANNOUNCED ──publishRoot──► ROOT_PUBLISHED ──fund(==totalPayout)──► CLAIMABLE ──sweep/finalize──► FINALIZED
    │                            │
    └─cancelAction               └─cancelPublishedAction (refunds partial funding)
              ╲                  ╱
               ▼                ▼
                  CANCELLED  (only before any claim)`}</Code>
            <div className="space-y-0">
              {[
                ["ANNOUNCED", "Action recorded on-chain (asset, rate, record block, dates). Cancellable by the issuer."],
                ["ROOT_PUBLISHED", "Snapshot Merkle root + exact totalPayout published; awaiting funding. Root is immutable from here."],
                ["CLAIMABLE", "Fully funded — holders may claim against the root."],
                ["FINALIZED", "Claim window closed; any remainder swept to the issuer."],
                ["CANCELLED", "Voided before any claim occurred (ANNOUNCED via cancelAction, or ROOT_PUBLISHED via cancelPublishedAction which refunds)."],
              ].map(([s, b]) => (
                <div key={s} className="flex flex-col gap-1 border-b border-border-subtle py-3 last:border-0 sm:flex-row sm:gap-4">
                  <span className="tabular w-40 shrink-0 font-semibold text-primary">{s}</span>
                  <span className="text-[14px] text-black/60">{b}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* ---------------------------------------------------- Contracts */}
          <Section id="contracts" kicker="05 — Live on 46630" title="Deployed contracts.">
            <p>Immutable, verifiable contracts on Robinhood Chain testnet (chainId {CHAIN_ID}):</p>
            <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
              <Row k="CorporateActionRegistry" v={d?.registry ?? "—"} note="registry" />
              <Row k="DividendDistributor" v={d?.distributor ?? "—"} note="value" />
              <Row k="AdminActionSource" v={d?.actionSource ?? "—"} note="D3 oracle" />
            </div>
            <p className="fine">
              Key roles: <Mono>DEFAULT_ADMIN_ROLE</Mono> (governance), <Mono>PAUSER_ROLE</Mono> (emergency stop),{" "}
              <Mono>DISTRIBUTOR_ROLE</Mono> (held by the distributor; gates lifecycle advancement), and per-asset issuers
              (operational). The distributor exposes no withdraw/rescue path — admin has no route to holder funds.
            </p>
          </Section>

          {/* ---------------------------------------------------- Tokens */}
          <Section id="tokens" kicker="06 — Real Robinhood tokens" title="Tokens & decimals.">
            <p>
              Parvalon targets the <strong>real</strong> tokenized-stock contracts from the Robinhood Chain docs. The
              payout stablecoin <strong>USDG is 6 decimals</strong>; the tokenized stocks are 18 decimals. All USDG
              amounts are parsed/formatted per the payout token&apos;s decimals — never a hardcoded 18.
            </p>
            <p className="fine">
              <strong>Testnet payout token.</strong> The real USDG faucet is rate-limited (~100/24h), too little to fund
              a meaningful multi-holder dividend — so the dApp defaults the payout token to a faucet-mintable 6-decimal{" "}
              <strong>mock USDG</strong> Parvalon deployed on 46630 (mint it from <Mono>/faucet</Mono>). The stock tokens
              stay real. Point <Mono>NEXT_PUBLIC_USDG_ADDRESS</Mono> at the real USDG to switch back.
            </p>
            <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
              <Row k="USDG · payout (testnet default)" v={ROBINHOOD.usdgMock} note="6 dp · faucet-mintable mock" />
              <Row k="USDG · real" v={ROBINHOOD.usdg} note="6 dp · rate-limited faucet" />
              {ROBINHOOD.stocks.map((s) => (
                <Row key={s.symbol} k={`${s.symbol} · ${s.name}`} v={s.address} note="18 dp" />
              ))}
            </div>
            <p className="fine">
              The stocks are read-only snapshot sources (never the payout token), so their transfer behaviour does not
              affect <Mono>fund</Mono>/<Mono>claim</Mono>. <Mono>fund()</Mono> credits the measured balance delta, so a
              fee-on-transfer/rebasing payout token can never mark an action <Mono>CLAIMABLE</Mono> while under-funded.
            </p>
          </Section>

          {/* ---------------------------------------------------- Record date */}
          <Section id="record-date" kicker="07 — Orbit-correct" title="Record date on Arbitrum Orbit.">
            <p>
              The record-date guard requires the record block to be in the past before a root can be published. On
              Arbitrum/Orbit the raw EVM <Mono>block.number</Mono> is the <strong>L1</strong> block (~11M), while the
              snapshot tooling and the dApp key on the <strong>L2</strong> block (~75M). Comparing across those two clocks
              makes <Mono>publishRoot</Mono> unsatisfiable.
            </p>
            <p>
              Parvalon&apos;s registry therefore compares <Mono>recordBlock</Mono> against{" "}
              <Mono>ArbSys.arbBlockNumber()</Mono> (the L2 height the tooling reads), via a low-level staticcall that
              falls back to <Mono>block.number</Mono> on non-Arbitrum chains:
            </p>
            <Code lang="solidity · CorporateActionRegistry">{`function _recordChainBlock() private view returns (uint256) {
    (bool ok, bytes memory ret) =
        ARB_SYS.staticcall(abi.encodeWithSignature("arbBlockNumber()"));
    if (ok && ret.length == 32) return abi.decode(ret, (uint256)); // L2 block
    return block.number;                                            // anvil / non-Arbitrum
}
// publishRoot: if (_recordChainBlock() <= recordBlock) revert RecordNotTaken(...)`}</Code>
            <p className="fine">
              On-chain verified: <Mono>arbBlockNumber()</Mono> equals the header L2 block, matching{" "}
              <Mono>eth_blockNumber</Mono> and the snapshot&apos;s <Mono>eth_getLogs</Mono> range. The on-chain guard is{" "}
              <em>liveness</em> (1 L2 block past); finality is the operator&apos;s responsibility via the snapshot&apos;s{" "}
              <Mono>--confirmations</Mono> buffer.
            </p>
          </Section>

          {/* ---------------------------------------------------- Snapshot */}
          <Section id="snapshot" kicker="08 — Deterministic & verifiable" title="Snapshot & Merkle proofs.">
            <p>
              The off-chain CLI (<Mono>@parvalon/snapshot</Mono>) reconstructs every holder&apos;s balance at the record
              block from <Mono>Transfer</Mono> logs, computes pro-rata payouts, and builds an OpenZeppelin{" "}
              <Mono>StandardMerkleTree</Mono>. Two runs over the same chain state yield an identical root — anyone can
              re-derive and verify it.
            </p>
            <Code lang="bash">{`npm -w @parvalon/snapshot run start -- snapshot \\
  --rpc ${RPC} \\
  --token <STOCK_ADDRESS> \\
  --record-block <L2_BLOCK> \\
  --rate <USDG_PER_SHARE_IN_6DP>   # e.g. 0.50 USDG/share = 500000 \\
  --action-id <ID> --payout-token ${ROBINHOOD.usdg} \\
  --confirmations 64 \\
  --out proofs.json`}</Code>
            <p>The leaf binds the action id (so a proof is non-replayable across actions):</p>
            <Code lang="leaf encoding">{`leaf  = keccak256(bytes.concat(keccak256(abi.encode(
          uint256 actionId, uint256 index, address account, uint256 amount))))
amount = floor(balance * ratePerShare / 1e18)   // in USDG (6-dp) units
root   = StandardMerkleTree (sorted-pair) over all leaves`}</Code>
          </Section>

          {/* ---------------------------------------------------- Issuer */}
          <Section id="issuer" kicker="09 — Run a distribution" title="Issuer flow.">
            <p>An onboarded per-asset issuer drives four steps (the dApp&apos;s /issuer console wraps these):</p>
            <Code lang="solidity · CorporateActionRegistry / DividendDistributor">{`// 1. Announce (record block in the near future; payable + deadline dates)
uint256 id = registry.announceAction(
    asset, ActionType.CASH_DIVIDEND, ratePerShare /*6dp*/,
    recordBlock, payableAt, claimDeadline, ${"USDG"}, metadataURI);

// 2. ...wait for recordBlock to pass, run the snapshot CLI → root, totalPayout

// 3. Publish the immutable root + exact funding target
registry.publishRoot(id, root, totalPayout, holderCount);

// 4. Approve + fund to totalPayout → the action turns CLAIMABLE
usdg.approve(address(distributor), totalPayout);
distributor.fund(id, totalPayout);`}</Code>
            <p className="fine">
              To abandon a published-but-unfunded action and recover any partial deposit, the issuer calls{" "}
              <Mono>distributor.cancelPublishedAction(id)</Mono> — safe because no claim can occur before{" "}
              <Mono>CLAIMABLE</Mono>.
            </p>
          </Section>

          {/* ---------------------------------------------------- Claiming */}
          <Section id="claiming" kicker="10 — O(1), claim-on-behalf" title="Claiming & gasless.">
            <p>
              Anyone may submit a claim, but funds always settle to the Merkle-bound <Mono>account</Mono> — never the
              submitter. That makes relays, sponsorship, and agent automation safe by construction. A per-action{" "}
              <Mono>BitMap</Mono> prevents double-claims; a per-action solvency cap means one action can never drain
              another&apos;s funds. Representative cost: <strong>~82k gas</strong> per claim.
            </p>
            <Code lang="solidity · DividendDistributor">{`distributor.claim(id, index, account, amount, proof);
// verifies proof against the published root, marks the bitmap,
// caps cumulative payout at the funded total, then safeTransfer(account, amount)`}</Code>
            <p>
              The dApp also exposes an optional <strong>gasless relay</strong> at <Mono>POST /api/relay-claim</Mono> — a
              funded server key submits the claim on the holder&apos;s behalf. It simulates before sending, is
              rate-limited and size-capped, and can never divert a payout.
            </p>
          </Section>

          {/* ---------------------------------------------------- Events */}
          <Section id="events" kicker="11 — The CAE-1 schema" title="On-chain events.">
            <p>Every state change emits an event — the public Corporate Action Events (CAE-1) stream:</p>
            <Code lang="solidity · events">{`// CorporateActionRegistry
event ActionAnnounced(uint256 indexed id, address indexed asset, ActionType actionType,
    uint256 ratePerShare, uint64 recordBlock, uint64 payableAt, uint64 claimDeadline,
    address payoutToken, string metadataURI);
event MerkleRootPublished(uint256 indexed id, bytes32 root, uint256 totalPayout, uint256 holderCount);
event ActionStatusChanged(uint256 indexed id, ActionStatus previousStatus, ActionStatus newStatus);
event AssetIssuerSet(address indexed asset, address indexed previousIssuer, address indexed newIssuer);

// DividendDistributor
event Funded(uint256 indexed id, address indexed from, uint256 amount, uint256 totalFunded);
event Claimed(uint256 indexed id, uint256 index, address indexed account, uint256 amount);
event UnclaimedSwept(uint256 indexed id, address indexed to, uint256 amount);
event PublishedActionCancelled(uint256 indexed id, address indexed issuer, uint256 refund);`}</Code>
          </Section>

          {/* ---------------------------------------------------- API */}
          <Section id="api" kicker="12 — Integrate" title="REST API.">
            <p>
              <Mono>GET /api/actions</Mono> — the machine-readable CAE-1 feed integrating protocols and agents consume.
              Amounts are human-decimal strings (per the payout token&apos;s decimals); raw wei stays on-chain.
            </p>
            <Code lang="json · GET /api/actions">{`{
  "chainId": ${CHAIN_ID},
  "schema": "CAE-1",
  "count": 1,
  "actions": [{
    "id": 1, "asset": "0xC9f9…", "assetSymbol": "TSLA",
    "actionType": "CASH_DIVIDEND", "status": "CLAIMABLE",
    "ratePerShare": "0.5", "recordBlock": 75245000,
    "payoutToken": "${ROBINHOOD.usdg}", "payoutSymbol": "USDG",
    "merkleRoot": "0x…", "totalPayout": "12.0",
    "totalFunded": "12.0", "totalClaimed": "7.0",
    "metadataURI": "ipfs://…", "explorerUrl": "${EXPLORER}/address/0xC9f9…"
  }]
}`}</Code>
            <p>
              <Mono>POST /api/relay-claim</Mono> — gasless claim relay. Body:{" "}
              <Mono>{`{ actionId, index, account, amount, proof[] }`}</Mono>. Returns <Mono>{`{ txHash }`}</Mono> or a
              sanitized error. Rate-limited; never leaks the RPC host.
            </p>
          </Section>

          {/* ---------------------------------------------------- SDK */}
          <Section id="sdk" kicker="13 — Typed client" title="TypeScript SDK.">
            <p>
              <Mono>@parvalon/sdk</Mono> ships typed reads/writes, Merkle helpers, and CAE-1 event watchers built on
              viem — so integrators don&apos;t hand-roll calldata or ABIs.
            </p>
            <Code lang="typescript">{`import { createParvalonClient, leaf, buildTree } from "@parvalon/sdk";

const client = createParvalonClient({ chainId: ${CHAIN_ID}, transport: http("${RPC}") });

const actions = await client.reads.listActions();          // typed CAE-1 views
const proof   = client.merkle.proofFor(tree, index);       // Merkle proof
await client.writes.claim({ id, index, account, amount, proof });

client.events.onActionAnnounced((e) => { /* react to new actions */ });`}</Code>
            <p className="fine">ABIs are generated from the canonical artifacts (never hand-written) and kept in lock-step with the deployed contracts.</p>
          </Section>

          {/* ---------------------------------------------------- Faucet */}
          <Section id="faucet" kicker="14 — Get test tokens" title="Test faucet.">
            <p>
              The real Robinhood <strong>stock</strong> tokens are not mintable by Parvalon — obtain them from the
              official Robinhood Chain testnet faucet. The payout <strong>USDG</strong> is a faucet-mintable mock (the
              real USDG faucet is rate-limited), so <Mono>/faucet</Mono> exposes a one-click <strong>Mint USDG</strong>
              button alongside balances, EIP-747 add-to-wallet, and copy-address.
            </p>
            <p className="fine">
              So to fund a dividend you can mint as much test USDG as you need; to be a <em>claimable</em> holder you
              still need real stock at the record block. Announce + snapshot work without either.
            </p>
          </Section>

          {/* ---------------------------------------------------- Security */}
          <Section id="security" kicker="15 — Honest posture" title="Security & limitations.">
            <p>What is solid today, and what is explicitly testnet-grade:</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-money/25 bg-money-wash/40 p-5">
                <p className="kicker text-money">Solid</p>
                <ul className="mt-3 space-y-2 text-[14px] text-black/70">
                  <li>Immutable, no-proxy, no-delegatecall contracts; per-action solvency isolation; CEI + nonReentrant on every mover.</li>
                  <li>Claim-on-behalf can never divert funds; double-claim closed by a per-action bitmap.</li>
                  <li>Correct 6-dp USDG handling end to end; Orbit-correct record date (ArbSys).</li>
                  <li>84 contract tests, invariants, fuzz; Slither 0 high / 0 medium.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-signal/25 bg-signal-wash/40 p-5">
                <p className="kicker text-signal">Testnet-grade / roadmap</p>
                <ul className="mt-3 space-y-2 text-[14px] text-black/70">
                  <li>Governance is a single key today — production moves admin/pauser to a Safe + timelock.</li>
                  <li><Mono>AUTO_ATTEST=true</Mono> on testnet opens the provenance gate; production sets it false with a real attestation source.</li>
                  <li>USDG is an upgradeable proxy (third-party); a future upgrade could add pause/blacklist.</li>
                  <li>No external audit yet; explorer source-verification pending.</li>
                </ul>
              </div>
            </div>
          </Section>

          {/* ---------------------------------------------------- Resources */}
          <Section id="resources" kicker="16 — Links" title="Resources.">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["GitHub repository", GITHUB],
                ["Block explorer", EXPLORER],
                ["RPC endpoint", RPC],
                ["CAE-1 feed", "/feed"],
              ].map(([label, href]) => (
                <a key={label} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer"
                  className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-card px-5 py-4 transition hover:border-primary">
                  <span className="font-semibold text-primary">{label}</span>
                  <span className="font-mono text-[12px] text-black/40">↗</span>
                </a>
              ))}
            </div>
          </Section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
