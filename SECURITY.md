# Security Policy

CorporaX is a corporate-actions and dividend protocol for tokenized stocks on
Robinhood Chain (Arbitrum Orbit L2). It moves real value (payout-token
dividends) against on-chain holder snapshots, so we take security seriously and
welcome coordinated disclosure.

> **Status:** This is a hackathon-stage codebase deployed to **testnets**
> (Robinhood Chain testnet `46630`, Arbitrum Sepolia `421614`) and local anvil
> (`31337`). It has **not** undergone a third-party audit. Do not use it with
> mainnet value until that happens. Findings are still very welcome.

## Reporting a Vulnerability

**Please do not open a public issue, PR, or discussion for security reports.**

Instead, report privately via one of:

- **GitHub Private Vulnerability Reporting** — the preferred channel: use the
  repository's **Security → Report a vulnerability** tab (GitHub Security
  Advisories). This keeps the report private and threaded.
- **Email** — `security@corporax.example` *(placeholder — replace with the
  maintainer's real security contact before any production deployment)*.
  Encrypt sensitive details with our PGP key if one is published in this repo.

Please include:

- a clear description of the issue and the security impact,
- the affected contract/file and, where possible, function and line,
- a proof-of-concept (a Foundry test is ideal — see `contracts/test/`),
- chain and deployment addresses you reproduced against,
- any suggested remediation.

### Our commitment

- **Acknowledge** your report within **3 business days**.
- Provide an initial **assessment / triage** within **7 business days**.
- Keep you updated on remediation progress and coordinate a disclosure timeline
  (default **90 days**, or sooner once a fix or mitigation is live).
- Credit you in the advisory and release notes unless you prefer to remain
  anonymous.

We ask that you give us a reasonable window to remediate before any public
disclosure, and that you avoid privacy violations, data destruction, or
service degradation while testing.

## Scope

**In scope** — the protocol smart contracts and the off-chain code that
produces or consumes claim data:

- `contracts/src/CorporateActionRegistry.sol` — action lifecycle, roles, root
  publication.
- `contracts/src/DividendDistributor.sol` — funding, Merkle-proof claims,
  sweep accounting.
- `contracts/src/oracle/AdminActionSource.sol` — the `IActionSource` (D3) seam.
- `contracts/src/interfaces/**` and `contracts/src/libraries/**`.
- The canonical Merkle leaf encoding and `corporax-merkle-v1` proofs schema
  (see `docs/INTEGRATION.md` §4–5) — e.g. leaf-collision, index-reuse, or
  amount-mismatch attacks against `claim()`.
- The snapshot CLI (`tooling/snapshot/`) and the frontend's
  proof-serving / claim path (`app/`, `/api/actions`) insofar as they can
  cause incorrect or unauthorized payouts.
- Deployment + seed scripts (`contracts/script/**`) for misconfiguration that
  weakens the deployed posture (e.g. role/issuer wiring).

**Out of scope:**

- `contracts/src/mocks/**` (MockERC20, MockPool) — test/demo helpers only,
  never deployed to production.
- `contracts/lib/**` — vendored dependencies (OpenZeppelin, forge-std). Report
  issues there upstream; we will pull fixes.
- Testnet/demo configuration, faucet keys, the well-known anvil mnemonic, and
  anything in `infra/` that is explicitly labelled dev-only (the local Docker
  stack ships well-known keys by design — that is not a finding).
- Centralization / trust assumptions that are **documented and intended**: the
  `DEFAULT_ADMIN_ROLE` (governance) and per-asset `ISSUER_ROLE` are privileged
  by design (a transfer-agent operates the action lifecycle). We are interested
  in privilege-escalation *beyond* the documented role model, not in the fact
  that privileged roles exist.
- Gas-optimization suggestions without a security impact, and best-practice
  nits already covered by our linters/static analysis.
- Spam, automated-scanner output without a demonstrated exploit, and
  social-engineering / physical attacks.

## Security Posture & Design

- **Immutable, non-upgradeable contracts.** `CorporateActionRegistry` and
  `DividendDistributor` are **not** proxies — there is **no upgrade path, no
  `delegatecall`, and no admin migration of code**. This is deliberate: it
  shrinks the trusted surface and lets reviewers audit the exact deployed
  bytecode. The trade-off is that a fix requires deploying a new instance and
  re-pointing integrators; we accept that for auditability. Treat any claimed
  "upgrade" or proxy-takeover vector as high-signal — it should be impossible
  by construction.
- **OpenZeppelin v5.1.0** primitives for `AccessControl`, `Pausable`,
  `ReentrancyGuard`, and `SafeERC20`.
- **Checks-Effects-Interactions** ordering; claims consume a **bitmap index**
  before transferring, so they are idempotent and replay-resistant.
- **Custom errors** throughout for precise, gas-lean revert reasons; **every
  state change emits an event** (CAE-1 schema, `docs/INTEGRATION.md` §3) for a
  complete audit trail.
- **Merkle claims** use OpenZeppelin `StandardMerkleTree` double-hashed leaves
  verified on-chain with commutative/sorted-pair `MerkleProof` — the encoding
  is frozen in `docs/INTEGRATION.md` §4.
- **Tested:** 81 Foundry tests (unit + fuzz to 60 holders + invariants such as
  `Σ claimed ≤ funded`, claim idempotency, and post-`CLAIMABLE` root
  immutability). CI also runs Slither (`.github/workflows/slither.yml`) and
  CodeQL.
- **Production hardening notes:** `DEFAULT_ADMIN_ROLE` is intended to be a
  multisig in production (it defaults to the deployer in scripts), and the
  action source should run with `AUTO_ATTEST=false` (require attestations)
  outside of testnet demos.

## Bug Bounty

There is **no formal paid bug-bounty program yet** — this project is at
hackathon stage. We **intend** to stand up a bounty (e.g. on Immunefi or via
GitHub Security Advisories with rewards) ahead of any mainnet deployment, scoped
to the contracts above and tiered by severity (CVSS / Immunefi-style
critical→low). Until then we will publicly credit valid reporters in the
advisory and release notes. If you would value a bounty, say so in your report
and we will track it for the program launch.

## Supported Versions

Only the latest `main` and the most recently deployed testnet addresses (see
`deployments/<chainId>.json`) are supported. Because the contracts are
immutable, "patching" means a fresh deployment and an updated address registry.

---

*Contacts and timelines above marked as placeholders must be finalized before
any production / mainnet deployment.*
