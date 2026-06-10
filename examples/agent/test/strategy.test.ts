/**
 * Unit tests for the pure decision core, exercised with synthetic CAE-1
 * `ActionAnnounced` events — no live chain. This is the contract the rest of the
 * agent (the viem subscription, the CLI) is built around.
 */
import { describe, it, expect } from "vitest";
import { getAddress } from "viem";

import {
  decideOnAnnouncement,
  computeEligibleClaim,
  formatUnits,
} from "../src/strategy.js";
import { toAnnouncedEvent, parseHoldings, resolveConfig } from "../src/agent.js";
import { payForData } from "../src/x402.js";
import { ActionType, ONE, type ActionAnnouncedEvent, type Holdings } from "../src/types.js";

const TSLA = getAddress("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
const USDG = getAddress("0x5FbDB2315678afecb367f032d93F642f64180aa3");
const ZERO = "0x0000000000000000000000000000000000000000" as const;

function cashDividend(over: Partial<ActionAnnouncedEvent> = {}): ActionAnnouncedEvent {
  return {
    id: 1n,
    asset: TSLA,
    actionType: ActionType.CASH_DIVIDEND,
    ratePerShare: ONE / 2n, // 0.5
    recordBlock: 1234n,
    payableAt: 1781110880n,
    claimDeadline: 1781715680n,
    payoutToken: USDG,
    metadataURI: "ipfs://cash",
    ...over,
  };
}

describe("computeEligibleClaim", () => {
  it("matches the canonical leaf rule amount = units * rate / 1e18", () => {
    // 14 shares * 0.5 = 7.0
    expect(computeEligibleClaim(14n * ONE, ONE / 2n)).toBe(7n * ONE);
    // 10 shares * 0.5 = 5.0 (matches proofs-31337-1.json holder #1)
    expect(computeEligibleClaim(10n * ONE, ONE / 2n)).toBe(5n * ONE);
  });

  it("truncates (floor) like integer division", () => {
    // 1 share * 0.333... rate -> floored
    const rate = 333_333_333_333_333_333n;
    expect(computeEligibleClaim(ONE, rate)).toBe(rate);
  });
});

describe("decideOnAnnouncement — CASH_DIVIDEND", () => {
  it("held: flags ex-dividend and pre-computes the eligible claim", () => {
    const holdings: Holdings = { [TSLA.toLowerCase()]: 14n * ONE };
    const d = decideOnAnnouncement(cashDividend(), holdings);

    expect(d.kind).toBe("cash-dividend-flag-and-claim");
    expect(d.holds).toBe(true);
    expect(d.actionType).toBe("CASH_DIVIDEND");
    expect(d.eligibleClaim).toBe(7n * ONE);
    // rationale mentions the record block and the claim-on-behalf semantics.
    expect(d.rationale.join(" ")).toContain("1234");
    expect(d.rationale.join(" ")).toContain("claim-on-behalf");
    // next actions include the actual claim call shape.
    expect(d.nextActions.join(" ")).toContain("DividendDistributor.claim");
  });

  it("not held: watch only, no claim", () => {
    const d = decideOnAnnouncement(cashDividend(), {});
    expect(d.kind).toBe("cash-dividend-watch");
    expect(d.holds).toBe(false);
    expect(d.eligibleClaim).toBeUndefined();
  });

  it("is case-insensitive on the asset key", () => {
    // holdings keyed lowercase; event carries checksummed address.
    const holdings: Holdings = { [TSLA.toLowerCase()]: 2n * ONE };
    const d = decideOnAnnouncement(cashDividend({ asset: TSLA }), holdings);
    expect(d.holds).toBe(true);
    expect(d.eligibleClaim).toBe(ONE); // 2 * 0.5 = 1.0
  });
});

describe("decideOnAnnouncement — informational types", () => {
  it("STOCK_SPLIT: signals an oracle/collateral rescale", () => {
    const d = decideOnAnnouncement(
      cashDividend({
        id: 2n,
        actionType: ActionType.STOCK_SPLIT,
        ratePerShare: 0n,
        payoutToken: ZERO,
        metadataURI: "ipfs://4-for-1",
      }),
      {},
    );
    expect(d.kind).toBe("split-rescale");
    expect(d.eligibleClaim).toBeUndefined();
    expect(d.rationale.join(" ")).toContain("ipfs://4-for-1");
  });

  it("STOCK_DIVIDEND: signals a per-share rescale", () => {
    const d = decideOnAnnouncement(
      cashDividend({
        id: 3n,
        actionType: ActionType.STOCK_DIVIDEND,
        ratePerShare: 0n,
        payoutToken: ZERO,
      }),
      {},
    );
    expect(d.kind).toBe("stock-dividend-rescale");
  });

  it("unknown ActionType is ignored (CAE-1 forward-compat)", () => {
    const d = decideOnAnnouncement(
      cashDividend({ id: 9n, actionType: 7, ratePerShare: 0n }),
      {},
    );
    expect(d.kind).toBe("ignore-unknown");
    expect(d.actionType).toBe("UNKNOWN(7)");
    expect(d.nextActions).toHaveLength(0);
  });
});

describe("toAnnouncedEvent (log → typed event)", () => {
  it("widens uint64 fields to bigint and checksums addresses", () => {
    const event = toAnnouncedEvent({
      id: 1n,
      asset: TSLA.toLowerCase() as `0x${string}`,
      actionType: 0,
      ratePerShare: ONE / 2n,
      recordBlock: 1234n,
      payableAt: 1781110880n,
      claimDeadline: 1781715680n,
      payoutToken: USDG.toLowerCase() as `0x${string}`,
      metadataURI: "ipfs://x",
    });
    expect(event.asset).toBe(TSLA);
    expect(event.actionType).toBe(0);
    expect(typeof event.recordBlock).toBe("bigint");
  });

  it("throws on a missing required field", () => {
    expect(() => toAnnouncedEvent({ asset: TSLA })).toThrow(/missing field: id/);
  });
});

describe("config & holdings parsing", () => {
  it("parseHoldings normalises keys to lowercase and values to bigint", () => {
    const h = parseHoldings(JSON.stringify({ [TSLA]: "14000000000000000000" }));
    expect(h[TSLA.toLowerCase()]).toBe(14n * ONE);
  });

  it("parseHoldings handles empty/undefined", () => {
    expect(parseHoldings(undefined)).toEqual({});
  });

  it("resolveConfig falls back to a deployments file for the registry", () => {
    const cfg = resolveConfig(
      { RPC_URL: "http://localhost:8545" },
      { chainId: 31337, registry: TSLA, distributor: USDG },
    );
    expect(cfg.registry).toBe(TSLA);
    expect(cfg.chainId).toBe(31337);
    expect(cfg.rpcUrl).toBe("http://localhost:8545");
  });

  it("resolveConfig prefers env registry over the file", () => {
    const cfg = resolveConfig(
      { NEXT_PUBLIC_REGISTRY_ADDRESS: USDG, NEXT_PUBLIC_CHAIN_ID: "46630" },
      { chainId: 31337, registry: TSLA, distributor: TSLA },
    );
    expect(cfg.registry).toBe(USDG);
    expect(cfg.chainId).toBe(46630);
  });

  it("resolveConfig throws when no registry is available", () => {
    expect(() => resolveConfig({})).toThrow(/registry address/);
  });
});

describe("formatUnits", () => {
  it("renders 1e18-scaled bigints as decimal strings", () => {
    expect(formatUnits(7n * ONE)).toBe("7");
    expect(formatUnits(ONE / 2n)).toBe("0.5");
    expect(formatUnits(1_500_000_000_000_000_000n)).toBe("1.5");
  });
});

describe("x402 payForData (illustrative stub)", () => {
  it("returns a stubbed challenge/receipt/insight within budget", async () => {
    const r = await payForData({ url: "https://x", asset: TSLA, budget: 50_000n });
    expect(r.stubbed).toBe(true);
    expect(r.challenge.status).toBe(402);
    expect(r.receipt.amountPaid).toBe(r.challenge.maxAmountRequired);
    expect(r.insight.asset).toBe(TSLA);
  });

  it("declines to pay when the quote exceeds budget", async () => {
    await expect(
      payForData({ url: "https://x", asset: TSLA, budget: 1n }),
    ).rejects.toThrow(/exceeds budget/);
  });
});
