# ============================================================================
# infra/anvil.Dockerfile — local CorporaX devnet (anvil) + Foundry toolchain.
#
# Produces an image that:
#   - runs an anvil node on 0.0.0.0:8545 with a deterministic mnemonic
#     (chainId 31337 — the local dev chain per docs/INTEGRATION.md §8), and
#   - carries `forge`/`cast` so the same image backs the one-shot "deployer"
#     service in docker-compose.yml (which runs Deploy.s.sol + Seed.s.sol).
#
# This is a DEV/DEMO image. It seeds well-known anvil keys with funds — never
# expose it on a public network.
#
# Build:  docker build -f infra/anvil.Dockerfile -t corporax/anvil .
# Run:    docker run --rm -p 8545:8545 corporax/anvil
# ============================================================================

# Pinned Foundry release image. ghcr.io/foundry-rs/foundry ships anvil + forge.
FROM ghcr.io/foundry-rs/foundry:stable

# Run as the non-root user the base image provides.
USER foundry
WORKDIR /work

# Default anvil parameters. Override with `command:`/`environment:` in compose.
#   - 31337 is the canonical local chainId.
#   - The default Foundry test mnemonic yields the well-known accounts the deploy
#     and seed scripts assume (account #0 = admin/issuer; #1,#2 = demo holders).
ENV ANVIL_HOST=0.0.0.0 \
    ANVIL_PORT=8545 \
    ANVIL_CHAIN_ID=31337 \
    ANVIL_BLOCK_TIME=0 \
    ANVIL_MNEMONIC="test test test test test test test test test test test junk"

EXPOSE 8545

# `--block-time 0` keeps instant mining (mine on demand). Set ANVIL_BLOCK_TIME
# to e.g. 2 for a steady block cadence if a test needs elapsed time.
# Use the JSON exec form with a shell so env vars expand.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["anvil --host \"$ANVIL_HOST\" --port \"$ANVIL_PORT\" --chain-id \"$ANVIL_CHAIN_ID\" --mnemonic \"$ANVIL_MNEMONIC\" --block-time \"$ANVIL_BLOCK_TIME\""]
