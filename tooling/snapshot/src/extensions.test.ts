/**
 * End-to-end tests for the snapshot EXTENSIONS (P1-3 exclusions, P1-5
 * withholding) through `generateSnapshot`, plus the verify gate.
 *
 * Uses an injected `BalanceProvider` so the full pipeline runs offline. The
 * focus:
 *   - excluded addresses never appear in `claims` and totals are correct,
 *   - withholding net math (leaf = net), gross recorded, totalPayout = Σ net,
 *   - the extended artifacts still pass `verifyProofs` (root + totals + net math),
 *   - a plain run (no flags) stays backward-compatible (no new noisy fields).
 */
import { describe, it, expect } from "vitest";
import {
  generateSnapshot,
  serializeProofs,
  verifyProofs,
  deriveHolders,
  sumPayout,
  sumGross,
  netFromGross,
  type Address,
  type BalanceProvider,
  type SnapshotInput,
} from "./index.js";

const RATE = 1_000_000_000_000_000_000n; // 1.0 * 1e18 → amount == balance
const ASSET = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" as Address;
const PAYOUT = "0x5fbdb2315678afecb367f032d93f642f64180aa3" as Address;

const A = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
const B = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Address;
const C = "0x90f79bf6eb2c4f870365e785982e1f101e93b906" as Address;
// An "AMM pool" style contract we want excluded.
const POOL = "0x1111111111111111111111111111111111111111" as Address;

function fixtureProvider(balances: Map<Address, bigint>): BalanceProvider {
  return { balancesAt: async () => new Map(balances) };
}

function baseInput(over: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    rpcUrl: "http://unused",
    asset: ASSET,
    deployBlock: 0n,
    recordBlock: 100n,
    ratePerShare: RATE,
    actionId: 1n,
    chunkSize: 5000n,
    chainId: 31337,
    payoutToken: PAYOUT,
    ...over,
  };
}

const BALANCES = new Map<Address, bigint>([
  [A, 10n ** 18n],
  [B, 2n * 10n ** 18n],
  [C, 3n * 10n ** 18n],
  [POOL, 100n * 10n ** 18n], // big pool balance that must NOT accrue
]);

/* ------------------------------- exclusions ------------------------------- */

describe("exclusions (P1-3)", () => {
  it("excluded address is absent from claims and from the totals", async () => {
    const art = await generateSnapshot(
      baseInput({ exclude: [POOL] }),
      fixtureProvider(BALANCES),
    );

    // POOL is gone; the three real holders remain.
    expect(art.holderCount).toBe(3);
    expect(Object.keys(art.claims).sort()).toEqual([A, B, C].sort());
    expect(art.claims[POOL]).toBeUndefined();

    // totalPayout reflects only the eligible holders (1+2+3 = 6 e18), NOT the
    // 100 e18 pool balance.
    expect(BigInt(art.totalPayout)).toBe(6n * 10n ** 18n);

    // exclusions block recorded for auditability.
    expect(art.exclusions).toBeDefined();
    expect(art.exclusions!.addresses).toEqual([POOL]);
    expect(art.exclusions!.applied).toEqual([POOL]); // it was a real holder
  });

  it("indices are reassigned over the eligible set (POOL absent)", async () => {
    const art = await generateSnapshot(
      baseInput({ exclude: [POOL] }),
      fixtureProvider(BALANCES),
    );
    const idxs = Object.values(art.claims)
      .map((c) => c.index)
      .sort((a, b) => a - b);
    expect(idxs).toEqual([0, 1, 2]); // dense 0..n-1, no gap from the dropped pool
  });

  it("excluded artifact still passes the verify gate", async () => {
    const art = await generateSnapshot(
      baseInput({ exclude: [POOL] }),
      fixtureProvider(BALANCES),
    );
    const res = verifyProofs(art);
    expect(res.issues).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("matches a snapshot taken over the pre-filtered balance map", async () => {
    // Exclusion BEFORE indexing must equal simply not having the pool at all.
    const withoutPool = new Map(BALANCES);
    withoutPool.delete(POOL);

    const excluded = await generateSnapshot(
      baseInput({ exclude: [POOL] }),
      fixtureProvider(BALANCES),
    );
    const prefiltered = await generateSnapshot(
      baseInput(),
      fixtureProvider(withoutPool),
    );

    // Same eligible set ⇒ same root and same per-holder claims.
    expect(excluded.merkleRoot).toBe(prefiltered.merkleRoot);
    expect(excluded.totalPayout).toBe(prefiltered.totalPayout);
  });
});

/* ------------------------------ withholding ------------------------------- */

describe("withholding (P1-5)", () => {
  const BPS = 1500; // 15%

  it("leaf amount is NET, grossAmount is recorded, totalPayout = Σ net", async () => {
    const art = await generateSnapshot(
      baseInput({ withholdingBps: BPS }),
      fixtureProvider(BALANCES),
    );

    // Action-level fields present.
    expect(art.withholdingBps).toBe(BPS);
    expect(art.totalGross).toBeDefined();

    let netSum = 0n;
    let grossSum = 0n;
    for (const [, claim] of Object.entries(art.claims)) {
      const net = BigInt(claim.amount);
      expect(claim.grossAmount).toBeDefined();
      const gross = BigInt(claim.grossAmount!);
      // leaf (net) == gross * (10000-bps)/10000
      expect(net).toBe(netFromGross(gross, BPS));
      // and net < gross for a positive holder at 15%
      expect(net < gross).toBe(true);
      netSum += net;
      grossSum += gross;
    }

    // totalPayout (the funding target) is the NET sum.
    expect(BigInt(art.totalPayout)).toBe(netSum);
    // totalGross is the GROSS sum.
    expect(BigInt(art.totalGross!)).toBe(grossSum);
    // sanity: gross here is each balance * rate(1.0) → 1+2+3+100 e18, but POOL
    // is NOT excluded in this test, so gross = 106 e18.
    expect(grossSum).toBe(106n * 10n ** 18n);
  });

  it("withholdingBps=0 yields net == gross for every holder", async () => {
    const art = await generateSnapshot(
      baseInput({ withholdingBps: 0 }),
      fixtureProvider(BALANCES),
    );
    expect(art.withholdingBps).toBe(0);
    for (const [, claim] of Object.entries(art.claims)) {
      expect(claim.amount).toBe(claim.grossAmount);
    }
    expect(art.totalPayout).toBe(art.totalGross);
  });

  it("withheld artifact passes the verify gate (net math is re-checked)", async () => {
    const art = await generateSnapshot(
      baseInput({ withholdingBps: BPS }),
      fixtureProvider(BALANCES),
    );
    const res = verifyProofs(art);
    expect(res.issues).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("verify FAILS when a net amount is inconsistent with its gross", async () => {
    const art = await generateSnapshot(
      baseInput({ withholdingBps: BPS }),
      fixtureProvider(BALANCES),
    );
    // Tamper: bump one net amount so it no longer equals net(gross,bps).
    const [addr, claim] = Object.entries(art.claims)[0]!;
    const tampered = {
      ...art,
      claims: {
        ...art.claims,
        [addr]: { ...claim, amount: (BigInt(claim.amount) + 1n).toString() },
      },
    };
    const res = verifyProofs(tampered);
    expect(res.ok).toBe(false);
    // The proof breaks AND the withholding cross-check fires.
    expect(res.issues.some((i) => i.kind === "withholding")).toBe(true);
  });

  it("deriveHolders math: sumPayout == Σ net, sumGross == Σ gross", () => {
    const holders = deriveHolders(BALANCES, RATE, BPS);
    const net = sumPayout(holders);
    const gross = sumGross(holders);
    expect(net).toBe(holders.reduce((a, h) => a + netFromGross(h.grossAmount, BPS), 0n));
    expect(gross).toBe(holders.reduce((a, h) => a + h.grossAmount, 0n));
    expect(net < gross).toBe(true);
  });
});

/* -------------------- exclusion + withholding combined -------------------- */

describe("exclusions + withholding together", () => {
  it("pool excluded AND remaining holders withheld; totals consistent", async () => {
    const BPS = 2500; // 25%
    const art = await generateSnapshot(
      baseInput({ exclude: [POOL], withholdingBps: BPS }),
      fixtureProvider(BALANCES),
    );
    expect(art.holderCount).toBe(3);
    expect(art.claims[POOL]).toBeUndefined();

    // gross = (1+2+3) e18 = 6e18; net = 6e18 * 0.75 = 4.5e18
    expect(BigInt(art.totalGross!)).toBe(6n * 10n ** 18n);
    expect(BigInt(art.totalPayout)).toBe(netFromGross(6n * 10n ** 18n, BPS));

    expect(verifyProofs(art).ok).toBe(true);
  });
});

/* ----------------------- backward compatibility --------------------------- */

describe("backward compatibility (no extension flags)", () => {
  it("a plain run omits exclusion/withholding/metadata/cid fields", async () => {
    const art = await generateSnapshot(baseInput(), fixtureProvider(BALANCES));
    expect(art.format).toBe("corporax-merkle-v1");
    // None of the additive fields appear when not requested...
    expect(art.exclusions).toBeUndefined();
    expect(art.withholdingBps).toBeUndefined();
    expect(art.totalGross).toBeUndefined();
    expect(art.metadata).toBeUndefined();
    expect(art.proofsCid).toBeUndefined();
    // ...and claims carry no grossAmount.
    for (const [, claim] of Object.entries(art.claims)) {
      expect(claim.grossAmount).toBeUndefined();
    }
    // schemaMinor marker is present but informational.
    expect(typeof art.schemaMinor).toBe("number");
    // Still a valid, self-verifying artifact.
    expect(verifyProofs(art).ok).toBe(true);
    // And still deterministic.
    const again = await generateSnapshot(baseInput(), fixtureProvider(BALANCES));
    expect(serializeProofs(again)).toBe(serializeProofs(art));
  });
});
