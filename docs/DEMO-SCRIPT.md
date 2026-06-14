# Parvalon — Demo Video Script (< 3 minutes)

> A tight, judge-facing screen-recording script mapped to the **actual working
> flow**. Screen recording + English voice-over, subtitles, one take per segment.
> Total target: **2:55**. Every claim made on screen is reproducible from
> [RUNBOOK.md](./RUNBOOK.md). **Never name or attack a competitor** — let the
> demo's realism speak for itself.

---

## Before you hit record (prep checklist)

- [ ] Clean demo state seeded: `npm run seed:local` (local) or the testnet announce→fund cycle (RUNBOOK §5) — action `id=1`, status `CLAIMABLE`, two holders owed 5.0 and 7.0 USDG (total 12.0).
- [ ] Both contracts **verified** on Blockscout; tabs pre-opened to the registry, the distributor, and a `Claimed` tx.
- [ ] `/claim` open with the demo holder's wallet connected and the relayer configured (`NEXT_PUBLIC_GASLESS_ENABLED=true` + `RELAYER_PRIVATE_KEY`) for the gasless tap; `/issuer` and `/feed` pre-loaded.
- [ ] A terminal ready with the `curl /api/actions` command typed but not run.
- [ ] Architecture diagram (README / ARCHITECTURE §2) on one slide for the close.
- [ ] QR code to the live dApp + demo wallet on the final frame.

---

## Segment map

| Time | Segment | On screen | Voice-over (core script) |
|---|---|---|---|
| **0:00–0:20** | **Hook** | Title card → a tokenized-stock holder page | "There are almost two thousand tokenized stocks on Arbitrum — and if you actually hold one, there is still no way to claim a dividend on-chain. Tokenization solved issuance. Parvalon is the operations layer — and it works on the tokens that already exist. No token changes, no issuer integration required." |
| **0:20–0:45** | **The problem** | Three quick icons: holder, lending market, agent | "Three parties are blind. Holders have no rail to receive a dividend. DeFi protocols using tokenized stocks as collateral don't know when a split or an ex-dividend date hits — that's real collateral risk. And AI agents have no machine-readable corporate-action data to act on." |
| **0:45–1:30** | **Issuer flow** | `/issuer` console → terminal snapshot CLI → publish → fund | "Here's the issuer side. Announce a Tesla cash dividend — fifty cents a share — with an on-chain record block. Once that block passes, the snapshot reconstructs every holder's balance straight from on-chain Transfer logs and builds a Merkle root. **Anyone can re-run this and get the same root** — that's auditability a traditional transfer agent can't give you. Publish the root, fund it in USDG, and the action goes claimable." |
| **1:30–2:10** | **Holder claim ⭐** | `/claim` → connect → "Your dividend is ready" → one tap → USDG arrives → Blockscout `Claimed` tx | *(slow down here — this is the moment)* "Now the holder. Connect — and the dividend is already waiting: five USDG, no jargon on screen. One tap. The claim is gasless — a relayer covers the fee, and because claims always pay the holder, never the submitter, there's zero custody risk. The USDG lands in the wallet. Here it is on the explorer, verifiable." |
| **2:10–2:35** | **Integrator + CAE-1** | Terminal: `curl /api/actions` → JSON → `/feed` event snippet | "And it's machine-readable. One endpoint returns every corporate action as JSON, alongside a standardized event stream we call **CAE-1**. Lending markets and AI agents can finally subscribe and react to corporate actions — automatically." |
| **2:35–2:55** | **Architecture + honesty + close** | Architecture diagram (one frame) → QR + verified addresses | "Two immutable contracts, forty-two tests, eighty-two-thousand gas per claim. The oracle is issuer-fed today, with a Chainlink Functions adapter as the production path — and the seam is already in the code. Parvalon: the transfer-agent layer for the on-chain economy. Built on Robinhood Chain." |

---

## Detailed beats

### 0:00–0:20 — Hook
Open on the problem, not the product. The single sharpest line is *"works on the tokens that already exist — no token changes, no issuer integration required."* That permissionless-overlay claim is the differentiator; lead with it.

### 0:20–0:45 — Problem
Three victims, fast, no jargon: **holder** (no claim rail), **DeFi protocol** (blind to splits/ex-dividend → collateral risk), **agent** (no machine-readable feed). Keep it to ~8 seconds each.

### 0:45–1:30 — Issuer flow (the credibility beat)
Show the real lifecycle: announce → record block → **snapshot CLI** → publish → fund. The talking point that lands with technical judges is **determinism**: *"anyone can re-run this and verify this root."* Show the CLI printing the root and `totalPayout`; if time is tight, show a second run producing the identical root.

### 1:30–2:10 — Holder claim (the emotional beat) ⭐
This is the most visual moment — slow down. Zero jargon on screen: "Your dividend is ready," one **Claim** button, gasless, USDG arrives, then the Blockscout `Claimed` tx as proof. Show **two wallets** claiming if the cut allows — it proves pro-rata correctness (5.0 and 7.0 USDG against the committed `proofs.json`).

### 2:10–2:35 — Integrator + CAE-1
Run `curl .../api/actions`, show the JSON, then flash a CAE-1 event snippet on `/feed`. The line: *"lending markets and AI agents can finally react to corporate actions."* Mention **claim-on-behalf** if there's a breath — it's what makes agent-driven claiming possible.

### 2:35–2:55 — Architecture + honesty close
One architecture frame. State the evidence plainly: **two immutable contracts, 81 tests, ~82k gas/claim, verified on Blockscout.** Then the honesty note — *"issuer-fed oracle today, Chainlink Functions adapter next, and the seam is already in the code"* — which reads as senior engineering, not a gap. Close on the one-liner and "built on Robinhood Chain," with the QR + verified addresses on screen.

---

## Judge assets to surface (on the final frame / submission)

- Live dApp URL (Vercel) + **QR code** and a demo wallet.
- **Verified** contract addresses on Blockscout (registry + distributor).
- Example tx hashes: `announce`, `fund`, `claim`.
- Public repo link with the judge-grade README.

## Fallback plan (if gasless isn't ready — Decision Gate G2)

Ship the claim with a clean EOA wallet and a tasteful "Gasless coming soon" affordance. The claim flow, the verifiable payout, and the auditability story are unchanged — gasless is UX polish, not the substance. Do **not** delay or cut the holder-claim beat; it is the heart of the demo.

## Timing discipline

If a segment overruns, protect the **holder claim (1:30–2:10)** and the **hook (0:00–0:20)** above all else; compress the problem framing and the architecture close first. The whole video must stay **under 3:00**.
