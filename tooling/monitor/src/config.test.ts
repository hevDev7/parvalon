/**
 * Config resolution tests: flag/env precedence, deployments-file address
 * lookup, threshold overrides, and validation errors. No chain, no I/O beyond
 * reading the repo's committed deployments/31337.json.
 */
import { describe, it, expect } from "vitest";

import { resolveConfig, resolveThresholds } from "./config.js";
import { DEFAULT_THRESHOLDS } from "./types.js";

const REGISTRY = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
const DISTRIBUTOR = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";

describe("resolveConfig", () => {
  it("throws without an RPC URL", () => {
    expect(() => resolveConfig({}, {})).toThrow(/RPC URL/);
  });

  it("resolves explicit flags over everything else", () => {
    const cfg = resolveConfig(
      {
        rpcUrl: "http://flag",
        chainId: 31337,
        registry: REGISTRY,
        distributor: DISTRIBUTOR,
        pollIntervalMs: 1234,
      },
      { RPC_URL: "http://env", POLL_INTERVAL_MS: "9999" },
    );
    expect(cfg.rpcUrl).toBe("http://flag");
    expect(cfg.pollIntervalMs).toBe(1234);
    expect(cfg.registry).toBe(REGISTRY.toLowerCase());
    expect(cfg.distributor).toBe(DISTRIBUTOR.toLowerCase());
  });

  it("reads addresses from env when no flags given", () => {
    const cfg = resolveConfig(
      {},
      {
        RPC_URL: "http://env",
        CHAIN_ID: "31337",
        REGISTRY_ADDRESS: REGISTRY,
        DISTRIBUTOR_ADDRESS: DISTRIBUTOR,
      },
    );
    expect(cfg.registry).toBe(REGISTRY.toLowerCase());
    expect(cfg.chainId).toBe(31337);
  });

  it("falls back to deployments/<chainId>.json for addresses", () => {
    // The repo ships deployments/31337.json; only RPC + chain id are supplied.
    const cfg = resolveConfig({}, { RPC_URL: "http://env", CHAIN_ID: "31337" });
    expect(cfg.registry).toBe(REGISTRY.toLowerCase());
    expect(cfg.distributor).toBe(DISTRIBUTOR.toLowerCase());
    expect(cfg.chainId).toBe(31337);
  });

  it("enables the webhook sink when ALERT_WEBHOOK_URL is set", () => {
    const cfg = resolveConfig(
      {},
      {
        RPC_URL: "http://env",
        CHAIN_ID: "31337",
        ALERT_WEBHOOK_URL: "https://hook.example/x",
      },
    );
    expect(cfg.webhookUrl).toBe("https://hook.example/x");
  });

  it("parses EXPECTED_FUNDERS into a lowercase address list", () => {
    const cfg = resolveConfig(
      {},
      {
        RPC_URL: "http://env",
        CHAIN_ID: "31337",
        EXPECTED_FUNDERS: `${REGISTRY}, ${DISTRIBUTOR}`,
      },
    );
    expect(cfg.expectedFunders).toEqual([REGISTRY.toLowerCase(), DISTRIBUTOR.toLowerCase()]);
  });

  it("rejects an invalid address", () => {
    expect(() =>
      resolveConfig({ registry: "0xnope" }, { RPC_URL: "http://env", CHAIN_ID: "1" }),
    ).toThrow(/valid address/);
  });
});

describe("resolveThresholds", () => {
  it("uses defaults when no env overrides", () => {
    expect(resolveThresholds({})).toEqual(DEFAULT_THRESHOLDS);
  });

  it("applies env overrides", () => {
    const t = resolveThresholds({
      MAX_RATE_PER_SHARE: "5",
      LARGE_FUNDING_RATIO: "0.8",
      MAX_CLAIM_REVERT_RATE: "0.1",
    });
    expect(t.maxRatePerShare).toBe(5n);
    expect(t.largeFundingRatio).toBe(0.8);
    expect(t.maxClaimRevertRate).toBe(0.1);
    // Untouched fields keep defaults.
    expect(t.maxTotalPayout).toBe(DEFAULT_THRESHOLDS.maxTotalPayout);
  });
});
