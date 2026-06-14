# ============================================================================
# Parvalon — developer task runner.
#
# Thin, discoverable wrappers over the real toolchain (forge / npm / docker
# compose). Run `make help` for the list. Targets assume Foundry + Node 20 +
# npm are installed (use Docker via `make up` if you'd rather not install them).
# ============================================================================

# Use bash with strict flags for recipe lines.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

ROOT      := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
CONTRACTS := $(ROOT)/contracts
RPC_URL   ?= http://127.0.0.1:8545

.DEFAULT_GOAL := help

# ---- Meta ------------------------------------------------------------------

.PHONY: help
help: ## Show this help.
	@echo "Parvalon make targets:"
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ---- Setup / build ---------------------------------------------------------

.PHONY: install
install: ## Install JS workspace deps (npm ci if a lockfile exists, else npm install).
	@if [ -f "$(ROOT)/package-lock.json" ]; then \
	  npm ci; \
	else \
	  npm install; \
	fi

.PHONY: build
build: ## Build contracts (forge) with deployed sizes.
	forge build --sizes --root $(CONTRACTS)

.PHONY: abi
abi: ## Regenerate typed ABIs into /abis (scripts/export-abi.sh).
	bash $(ROOT)/scripts/export-abi.sh

# ---- Quality ---------------------------------------------------------------

.PHONY: test
test: ## Run the Foundry test suite (ci profile: 1000 fuzz / 256 invariant).
	FOUNDRY_PROFILE=ci forge test -vvv --root $(CONTRACTS)

.PHONY: e2e
e2e: ## Live protocol E2E: anvil -> deploy -> seed -> claim -> CLI parity -> monitor (needs :8545 free).
	bash scripts/e2e.sh

.PHONY: fmt
fmt: ## Format Solidity in place (forge fmt). Use `make fmt-check` in CI.
	forge fmt --root $(CONTRACTS)

.PHONY: fmt-check
fmt-check: ## Verify Solidity formatting without writing (CI gate).
	forge fmt --check --root $(CONTRACTS)

.PHONY: coverage
coverage: ## Print a Foundry coverage summary.
	forge coverage --report summary --root $(CONTRACTS)

# ---- Local chain / deploy --------------------------------------------------

.PHONY: anvil
anvil: ## Start a local anvil devnet (chainId 31337) on :8545.
	anvil --chain-id 31337

.PHONY: deploy-local
deploy-local: ## Deploy the protocol to the local anvil (needs PRIVATE_KEY; anvil running).
	forge script script/Deploy.s.sol:Deploy --root $(CONTRACTS) --rpc-url $(RPC_URL) --broadcast

.PHONY: seed-local
seed-local: ## Announce + fund a demo CLAIMABLE dividend and write proofs.json.
	forge script script/Seed.s.sol:Seed --root $(CONTRACTS) --rpc-url $(RPC_URL) --broadcast

.PHONY: snapshot
snapshot: ## Run the off-chain Merkle snapshot CLI (@parvalon/snapshot). Pass args via ARGS=...
	npm -w @parvalon/snapshot run start -- $(ARGS)

# ---- Docker ----------------------------------------------------------------

.PHONY: up
up: ## Bring up the full local stack (anvil + deploy/seed + frontend) via Docker.
	docker compose up --build

.PHONY: down
down: ## Tear down the Docker stack and remove volumes.
	docker compose down -v
