/**
 * Unit tests for the pure monitoring checks (no chain required).
 *
 * The headline is the solvency invariant (PRODUCTION-READINESS.md §4): a state
 * where the distributor's balance is below Σ(funded − claimed) for active
 * actions must produce a `page`; a plausible state must produce none.
 */
import { describe, it, expect } from "vitest";

import {
  type ActionAccounting,
  type TokenBalance,
  checkSolvency,
  checkStatusChanged,
  checkAnnounced,
  checkRootPublished,
  checkFunded,
  checkSwept,
  checkPauseChange,
  ClaimHealthTracker,
} from "./checks.js";
import { type Address, ActionStatus, DEFAULT_THRESHOLDS } from "./types.js";

const USDG = "0x5fbdb2315678afecb367f032d93f642f64180aa3" as Address;
const TSLA = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" as Address;
const ISSUER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Address;
const STRANGER = "0x0000000000000000000000000000000000009999" as Address;
const TX = "0xabc0000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;

const ONE = 10n ** 18n;

/* ----------------------------- solvency ------------------------------ */

describe("checkSolvency — the P0-6 invariant", () => {
  it("plausible state (balance == Σ funded−claimed) → no alert, solvent", () => {
    const actions: ActionAccounting[] = [
      { id: 1n, status: ActionStatus.CLAIMABLE, payoutToken: USDG, funded: 12n * ONE, claimed: 5n * ONE },
      { id: 2n, status: ActionStatus.ROOT_PUBLISHED, payoutToken: USDG, funded: 3n * ONE, claimed: 0n },
    ];
    // obligation = (12-5) + (3-0) = 10 USDG; balance exactly matches.
    const balances: TokenBalance[] = [{ token: USDG, balance: 10n * ONE }];

    const { results, alerts } = checkSolvency(actions, balances);
    expect(alerts).toHaveLength(0);
    const usdg = results.find((r) => r.token === USDG)!;
    expect(usdg.obligation).toBe(10n * ONE);
    expect(usdg.balance).toBe(10n * ONE);
    expect(usdg.surplus).toBe(0n);
    expect(usdg.solvent).toBe(true);
  });

  it("balance ABOVE obligation (dust/surplus) → still solvent, no alert", () => {
    const actions: ActionAccounting[] = [
      { id: 1n, status: ActionStatus.CLAIMABLE, payoutToken: USDG, funded: 12n * ONE, claimed: 5n * ONE },
    ];
    const balances: TokenBalance[] = [{ token: USDG, balance: 7n * ONE + 1n }];

    const { results, alerts } = checkSolvency(actions, balances);
    expect(alerts).toHaveLength(0);
    expect(results[0]!.surplus).toBe(1n);
    expect(results[0]!.solvent).toBe(true);
  });

  it("balance BELOW obligation → exactly one `page` alert with the shortfall", () => {
    const actions: ActionAccounting[] = [
      { id: 1n, status: ActionStatus.CLAIMABLE, payoutToken: USDG, funded: 12n * ONE, claimed: 5n * ONE },
    ];
    // obligation 7 USDG, but only 6 on hand → insolvent by 1 USDG.
    const balances: TokenBalance[] = [{ token: USDG, balance: 6n * ONE }];

    const { results, alerts } = checkSolvency(actions, balances);
    expect(alerts).toHaveLength(1);
    const a = alerts[0]!;
    expect(a.severity).toBe("page");
    expect(a.code).toBe("solvency_drift");
    expect(a.key).toBe(`solvency:${USDG}`);
    expect(a.details.shortfall).toBe(1n * ONE);
    expect(results[0]!.solvent).toBe(false);
  });

  it("FINALIZED / CANCELLED actions are excluded from the obligation", () => {
    const actions: ActionAccounting[] = [
      // Active, owes 7.
      { id: 1n, status: ActionStatus.CLAIMABLE, payoutToken: USDG, funded: 12n * ONE, claimed: 5n * ONE },
      // Finalized (swept) — remainder already left the contract; must NOT count.
      { id: 2n, status: ActionStatus.FINALIZED, payoutToken: USDG, funded: 100n * ONE, claimed: 10n * ONE },
      // Cancelled — never funded toward an obligation.
      { id: 3n, status: ActionStatus.CANCELLED, payoutToken: USDG, funded: 0n, claimed: 0n },
    ];
    const balances: TokenBalance[] = [{ token: USDG, balance: 7n * ONE }];

    const { results, alerts } = checkSolvency(actions, balances);
    expect(alerts).toHaveLength(0); // obligation is only the active 7, fully backed.
    expect(results[0]!.obligation).toBe(7n * ONE);
  });

  it("multi-token: insolvency in one token does not implicate the other", () => {
    const actions: ActionAccounting[] = [
      { id: 1n, status: ActionStatus.CLAIMABLE, payoutToken: USDG, funded: 10n * ONE, claimed: 0n },
      { id: 2n, status: ActionStatus.CLAIMABLE, payoutToken: TSLA, funded: 4n * ONE, claimed: 0n },
    ];
    const balances: TokenBalance[] = [
      { token: USDG, balance: 10n * ONE }, // solvent
      { token: TSLA, balance: 1n * ONE }, // short by 3
    ];

    const { results, alerts } = checkSolvency(actions, balances);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.details.token).toBe(TSLA);
    const usdg = results.find((r) => r.token === USDG)!;
    expect(usdg.solvent).toBe(true);
  });

  it("token tracked with zero obligation and zero balance is solvent", () => {
    const { alerts } = checkSolvency([], [{ token: USDG, balance: 0n }]);
    expect(alerts).toHaveLength(0);
  });
});

/* ------------------------- status transitions ------------------------ */

describe("checkStatusChanged", () => {
  it("legal transition (ANNOUNCED→ROOT_PUBLISHED) → info", () => {
    const a = checkStatusChanged({
      id: 1n,
      previousStatus: ActionStatus.ANNOUNCED,
      newStatus: ActionStatus.ROOT_PUBLISHED,
      txHash: TX,
    });
    expect(a).toHaveLength(1);
    expect(a[0]!.severity).toBe("info");
    expect(a[0]!.code).toBe("status_changed");
  });

  it("illegal transition (CLAIMABLE→ANNOUNCED) → notify", () => {
    const a = checkStatusChanged({
      id: 1n,
      previousStatus: ActionStatus.CLAIMABLE,
      newStatus: ActionStatus.ANNOUNCED,
      txHash: TX,
    });
    expect(a[0]!.severity).toBe("notify");
    expect(a[0]!.code).toBe("illegal_status_transition");
  });
});

/* --------------------------- announcements --------------------------- */

describe("checkAnnounced", () => {
  it("plausible rate → info only", () => {
    const a = checkAnnounced(
      { id: 1n, asset: TSLA, actionType: 0, ratePerShare: ONE / 2n, payoutToken: USDG, txHash: TX },
      DEFAULT_THRESHOLDS,
    );
    expect(a).toHaveLength(1);
    expect(a[0]!.severity).toBe("info");
  });

  it("implausible rate → notify", () => {
    const a = checkAnnounced(
      {
        id: 1n,
        asset: TSLA,
        actionType: 0,
        ratePerShare: DEFAULT_THRESHOLDS.maxRatePerShare + 1n,
        payoutToken: USDG,
        txHash: TX,
      },
      DEFAULT_THRESHOLDS,
    );
    expect(a.some((x) => x.code === "implausible_rate" && x.severity === "notify")).toBe(true);
  });

  it("unknown asset (allowlist set) → notify", () => {
    const a = checkAnnounced(
      { id: 1n, asset: STRANGER, actionType: 0, ratePerShare: ONE, payoutToken: USDG, txHash: TX },
      DEFAULT_THRESHOLDS,
      [TSLA], // allowlist excludes STRANGER
    );
    expect(a.some((x) => x.code === "unknown_asset")).toBe(true);
  });
});

describe("checkRootPublished", () => {
  it("zero holders → notify", () => {
    const a = checkRootPublished(
      { id: 1n, root: TX, totalPayout: ONE, holderCount: 0n, txHash: TX },
      DEFAULT_THRESHOLDS,
    );
    expect(a.some((x) => x.code === "zero_holder_root")).toBe(true);
  });

  it("implausible totalPayout → notify", () => {
    const a = checkRootPublished(
      { id: 1n, root: TX, totalPayout: DEFAULT_THRESHOLDS.maxTotalPayout + 1n, holderCount: 2n, txHash: TX },
      DEFAULT_THRESHOLDS,
    );
    expect(a.some((x) => x.code === "implausible_total_payout")).toBe(true);
  });

  it("normal root → info", () => {
    const a = checkRootPublished(
      { id: 1n, root: TX, totalPayout: 12n * ONE, holderCount: 2n, txHash: TX },
      DEFAULT_THRESHOLDS,
    );
    expect(a).toHaveLength(1);
    expect(a[0]!.severity).toBe("info");
  });
});

/* ----------------------------- funding ------------------------------- */

describe("checkFunded", () => {
  it("normal funding from expected issuer → info", () => {
    const a = checkFunded(
      { id: 1n, from: ISSUER, amount: 3n * ONE, totalFunded: 3n * ONE, txHash: TX },
      DEFAULT_THRESHOLDS,
      { totalPayout: 12n * ONE, expectedFunders: [ISSUER] },
    );
    expect(a).toHaveLength(1);
    expect(a[0]!.severity).toBe("info");
  });

  it("unexpected funder → notify", () => {
    const a = checkFunded(
      { id: 1n, from: STRANGER, amount: ONE, totalFunded: ONE, txHash: TX },
      DEFAULT_THRESHOLDS,
      { expectedFunders: [ISSUER] },
    );
    expect(a.some((x) => x.code === "unexpected_funder" && x.severity === "notify")).toBe(true);
  });

  it("over-large single fund (>= ratio of totalPayout) → notify", () => {
    const a = checkFunded(
      { id: 1n, from: ISSUER, amount: 12n * ONE, totalFunded: 12n * ONE, txHash: TX },
      { ...DEFAULT_THRESHOLDS, largeFundingRatio: 0.5 },
      { totalPayout: 12n * ONE, expectedFunders: [ISSUER] },
    );
    expect(a.some((x) => x.code === "large_funding")).toBe(true);
  });

  it("duplicate funding event (same id+tx) → notify, and only on the second sighting", () => {
    const seen = new Set<string>();
    const ev = { id: 1n, from: ISSUER, amount: ONE, totalFunded: ONE, txHash: TX } as const;
    const first = checkFunded(ev, DEFAULT_THRESHOLDS, { seenTxes: seen });
    expect(first.some((x) => x.code === "duplicate_funding")).toBe(false);
    const second = checkFunded(ev, DEFAULT_THRESHOLDS, { seenTxes: seen });
    expect(second.some((x) => x.code === "duplicate_funding")).toBe(true);
  });
});

/* ------------------------------ sweeps ------------------------------- */

describe("checkSwept", () => {
  it("small remainder → info", () => {
    const a = checkSwept(
      { id: 1n, to: ISSUER, amount: ONE, txHash: TX },
      DEFAULT_THRESHOLDS,
      { totalFunded: 100n * ONE },
    );
    expect(a).toHaveLength(1);
    expect(a[0]!.severity).toBe("info");
  });

  it("large unclaimed remainder (>= ratio of funded) → notify", () => {
    const a = checkSwept(
      { id: 1n, to: ISSUER, amount: 80n * ONE, txHash: TX },
      DEFAULT_THRESHOLDS, // default ratio 0.5
      { totalFunded: 100n * ONE },
    );
    expect(a.some((x) => x.code === "large_sweep_remainder" && x.severity === "notify")).toBe(true);
  });

  it("early sweep (when window enabled) → notify", () => {
    const a = checkSwept(
      { id: 1n, to: ISSUER, amount: ONE, txHash: TX },
      { ...DEFAULT_THRESHOLDS, earlySweepWindowSecs: 3600 },
      { totalFunded: 100n * ONE, deadline: 10_000, nowSecs: 1_000 }, // 9000s before deadline
    );
    expect(a.some((x) => x.code === "early_sweep")).toBe(true);
  });
});

/* ------------------------------ pause -------------------------------- */

describe("checkPauseChange", () => {
  it("no previous value → no alert (first read)", () => {
    expect(checkPauseChange("registry", undefined, false)).toHaveLength(0);
  });
  it("unchanged → no alert", () => {
    expect(checkPauseChange("registry", false, false)).toHaveLength(0);
  });
  it("false→true (paused) → notify", () => {
    const a = checkPauseChange("distributor", false, true);
    expect(a[0]!.severity).toBe("notify");
    expect(a[0]!.title).toContain("PAUSED");
  });
  it("true→false (unpaused) → notify", () => {
    const a = checkPauseChange("distributor", true, false);
    expect(a[0]!.title).toContain("UNPAUSED");
  });
});

/* -------------------------- claim health ----------------------------- */

describe("ClaimHealthTracker", () => {
  it("no alert below the minimum attempt count", () => {
    const t = new ClaimHealthTracker({ ...DEFAULT_THRESHOLDS, minClaimAttemptsForRate: 8 });
    for (let i = 0; i < 4; i++) t.recordRevert();
    expect(t.evaluate()).toHaveLength(0);
  });

  it("revert-rate spike above threshold → one notify per window", () => {
    const t = new ClaimHealthTracker({
      ...DEFAULT_THRESHOLDS,
      minClaimAttemptsForRate: 8,
      maxClaimRevertRate: 0.25,
    });
    // 8 attempts, 4 reverts = 50% > 25%.
    for (let i = 0; i < 4; i++) t.recordSuccess();
    for (let i = 0; i < 4; i++) t.recordRevert();
    expect(t.revertRate).toBeCloseTo(0.5, 5);
    const first = t.evaluate();
    expect(first).toHaveLength(1);
    expect(first[0]!.code).toBe("claim_revert_spike");
    // De-dup within the same window.
    expect(t.evaluate()).toHaveLength(0);
    // Reset starts a fresh window.
    t.reset();
    expect(t.revertRate).toBe(0);
  });

  it("healthy claim rate → no alert", () => {
    const t = new ClaimHealthTracker({ ...DEFAULT_THRESHOLDS, minClaimAttemptsForRate: 8, maxClaimRevertRate: 0.25 });
    for (let i = 0; i < 19; i++) t.recordSuccess();
    t.recordRevert(); // 1/20 = 5%
    expect(t.evaluate()).toHaveLength(0);
  });
});
