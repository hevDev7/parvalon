# CorporaX — Infra & DevOps

DevOps surface for CorporaX: CI/CD, container images, the local Docker stack,
and security tooling config. Everything here is reproducible and labelled where
it is **dev/demo-only**.

> Chains & env var names follow the frozen integration contract in
> [`docs/INTEGRATION.md`](../docs/INTEGRATION.md) §8–9. Local dev uses chainId
> **31337** (anvil); testnets are **46630** (Robinhood Chain) and **421614**
> (Arbitrum Sepolia).

## Contents

| Path | What it is |
|---|---|
| `infra/anvil.Dockerfile` | Local devnet (anvil) image; also carries `forge`/`cast` for the deployer. |
| `infra/frontend.Dockerfile` | Multi-stage Next.js **standalone** production image for `app/`. |
| `infra/deployer-entrypoint.sh` | One-shot: wait for anvil → `Deploy.s.sol` → `Seed.s.sol`. |
| `../docker-compose.yml` | Full local stack: anvil + deployer + frontend. |
| `../Makefile` | Task runner (`install`, `build`, `test`, `fmt`, `coverage`, `anvil`, `deploy-local`, `seed-local`, `snapshot`, `abi`, `up`). |
| `../.github/workflows/*` | CI: contracts, frontend, cli, slither, codeql. |
| `../.github/dependabot.yml` | Dependency updates (npm + github-actions). |
| `../contracts/slither.config.json`, `../contracts/.solhint.json`, `../.solhintignore` | Security/lint config. |
| `../SECURITY.md` | Disclosure policy, scope, posture. |

---

## 1. Prerequisites

- **Foundry** (`forge`, `cast`, `anvil`) — [getfoundry.sh](https://getfoundry.sh)
- **Node 20+** and **npm** (use **npm**, not pnpm)
- **Docker** + **Docker Compose v2** (for the container stack)

The OpenZeppelin / forge-std dependencies are **vendored** under
`contracts/lib` (not git submodules), so a plain checkout builds — no
`forge install` needed.

---

## 2. The local stack (Docker)

Brings up a complete, seeded environment with one command:

```bash
# from the repo root
docker compose up --build
```

Services (see `../docker-compose.yml`):

1. **`anvil`** — local L2 devnet on `:8545`, chainId `31337`, deterministic
   accounts from the standard Foundry test mnemonic. Has a healthcheck so
   dependents wait for the RPC.
2. **`deployer`** — one-shot. Waits for anvil, runs `Deploy.s.sol` (writes
   `deployments/31337.json`) then `Seed.s.sol` (announces + funds a CLAIMABLE
   TSLA dividend and writes `deployments/proofs-31337-1.json`), then exits.
   The repo is bind-mounted at `/work` so these artifacts land on your host.
3. **`frontend`** — the Next.js app on `:3000`, started only after the deployer
   completes successfully (`service_completed_successfully`).

Useful variants:

```bash
docker compose up anvil deployer   # just chain + seed (contract/CLI work)
docker compose down -v             # stop and drop volumes
make up                            # same as `docker compose up --build`
make down                          # same as `docker compose down -v`
```

### Required / optional env (local stack)

The defaults are wired for local anvil, so **no env is required** to run it.
Override via a root `.env` (never commit it — see `.env.example`):

| Var | Default (local) | Purpose |
|---|---|---|
| `PRIVATE_KEY` | anvil account #0 key | Deployer/issuer broadcaster. |
| `AUTO_ATTEST` | `true` | D3 action-source mode (open demo). Set `false` for prod-like attestation. |
| `ADMIN_ADDRESS` | deployer | Governance (multisig in prod). |
| `ISSUER_ADDRESS` | deployer | Per-asset issuer. |
| `USDG_ADDRESS` / `TSLA_ADDRESS` / `AMZN_ADDRESS` | unset → mocks | Real tokens; unset locally so `MockERC20`s are deployed. |
| `ALCHEMY_API_KEY` | unset | Server-only frontend key (optional). |

> **Dev-only, by design:** the anvil image and the deployer default to the
> well-known Foundry test mnemonic / account #0 key. These are public. **Never
> deploy this image or these keys to a public network.**

### Build images individually

The frontend is an npm **workspace** that imports the sibling `abis/` package,
so its build context **must be the repo root**:

```bash
docker build -f infra/anvil.Dockerfile    -t corporax/anvil    .
docker build -f infra/frontend.Dockerfile -t corporax/frontend .
```

> **Honest status:** `app/` and `tooling/snapshot/` are placeholder workspaces
> at the time of writing (no `package.json` yet). `infra/frontend.Dockerfile`
> and the `frontend`/CLI CI jobs are the forward-looking contract for when
> those land; until then the frontend build will be a no-op/skip and the CI
> jobs guard themselves (see §4). The `anvil` + `deployer` services work today.

---

## 3. Running without Docker (Make)

```bash
make install        # npm ci / npm install (JS workspaces)
make build          # forge build --sizes
make test           # forge test (ci profile)
make fmt            # forge fmt (in place);  make fmt-check for CI
make coverage       # forge coverage --report summary
make abi            # regenerate typed ABIs into /abis

# local chain + demo state (two terminals, or background anvil)
make anvil          # terminal 1: anvil chainId 31337 on :8545
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  make deploy-local # terminal 2: deploy to local
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  make seed-local   # then seed a CLAIMABLE dividend

make snapshot ARGS="--asset 0x.. --record-block 1234 --rate 0.5 --out ./out"
```

`make help` lists every target.

---

## 4. CI

GitHub Actions under `../.github/workflows/`:

| Workflow | Triggers on | Does |
|---|---|---|
| `contracts.yml` | `contracts/**` | `forge fmt --check`, `forge build --sizes`, `forge test -vvv`, `forge coverage --report summary` (ci profile). Caches `~/.svm` + build artifacts. |
| `frontend.yml` | `app/**`, `abis/**`, root manifests | `npm ci` → lint → typecheck → build for `@corporax/app`. **Self-guards** when `app/package.json` is absent. |
| `cli.yml` | `tooling/snapshot/**`, `abis/**` | typecheck + test for `@corporax/snapshot`. Self-guards when absent. |
| `slither.yml` | `contracts/**` | `crytic/slither-action` (advisory), uploads SARIF to code scanning. |
| `codeql.yml` | JS/TS paths + weekly | CodeQL `security-and-quality` for JavaScript/TypeScript. |

`dependabot.yml` opens weekly grouped PRs for **npm** and **github-actions**.
Foundry libs are vendored, so there is no `gitsubmodule` ecosystem — bump them
with `forge update` and re-run the contracts CI (documented in the file).

### Run CI checks locally

```bash
# Contracts (mirrors contracts.yml)
cd contracts
FOUNDRY_PROFILE=ci forge fmt --check
FOUNDRY_PROFILE=ci forge build --sizes
FOUNDRY_PROFILE=ci forge test -vvv
FOUNDRY_PROFILE=ci forge coverage --report summary

# Solidity lint / static analysis (need solhint + slither installed)
npx solhint 'contracts/src/**/*.sol'                       # uses contracts/.solhint.json + .solhintignore
cd contracts && slither . --config-file slither.config.json  # filters vendored OZ

# Frontend / CLI (once those workspaces exist)
npm ci
npm -w @corporax/app run lint && npm -w @corporax/app run typecheck && npm -w @corporax/app run build
npm -w @corporax/snapshot run typecheck && npm -w @corporax/snapshot run test
```

To dry-run the workflows themselves, use [`act`](https://github.com/nektos/act):

```bash
act -W .github/workflows/contracts.yml
```

(`act` needs Docker; Slither/CodeQL pull large images and may be skipped
locally.)

---

## 5. Security tooling

- **`contracts/.solhint.json`** — `solhint:recommended` plus protocol-aware
  tweaks (pin compiler `0.8.26`, enforce naming/visibility, `max-line-length`
  120 to match `forge fmt`). `not-rely-on-time` and `no-inline-assembly` are
  **off** intentionally: the protocol uses `block.timestamp` for
  `payableAt`/`claimDeadline` semantics, and the Merkle/OZ path uses assembly
  by design.
- **`.solhintignore`** (repo root) — excludes `contracts/lib/`, build output,
  and `src/mocks/`.
- **`contracts/slither.config.json`** — pins the Foundry framework and filters
  vendored OpenZeppelin / forge-std / tests / scripts / mocks so findings point
  at production sources.
- See **`../SECURITY.md`** for disclosure policy, scope, and the immutable /
  no-upgrade posture.
