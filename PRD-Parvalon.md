# PRD — Parvalon
## Corporate-Actions & Dividend Engine untuk Tokenized Stocks di Robinhood Chain

| | |
|---|---|
| **Versi** | 1.0 — Hackathon Build |
| **Tanggal** | 10 Juni 2026 |
| **Owner** | Jumardi (solo builder) |
| **Event** | Arbitrum Open House London: Online Buildathon (HackQuest) |
| **Deadline submission** | **14 Juni 2026, 22:59** — pengumuman reward 17 Juni 2026 |
| **Target track** | Overall ($70K) via slot reserved **Robinhood Chain** + jalur Grants |
| **Chain target** | Robinhood Chain Testnet (Chain ID **46630**, gas: ETH) — fallback: Arbitrum Sepolia |
| **One-liner** | *"The missing corporate-actions layer for tokenized stocks. Dividen, split, dan record-date semantics — akhirnya on-chain."* |

---

## 1. Ringkasan Eksekutif

Ada **1.997 tokenized stocks/ETF** di ekosistem Arbitrum (data Robinhood, Des 2025). Tidak satu pun memiliki mekanisme **dividend distribution** atau **corporate actions** yang berjalan on-chain dan machine-readable. Juri Arbitrum Open House NYC secara eksplisit menyebut pemenang mereka mengisi *"the operational services layer that institutional tokenization still lacks"* — dan dividend/corporate actions adalah lapisan operasional paling fundamental yang masih kosong.

**Parvalon** adalah protokol infrastruktur yang memberi tokenized stocks tiga kemampuan yang selama ini hanya ada di sistem transfer agent tradisional: (1) **pengumuman corporate action on-chain** dengan record-date semantics yang benar, (2) **distribusi dividen pro-rata dalam USDG** ke seluruh holder via Merkle-snapshot claim yang gas-efficient, dan (3) **event feed terstandar (draft "CAE-1")** sehingga protokol DeFi dan AI agents bisa bereaksi terhadap corporate actions secara otomatis.

MVP hackathon: satu siklus penuh `announce → record snapshot → publish root → fund → claim` untuk cash dividend token TSLA/AMZN di Robinhood Chain testnet, dengan claim flow **gasless berbasis passkey** (ERC-4337 via Alchemy) sebagai lapisan UX pembeda.

**Strategi menang:** menyerang slot hadiah yang direservasi untuk project di Robinhood Chain (kompetisi lebih sempit), dengan ide yang skor tinggi di keempat kriteria juri — smart contract quality, PMF, innovation, real problem solving — dan scope yang realistis diselesaikan solo dalam 4 hari. Per 10 Juni teridentifikasi satu submission kompetitor di ruang yang sama (CorpAction Engine — lihat §2.4); positioning digeser dari "yang pertama" menjadi **"yang benar-benar bekerja pada aset riil di chain, dengan claim experience kelas consumer"** — depth & realism vs breadth & simulation.

---

## 2. Latar Belakang & Problem Statement

### 2.1 Konteks pasar

Robinhood Chain (Arbitrum Orbit L2) diposisikan sebagai rumah bagi tokenized real-world assets, dengan test Stock Tokens (TSLA, AMZN, PLTR, NFLX, AMD) dan stablecoin USDG sudah live di testnet. Narasi resmi Arbitrum 2025–2026 adalah "the year of institutional adoption" — BlackRock, Franklin Templeton, WisdomTree, Robinhood. Namun tokenization baru menyelesaikan *issuance dan trading*. Seluruh **lifecycle pasca-issuance** — dividen, stock split, stock dividend, rights issue — masih ditangani off-chain oleh issuer, tidak transparan, dan tidak bisa dikonsumsi oleh smart contract lain.

### 2.2 Masalah yang dipecahkan

1. **Holder tidak punya rail on-chain untuk menerima dividen.** Tidak ada record date, tidak ada claim mechanism, tidak ada bukti distribusi yang auditable.
2. **Protokol DeFi buta terhadap corporate actions.** Lending market yang memakai tokenized stock sebagai collateral tidak tahu kapan split terjadi; AMM tidak tahu kapan ex-dividend date. Ini risiko sistemik nyata begitu RWA dipakai sebagai collateral.
3. **AI agents tidak bisa bereaksi.** Agent economy di Arbitrum (x402, ERC-8004) butuh data corporate action yang machine-readable untuk strategi yang sadar-dividen.
4. **Issuer tidak punya tooling.** Transfer agent tradisional mengelola ini dengan sistem tertutup; belum ada "transfer agent in a box" untuk on-chain issuer.

### 2.3 Mengapa sekarang, mengapa di sini

Robinhood Chain testnet baru live, gap-nya terdokumentasi (tidak ada dividend handling), partner infra (Chainlink, Alchemy, Allium, TRM) sudah tersedia, dan buildathon ini secara eksplisit mereservasi hadiah untuk project yang dibangun di chain tersebut. Window peluangnya sempit dan jelas — dan per §2.4, kita tidak sendirian di dalamnya.

### 2.4 Lanskap kompetitif — CorpAction Engine (update 10 Juni 2026)

Teridentifikasi satu submission di ruang yang sama: **CorpAction Engine** (`github.com/wangyangmingsss/corpaction-engine`) — corporate action oracle + execution engine bercakupan luas: 11 kontrak (registry, validator quorum M-of-N, timelock, executors untuk 9 jenis action termasuk merger/spin-off/delisting), pipeline ingestion off-chain (SEC EDGAR, DTCC ISO 20022, dsb.), SDK TypeScript, monitoring Prometheus/Grafana, dan deployment di Robinhood Chain testnet dengan tx hash terpublikasi.

Celah yang teramati dari README mereka (verifikasi langsung di H0 sebelum dipakai sebagai claim publik):

| Dimensi | CorpAction Engine | Parvalon |
|---|---|---|
| Aset yang dipakai | Demo pada ticker AAPL/NVDA/GOOGL/MSFT/TWTR — bukan stock tokens yang benar-benar ada di testnet (TSLA/AMZN/PLTR/NFLX/AMD) → indikasi mock tokens / closed loop; SplitExecutor mensyaratkan token ber-ERC-8056 (butuh kontrol token) | Berjalan pada **TSLA/AMZN riil milik Robinhood** tanpa modifikasi token (permissionless snapshot) |
| Bukti E2E | Tx terpublikasi = intent *proposals* + ops admin (pause/resume, configure quorum, attestation); tidak terlihat publish root, execute dividend, atau **claim oleh holder** | DoD = holder claim USDG nyata, ≥2 wallet, verifiable di explorer |
| Produk/UX | Tanpa frontend (Solidity + TypeScript saja); tanpa holder experience | Claim dashboard passkey gasless = pusat demo |
| Keterauditan saat penjurian | 11 kontrak UUPS + 3 services + Postgres — sulit diverifikasi juri dalam waktu penjurian; quorum demo 1-of-1; beberapa adapter stub; badge coverage statis | 2 kontrak immutable, fokus, NatSpec — terbaca tuntas dalam 10 menit |

**Implikasi strategi:** jangan berlomba breadth (kalah pasti dalam 4 hari — dan breadth tanpa bukti E2E adalah kelemahan mereka, bukan kekuatan). Menang lewat **realism + depth + product**: aset riil, satu alur sempurna, UX consumer, kontrak auditable, CAE-1. Top-3 punya 3 slot — bukan zero-sum melawan satu repo.

**Etika kompetisi:** jangan pernah menyebut atau menyerang kompetitor dalam video/teks submission. Biarkan diferensiasi berbicara lewat demo: *"works on the tokens that already exist — no token changes, no issuer integration required."*

---

## 3. Goals, Non-Goals & Guardrails

### 3.1 Goals (hackathon)

| # | Goal | Ukuran keberhasilan |
|---|---|---|
| G1 | Satu siklus corporate action CASH_DIVIDEND berjalan end-to-end di Robinhood Chain testnet | ≥2 wallet uji berhasil klaim USDG pro-rata dengan jumlah benar |
| G2 | Kontrak berkualitas "judge-grade" | Verified di Blockscout, unit tests lulus, OpenZeppelin patterns, akses kontrol jelas |
| G3 | Claim UX kelas consumer | Passkey login + gasless claim (atau fallback rapi), mobile-friendly |
| G4 | Machine-readable action feed | Endpoint JSON + event schema CAE-1 terdokumentasi |
| G5 | Submission lengkap sebelum deadline | Video <3 menit, repo publik, alamat kontrak + tx hash, masuk HackQuest ≤ 14 Juni 18:00 WIB-equivalent |

### 3.2 Non-Goals (eksplisit di luar scope hackathon)

- **Bukan** custody, brokerage, atau penerbitan token saham — Parvalon adalah lapisan operasional di atas token yang sudah ada.
- **Bukan** kepatuhan legal/regulasi riil (tax withholding, KYC issuer) — disimulasikan; field metadata disiapkan untuk masa depan.
- **Bukan** rebasing/modifikasi kontrak token underlying — kita tidak mengontrol kontrak TSLA/AMZN milik Robinhood (lihat keputusan desain D2).
- **Bukan** mainnet deployment, multi-chain, atau stock dividend in-kind penuh.
- **Bukan** auto-reinvest produksi — hanya stretch demo (P2) karena tidak ada jaminan likuiditas DEX di testnet.

### 3.3 Guardrails eksekusi solo

1. P0 harus selesai sebelum menyentuh P1; P1 sebelum P2. Tidak ada pengecualian.
2. Setiap integrasi pihak ketiga di-timebox (lihat decision gates di §12).
3. Semua keputusan desain sudah diputuskan di PRD ini — tidak ada re-litigasi arsitektur di tengah build.

---

## 4. Target Users & Personas

| Persona | Deskripsi | Kebutuhan | Peran di demo |
|---|---|---|---|
| **P1 — Retail Holder ("Dina")** | Pemegang token TSLA/AMZN self-custody | Tahu dividen yang menjadi haknya, klaim semudah aplikasi fintech, tanpa seed phrase & tanpa mikir gas | Klaim dividen via passkey, gasless |
| **P2 — Issuer / Transfer Agent Ops ("Robinhood Ops")** | Tim operasional penerbit tokenized stock | Mengumumkan action, mengambil snapshot record date, mendanai pool payout, audit trail lengkap | Menjalankan issuer console |
| **P3 — Integrator / Protocol Dev ("Leo")** | Developer lending/AMM/agent yang memakai tokenized stock | Event terstandar + endpoint untuk bereaksi terhadap dividen/split | Mengkonsumsi action feed JSON & events |

Pembeli sesungguhnya (PMF): **P2 dan P3** — Parvalon adalah B2B2C infrastructure. P1 adalah wajah demo karena paling visual untuk juri.

---

## 5. User Stories (diprioritaskan)

**P0 — wajib untuk demo**

- US-1 (P2): Sebagai issuer, saya bisa `announceAction(asset, CASH_DIVIDEND, ratePerShare, recordBlock, payableAt, payoutToken, metadataURI)` sehingga action tercatat on-chain dengan ID unik dan event terpancar.
- US-2 (P2): Sebagai issuer, setelah record block lewat, saya bisa menjalankan snapshot script yang membaca balance seluruh holder pada `recordBlock` dan menghasilkan Merkle root + file proofs.
- US-3 (P2): Sebagai issuer, saya bisa `publishRoot(actionId, root, totalPayout)` lalu `fund(actionId, amount)` dalam USDG sehingga action berstatus CLAIMABLE.
- US-4 (P1): Sebagai holder, saya bisa membuka dashboard, melihat dividen yang eligible untuk token yang saya pegang, dan `claim()` — menerima USDG sesuai pro-rata, idealnya gasless via passkey.
- US-5 (P1): Sebagai holder, saya bisa melihat riwayat klaim saya dan memverifikasi tx di Blockscout.

**P1 — kuat untuk dimiliki**

- US-6 (P3): Sebagai integrator, saya bisa membaca `GET /api/actions` (JSON) dan subscribe ke events CAE-1 untuk seluruh corporate actions.
- US-7 (P2): Sebagai issuer, saya bisa `sweepUnclaimed(actionId)` setelah claim window berakhir, mengembalikan dana sisa.
- US-8 (P2): Sebagai issuer, saya bisa mengumumkan `STOCK_SPLIT` sebagai **informational action** (event + metadata rasio) yang dikonsumsi integrator — tanpa rebasing token.

**P2 — stretch**

- US-9 (P1): Sebagai holder, saya bisa memilih "claim & reinvest" yang menukar USDG ke token saham via mock pool (demo only).
- US-10 (P3): Sebagai agent developer, saya bisa menjalankan contoh script agent yang mendeteksi `ActionAnnounced` dan mencetak keputusan strategi (tie-in narasi agentic).

---

## 6. Solution Overview & Arsitektur

### 6.1 Komponen

```
┌─────────────────────────────────────────────────────────────────┐
│                        Parvalon dApp (Next.js)                   │
│  /claim (Holder) · /issuer (Console) · /feed (+ /api/actions)   │
│           Alchemy Account Kit (passkey, ERC-4337, gasless)       │
└───────────────┬─────────────────────────────────┬───────────────┘
                │ viem/wagmi                      │ read
                ▼                                 ▼
┌───────────────────────────┐      ┌──────────────────────────────┐
│ CorporateActionRegistry   │◄─────│  Snapshot CLI (TypeScript)    │
│  - announce/publish/state │ root │  - getLogs Transfer s/d       │
│  - roles per asset        │      │    recordBlock → balances     │
│  - events CAE-1           │      │  - build Merkle tree + proofs │
└────────────┬──────────────┘      └──────────────────────────────┘
             │ status
             ▼
┌───────────────────────────┐      ┌──────────────────────────────┐
│ DividendDistributor       │◄────►│ USDG (payout) · TSLA/AMZN     │
│  - fund / claim / sweep   │      │ (snapshot source, read-only)  │
│  - Merkle verify + bitmap │      └──────────────────────────────┘
└───────────────────────────┘
        Robinhood Chain Testnet — Chain ID 46630 — explorer Blockscout
```

### 6.2 Keputusan desain kunci (sudah final)

| ID | Keputusan | Alasan |
|---|---|---|
| **D1** | **Merkle-snapshot claim model**, bukan accumulator vault / dividend-paying token | Kita **tidak mengontrol** kontrak token saham Robinhood — tidak bisa pasang transfer hooks. Snapshot via `eth_getLogs` bekerja permissionless terhadap token apa pun; klaim O(1) gas via bitmap; semantik **record date** justru memetakan 1:1 ke cara corporate actions bekerja di dunia nyata. Ini talking point kuat di video. |
| **D2** | **Split ditangani sebagai informational action (event + ratio metadata)**, bukan rebasing | Rebasing mustahil tanpa kontrol token underlying. Yang dibutuhkan integrator adalah *sinyal terstandar* untuk menyesuaikan harga/collateral factor. Jujur secara engineering = nilai plus di mata juri. |
| **D3** | **AdminOracle (issuer-fed) untuk MVP**, di balik interface `IActionSource` yang Chainlink-compatible | Tidak ada Chainlink corporate-actions feed di testnet ini. Mendesain adapter interface sekarang + menyebut Chainlink Functions sebagai jalur produksi = kreatif tanpa berbohong. |
| **D4** | **Payout dalam USDG** | Stablecoin native ekosistem (faucet Paxos tersedia), mencerminkan cash dividend riil. |
| **D5** | **Claim UX: Alchemy Smart Wallets (passkey) + Gas Manager, timebox 4 jam**, fallback wagmi EOA | Diferensiasi UX adalah kekuatan inti builder; tapi P0 tidak boleh tersandera integrasi. |
| **D6** | **Event schema diberi nama "CAE-1" (Corporate Action Events)** dan didokumentasikan sebagai draft standard | Proposal standar membuat project memorable dan memperkuat narasi infrastructure-layer, bukan app sekali pakai. |
| **D7** | Snapshot menyertakan **semua address ber-balance > 0**, termasuk contracts | Testnet kecil; exclusion list (LP/escrow) jadi konfigurasi produksi, dicatat di Limitations. |

### 6.3 Alur utama (happy path demo)

1. Issuer announce: TSLA cash dividend, rate 0.50 USDG/share, recordBlock = N (≈ +10 menit), payableAt = N+M.
2. Block N lewat → jalankan `pnpm snapshot --action 1` → output `proofs.json` + root + totalPayout.
3. Issuer `publishRoot` → `approve` USDG → `fund`. Status: CLAIMABLE.
4. Dina buka `/claim`, login passkey, melihat "TSLA Dividend — 12.5 USDG", tekan **Claim** → UserOp gasless → USDG masuk.
5. `/feed` menampilkan action; `curl /api/actions` mengembalikan JSON; event `Claimed` tampak di Blockscout.

---

## 7. Functional Requirements

| ID | Requirement | Prioritas | Acceptance criteria |
|---|---|---|---|
| FR-1 | Registry menyimpan corporate action: `{id, asset, actionType, ratePerShare, recordBlock, payableAt, claimDeadline, payoutToken, merkleRoot, totalPayout, status, metadataURI}` | P0 | Action ter-query via `getAction(id)`; event `ActionAnnounced` terpancar dengan seluruh field |
| FR-2 | Hanya address ber-`ISSUER_ROLE` untuk asset terkait yang bisa announce/publish/fund/sweep | P0 | Tx dari address lain revert `Unauthorized()` |
| FR-3 | `publishRoot` hanya valid setelah `block.number > recordBlock` dan status `ANNOUNCED` | P0 | Revert `RecordNotTaken()` / `InvalidStatus()` |
| FR-4 | `fund(actionId, amount)` menarik USDG via `safeTransferFrom`; status → `CLAIMABLE` ketika `funded >= totalPayout` | P0 | Balance distributor bertambah; event `Funded` |
| FR-5 | `claim(actionId, index, account, amount, proof)` memverifikasi Merkle proof, menandai bitmap, transfer USDG ke `account` | P0 | Klaim ganda revert `AlreadyClaimed()`; jumlah sesuai proofs.json |
| FR-6 | Klaim bisa dieksekusi oleh siapa pun *untuk* `account` (claim-on-behalf) — dana selalu ke `account` | P0 | Memungkinkan gasless relay & agent automation tanpa risiko pencurian |
| FR-7 | Snapshot CLI merekonstruksi balances pada `recordBlock` dari Transfer logs dan menghasilkan root deterministik | P0 | Dua kali run = root identik; total = Σ(balance×rate) |
| FR-8 | Holder dashboard menampilkan eligible claims untuk address yang terhubung + status (claimable/claimed/expired) | P0 | Cocok dengan state on-chain |
| FR-9 | Issuer console: form announce, instruksi snapshot, publish, fund (approve+fund) | P0 | Seluruh siklus bisa dijalankan tanpa menyentuh CLI selain snapshot |
| FR-10 | `sweepUnclaimed` setelah `claimDeadline` mengembalikan sisa ke issuer | P1 | Sebelum deadline revert; sesudahnya sisa = funded − claimed |
| FR-11 | `STOCK_SPLIT` announce-only dengan `ratio` di metadata; tanpa distributor | P1 | Event terpancar; feed menampilkan |
| FR-12 | `GET /api/actions` mengembalikan JSON seluruh actions (id, asset, type, status, key dates, amounts) | P1 | Response valid, terdokumentasi di README |
| FR-13 | Pause/unpause oleh admin untuk emergency stop klaim | P1 | `whenNotPaused` di claim/fund |
| FR-14 | Claim & reinvest via MockPool (USDG→TSLA) | P2 | Demo only, berlabel jelas |
| FR-15 | Contoh agent script subscribe `ActionAnnounced` | P2 | Log keputusan di console |

## 8. Smart Contract Specification

### 8.1 Stack & konvensi

- **Solidity 0.8.26**, Foundry (forge test, forge script deploy), OpenZeppelin Contracts v5 (`AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeERC20`, `MerkleProof`, `BitMaps`).
- Custom errors (bukan require-string), NatSpec penuh, events untuk semua state change — ini yang dilihat juri saat membuka repo.
- Verifikasi source di Blockscout (`explorer.testnet.chain.robinhood.com`) wajib untuk kedua kontrak.

### 8.2 Interface inti

```solidity
enum ActionType { CASH_DIVIDEND, STOCK_SPLIT, STOCK_DIVIDEND }
enum ActionStatus { ANNOUNCED, ROOT_PUBLISHED, CLAIMABLE, FINALIZED, CANCELLED }

struct CorporateAction {
    uint256 id;
    address asset;          // token saham (TSLA, AMZN, ...)
    ActionType actionType;
    uint256 ratePerShare;   // payout per 1e18 unit asset (CASH_DIVIDEND)
    uint64  recordBlock;    // snapshot block — record date semantics
    uint64  payableAt;      // klaim dibuka
    uint64  claimDeadline;  // sweep diizinkan setelah ini
    address payoutToken;    // USDG
    bytes32 merkleRoot;
    uint256 totalPayout;
    ActionStatus status;
    string  metadataURI;    // JSON: ticker, ex-date, ratio split, dsb.
}

interface ICorporateActionRegistry {
    event ActionAnnounced(uint256 indexed id, address indexed asset, ActionType actionType,
        uint256 ratePerShare, uint64 recordBlock, uint64 payableAt, address payoutToken, string metadataURI);
    event MerkleRootPublished(uint256 indexed id, bytes32 root, uint256 totalPayout, uint256 holderCount);
    event ActionStatusChanged(uint256 indexed id, ActionStatus status);

    function announceAction(CorporateAction calldata a) external returns (uint256 id);
    function publishRoot(uint256 id, bytes32 root, uint256 totalPayout, uint256 holderCount) external;
    function getAction(uint256 id) external view returns (CorporateAction memory);
}

interface IDividendDistributor {
    event Funded(uint256 indexed id, address indexed from, uint256 amount);
    event Claimed(uint256 indexed id, uint256 index, address indexed account, uint256 amount);
    event UnclaimedSwept(uint256 indexed id, address to, uint256 amount);

    function fund(uint256 id, uint256 amount) external;
    function claim(uint256 id, uint256 index, address account, uint256 amount, bytes32[] calldata proof) external;
    function isClaimed(uint256 id, uint256 index) external view returns (bool);
    function sweepUnclaimed(uint256 id) external;
}
```

### 8.3 Detail implementasi penting

1. **Leaf encoding:** `keccak256(bytes.concat(keccak256(abi.encode(actionId, index, account, amount))))` — double-hash sesuai OpenZeppelin `StandardMerkleTree`, mencegah second-preimage.
2. **Bitmap klaim:** `mapping(uint256 actionId => BitMaps.BitMap)` — satu slot per 256 holder, gas klaim rendah; talking point "smart contract quality".
3. **Akses:** `ISSUER_ROLE` di-scope per asset via `mapping(address asset => address issuer)`; `DEFAULT_ADMIN_ROLE` = deployer (didokumentasikan sebagai multisig di produksi).
4. **Reentrancy:** `nonReentrant` pada `claim`/`fund`/`sweep`; `SafeERC20` untuk seluruh transfer.
5. **Invariant test (foundry):** Σ claimed ≤ funded; klaim idempotent; root immutable setelah CLAIMABLE.
6. **Unit tests minimum:** happy path E2E, double-claim revert, wrong-proof revert, unauthorized announce revert, sweep before/after deadline, pause blocks claim. Target: hijau semua di CI badge README.

### 8.4 Snapshot CLI (off-chain, bagian dari "kontrak sosial" protokol)

- TypeScript + viem. Input: `asset`, `recordBlock`, `ratePerShare`. Proses: `getLogs Transfer(0→N)` dari block deploy token → rekonstruksi balance map → filter > 0 → hitung `amount = balance × rate / 1e18` → `StandardMerkleTree.of(...)` → output `root`, `totalPayout`, `proofs.json` (di-commit ke repo + di-serve frontend).
- Deterministik & auditable: siapa pun bisa re-run dan memverifikasi root — transparansi yang tidak dimiliki transfer agent tradisional. Sebutkan ini di video.
- Produksi (roadmap): indexer Allium + publikasi dataset IPFS.

## 9. Frontend & UX Specification

### 9.1 Stack

Next.js 14 (App Router) + Tailwind + viem/wagmi + **Alchemy Account Kit** (passkey signer, ERC-4337, Gas Manager sponsorship). Deploy: Vercel. Estetika: fintech bersih (rujukan: Robinhood/Mercury) — bukan "crypto dashboard" gelap generik; ini area di mana 15+ tahun product design menjadi unfair advantage yang terlihat dalam 10 detik pertama video.

### 9.2 Halaman

| Route | Persona | Isi |
|---|---|---|
| `/claim` | Holder | Login passkey ("Continue with passkey" — tanpa seed phrase), kartu per-token: logo, jumlah dividen claimable, tombol **Claim** (gasless), riwayat klaim + link Blockscout |
| `/issuer` | Issuer | Stepper 4 langkah: Announce → Snapshot (instruksi CLI + paste root) → Publish → Fund. Status badge per action |
| `/feed` | Integrator | Tabel seluruh actions + filter; blok "For developers": contoh `curl /api/actions` + cuplikan event CAE-1 |

### 9.3 Prinsip UX yang dinilai juri

1. **Zero-jargon path untuk holder:** tidak ada kata "Merkle", "proof", "gas" di UI holder — hanya "Your dividend is ready".
2. **Sertakan empty/loading/error states** — pembeda kualitas yang jarang dikerjakan peserta hackathon.
3. **Satu demo wallet pre-seeded** agar video mulus, plus QR untuk juri mencoba sendiri.

## 10. Data, Snapshot & Oracle Design

- **Sumber kebenaran action:** issuer (AdminOracle) di MVP — merefleksikan realita bahwa corporate action memang berasal dari issuer/registrar. Interface `IActionSource` disiapkan agar produksi bisa diganti **Chainlink Functions** (pull dari data vendor) tanpa mengubah Registry. Jelaskan trade-off ini secara eksplisit di README — kejujuran engineering adalah sinyal senioritas.
- **USDG funding:** faucet Paxos testnet ("Send 100 Tokens") ke wallet issuer; jika kurang untuk demo besar, rate dividen dikecilkan (0.05 USDG/share) — angka demo tidak penting, mekanismenya yang dinilai.
- **Stock token TSLA/AMZN:** read-only. Day-0 wajib uji: transfer antar 2 EOA berhasil? `decimals()`? Jika token ternyata transfer-restricted, klaim **tetap berfungsi** (payout = USDG, bukan stock; snapshot hanya membaca logs) — risiko terisolasi.

## 11. Non-Functional Requirements

| Kategori | Requirement |
|---|---|
| Keamanan | OZ v5, custom errors, no delegatecall, no upgradability (immutable utk hackathon — lebih mudah diaudit juri), checks-effects-interactions |
| Gas | Klaim target < 90k gas (bitmap + single transfer); publish root O(1) |
| Auditability | Semua state change ber-event; root + proofs.json publik di repo; alamat kontrak & tx hash di README |
| Reliabilitas demo | Seed script (`forge script Seed.s.sol`) menyiapkan ulang seluruh state demo < 5 menit jika perlu re-record |
| Aksesibilitas | Kontras WCAG AA, fokus state keyboard pada tombol Claim |

---

## 12. Milestones — Rencana 4 Hari (10–14 Juni 2026)

> Prinsip: **P0 dulu, demo-able setiap malam.** Setiap hari ditutup dengan state yang bisa direkam jika besoknya terjadi bencana.

### H0 — Rabu, 10 Juni (sisa hari ini): *Foundation & de-risking*
- Daftar/konfirmasi registrasi di HackQuest.
- Setup wallet issuer + 2 wallet holder; klaim faucet Robinhood Chain (0.05 ETH + 5 unit per Stock Token / 24 jam — klaim hari ini DAN besok untuk stok cukup) + USDG via faucet Paxos.
- Tambah network Chain ID 46630 (RPC Alchemy), deploy + verify kontrak `Ping` di Blockscout.
- **Uji transfer TSLA antar wallet** → input Decision Gate 1.
- (30 menit) **Competitive verification:** telusuri alamat & tx CorpAction Engine di Blockscout — konfirmasi apakah demo mereka memakai mock tokens dan apakah ada holder claim. Hasilnya mengkalibrasi seberapa agresif positioning §2.4 dipakai (tanpa pernah menyebut mereka).
- Scaffold monorepo: `contracts/` (Foundry) + `app/` (Next.js) + `tooling/snapshot`.
- Draft `CorporateActionRegistry` selesai compile + 2 test pertama.
- 🌙 *State akhir hari:* environment terbukti jalan; risiko platform tereliminasi.

### H1 — Kamis, 11 Juni: *Protocol day*
- Selesaikan Registry + DividendDistributor + test suite penuh (target ≥ 12 tests hijau).
- Snapshot CLI jalan terhadap recordBlock riil di testnet; verifikasi total & determinisme.
- Deploy keduanya ke Robinhood Chain, verify, jalankan **siklus E2E pertama via cast/script** (tanpa UI): announce → snapshot → publish → fund → claim ke 2 wallet.
- 🌙 *State akhir hari:* protokol terbukti benar on-chain. Ini adalah "minimum submittable product".

### H2 — Jumat, 12 Juni: *Product day*
- Pagi: `/claim` + `/issuer` fungsional dengan wagmi EOA.
- Siang: integrasi Alchemy Account Kit + Gas Manager — **timebox 4 jam** (Decision Gate 2).
- Sore: `/feed` + `/api/actions` (FR-12), polish copywriting UI.
- 🌙 *State akhir hari:* E2E penuh lewat UI, idealnya gasless-passkey.

### H3 — Sabtu, 13 Juni: *Story day*
- Seed script untuk state demo bersih; jalankan full dry-run.
- README "judge-grade": problem, arsitektur (diagram §6.1), alamat kontrak, tx hash contoh, cara reproduce, limitations, roadmap.
- Tulis & rekam **video < 3 menit** (skrip §13) + edit.
- Draft teks submission HackQuest (paste-ready).
- 🌙 *State akhir hari:* materi submission 100% siap; tersisa hanya tombol submit.

### H4 — Minggu, 14 Juni: *Buffer & submit*
- Pagi: bugfix kecil, re-record satu segmen video bila perlu.
- **Submit di HackQuest paling lambat pukul 18:00** (buffer 5 jam dari deadline 22:59 — jangan pertaruhkan pada jam terakhir).
- Post-submit: tweet/thread build-in-public (opsional, membantu visibility ke tim Arbitrum).

### Decision Gates (keputusan sudah ditetapkan, tinggal eksekusi)

| Gate | Waktu | Trigger | Keputusan |
|---|---|---|---|
| **G1** | H0 malam | Faucet/RPC Robinhood Chain gagal/tidak stabil | Pivot penuh ke **Arbitrum Sepolia** + deploy `MockTSLA`/`MockUSDG` sendiri. Kontrak & narasi identik; tetap memenuhi syarat deploy + slot Arbitrum |
| **G2** | H2 jam ke-4 integrasi AA | Passkey/Gas Manager belum jalan | Ship dengan wagmi EOA + tombol "Gasless coming soon"; kualitas visual UI tetap membawa nilai UX |
| **G3** | H3 siang | Tertinggal dari jadwal | Potong FR-11/12 (P1) dan seluruh P2; lindungi video + README |

---

## 13. Demo Plan & Skrip Video (≤ 3 menit)

**Format:** screen recording + voice-over Bahasa Inggris, subtitle. Satu take per segmen.

| Waktu | Segmen | Naskah inti |
|---|---|---|
| 0:00–0:20 | **Hook** | "There are almost two thousand tokenized stocks on Arbitrum — and if you actually hold one, there is still no way to claim a dividend on-chain. Tokenization solved issuance. Parvalon is the operations layer that works on the tokens that already exist — no token changes, no issuer integration required." |
| 0:20–0:45 | Masalah | 3 korban: holder (tak ada rail klaim), protokol DeFi (buta split/ex-date → risiko collateral), agents (tak ada data machine-readable). |
| 0:45–1:30 | Demo issuer | Announce TSLA dividend → record block → snapshot CLI (tunjukkan determinisme & auditability: "anyone can re-run and verify this root") → publish → fund USDG. |
| 1:30–2:10 | Demo holder ⭐ | Passkey login, "Your dividend is ready", satu tap Claim, gasless, USDG masuk, bukti di Blockscout. Momen paling visual — perlambat di sini. |
| 2:10–2:35 | Integrator + CAE-1 | `curl /api/actions`; cuplikan event; "lending markets and AI agents can finally react to corporate actions". |
| 2:35–3:00 | Arsitektur & roadmap | Diagram 1 layar; honesty note ("issuer-fed oracle today, Chainlink Functions adapter next"); ajakan: "the transfer agent for the on-chain economy — built on Robinhood Chain". |

**Aset juri:** link dApp live (Vercel), QR demo wallet, alamat kontrak verified, repo publik.

---

## 14. Mapping ke Kriteria Juri

| Kriteria | Bagaimana Parvalon menang di sini |
|---|---|
| **Smart contract quality** | OZ v5 + StandardMerkleTree, bitmap claims, custom errors, NatSpec, ≥12 unit tests + invariants, verified source, immutable-by-design dengan justifikasi |
| **Product-Market Fit** | Pembeli jelas (issuer/transfer agent; integrator protokol), wedge → platform, pasar terukur (1.997 tokenized stocks; RWA = vertikal prioritas resmi ekosistem), jalur grants/Founder House masuk akal |
| **Innovation & Creativity** | Permissionless overlay: bekerja pada token yang TIDAK kita kontrol (aset riil testnet) — kebalikan pendekatan issuer-integrated; record-date semantics via Merkle snapshot; draft standar **CAE-1**; claim-on-behalf ramah agent; kontrak cukup ringkas untuk diaudit juri saat penjurian |
| **Real Problem Solving** | Menyasar persis gap yang dipuji juri NYC: *operational services layer* untuk institutional tokenization — bukan dashboard, bukan fork |
| **Syarat formal** | Deployed + verified di **Robinhood Chain** → memenuhi slot reserved; submission lengkap sebelum deadline |

---

## 15. Metrics & Definition of Done

**DoD P0 (gerbang submit):**
1. ✅ 1 action `CASH_DIVIDEND` TSLA selesai full lifecycle di Robinhood Chain testnet.
2. ✅ ≥2 wallet klaim USDG dengan jumlah pro-rata terverifikasi (cek manual vs proofs.json).
3. ✅ Kedua kontrak verified di Blockscout; alamat + tx hash di README.
4. ✅ Frontend live di Vercel; claim flow berjalan di mobile viewport.
5. ✅ Video ≤ 3 menit ter-upload; repo publik dengan README lengkap.
6. ✅ Submission HackQuest terkirim ≤ 14 Juni 18:00.

**Metrik demo (ditampilkan di README):** gas per claim, waktu siklus announce→claim, jumlah holder ter-snapshot, determinisme root (2 run identik).

---

## 16. Risks & Mitigations

| # | Risiko | Prob. | Dampak | Mitigasi |
|---|---|---|---|---|
| R1 | Faucet/RPC Robinhood Chain bermasalah | Sedang | Tinggi | Klaim faucet H0+H1 (akumulasi); RPC Alchemy + fallback public; **Gate 1 → Sepolia + mock tokens** |
| R2 | Token saham testnet transfer-restricted / non-standar | Rendah–Sedang | Sedang | Uji H0; arsitektur sudah imun (payout USDG, snapshot dari logs); dokumentasikan temuan di README — bahkan jadi konten "field notes" yang menarik |
| R3 | Integrasi AA/passkey memakan waktu | Sedang | Sedang | **Gate 2** timebox 4 jam; fallback EOA tetap rapi |
| R4 | Scope creep solo-builder | Tinggi | Tinggi | Guardrails §3.3; P2 hanya jika H3 selesai sebelum makan malam |
| R5 | USDG faucet terbatas | Sedang | Rendah | Rate dividen kecil (0.05 USDG/share); mekanisme > nominal |
| R6 | Snapshot berat jika holder banyak | Rendah (testnet) | Rendah | Chunked getLogs; catat Allium indexer sebagai jalur produksi |
| R7 | Ide serupa dari peserta lain — **TERJADI** (CorpAction Engine, §2.4) | Pasti | Sedang | Repositioning depth-vs-breadth sudah dieksekusi (§2.4): menang via aset riil + holder claim E2E + UX passkey + kontrak auditable; 3 slot top-3 = bukan zero-sum; jangan menyebut kompetitor di materi submission |
| R8 | Burnout / force majeure | — | Tinggi | "Minimum submittable product" sudah tercapai di H1 malam; tiap malam punya fallback yang bisa disubmit |

---

## 17. Roadmap Pasca-Hackathon (materi pitch Grants & Founder House)

| Milestone | Isi | Sinyal traction |
|---|---|---|
| M1 (2–4 minggu) | Wrapper vault opsional untuk split/stock-dividend in-kind; library `SplitAdjuster` untuk lending/AMM | 1 protokol integrator pilot |
| M2 | `IActionSource` adapter Chainlink Functions + issuer SDK TypeScript | Demo data vendor riil |
| M3 | Publikasi draft **CAE-1** sebagai ERC; claim relayer + dukungan x402 untuk agent subscriptions | Diskusi di Ethereum Magicians |
| M4 | Multi-issuer onboarding (Backed, Dinari, dsb.) + mainnet Robinhood Chain saat live | LOI issuer |

Posisi jangka panjang: **Parvalon = transfer agent layer untuk on-chain capital markets.** Dividen hanyalah wedge.

---

## 18. Submission Checklist (HackQuest)

- [ ] Project name, tagline, deskripsi (≤ 200 kata, fokus "missing operational layer")
- [ ] Track: Overall — tandai dibangun di **Robinhood Chain**
- [ ] Link repo publik (README judge-grade)
- [ ] Link video demo (YouTube unlisted, ≤ 3 menit)
- [ ] Link dApp live (Vercel)
- [ ] Alamat kontrak verified + contoh tx hash (announce, fund, claim)
- [ ] Screenshot/banner 16:9
- [ ] (Opsional) 1-pager deck PDF untuk jalur grants

---

## 19. Asumsi & Open Questions

| # | Item | Status / rencana |
|---|---|---|
| A1 | Token saham testnet ERC-20 standar & transferable | Diverifikasi H0; arsitektur tahan terhadap kedua kemungkinan |
| A2 | Faucet USDG Paxos aktif & cukup | Diverifikasi H0; fallback rate kecil / mock |
| A3 | Buildathon menerima project yang dimulai saat periode berjalan | Ya — aturan menyatakan boleh project lama maupun baru; kita mulai bersih |
| A4 | Exclusion list address (LP/escrow) di snapshot | Out of scope testnet (D7); konfigurasi di produksi |
| A5 | Detail juri/format penilaian bisa berubah | Cek ulang halaman HackQuest H3 sebelum finalisasi teks submission |

---

*Dokumen ini adalah single source of truth untuk build Parvalon hingga 14 Juni 2026. Perubahan scope hanya melalui Decision Gates §12.*
