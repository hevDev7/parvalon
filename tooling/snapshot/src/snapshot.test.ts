/**
 * Snapshot pipeline + determinism tests.
 *
 * Uses an injected `BalanceProvider` (no RPC) so the whole snapshot path —
 * fold → filter → sort → amount → tree → artifact — is exercised offline.
 *
 * The headline guarantee: the SAME input run twice yields an IDENTICAL
 * merkleRoot and a byte-identical serialised artifact. Determinism is a core
 * selling point ("anyone can re-run and verify this root").
 */
import { describe, it, expect } from "vitest";
import {
  foldTransfers,
  deriveHolders,
  sumPayout,
  generateSnapshot,
  serializeProofs,
  verifyProofs,
  type Address,
  type BalanceProvider,
  type SnapshotInput,
} from "./index.js";

const RATE = 500_000_000_000_000_000n; // 0.5 * 1e18
const ASSET = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" as Address;
const PAYOUT = "0x5fbdb2315678afecb367f032d93f642f64180aa3" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

const A = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
const B = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Address;
const C = "0x90f79bf6eb2c4f870365e785982e1f101e93b906" as Address;

/** Fixed-balance provider for deterministic, network-free tests. */
function fixtureProvider(balances: Map<Address, bigint>): BalanceProvider {
  return { balancesAt: async () => new Map(balances) };
}

function baseInput(): SnapshotInput {
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
  };
}

describe("foldTransfers", () => {
  it("credits to, debits from, and skips the zero address", () => {
    // mint 10 to A, A->B 4, mint 6 to C, B->0 (burn) 1
    const balances = foldTransfers([
      { from: ZERO, to: A, value: 10n },
      { from: A, to: B, value: 4n },
      { from: ZERO, to: C, value: 6n },
      { from: B, to: ZERO, value: 1n },
    ]);
    expect(balances.get(A)).toBe(6n);
    expect(balances.get(B)).toBe(3n);
    expect(balances.get(C)).toBe(6n);
    expect(balances.has(ZERO)).toBe(false);
  });
});

describe("deriveHolders", () => {
  it("drops zero/negative-net balances, sorts by address asc, assigns indices", () => {
    const balances = new Map<Address, bigint>([
      [C, 3n],
      [A, 10n],
      [B, 0n], // filtered out
    ]);
    const holders = deriveHolders(balances, RATE);
    // B had a zero net balance → excluded; A and C remain.
    expect(holders).toHaveLength(2);
    expect(new Set(holders.map((h) => h.account))).toEqual(new Set([A, C]));
    // Sorted strictly ascending by numeric address value.
    const asNums = holders.map((h) => BigInt(h.account));
    for (let i = 1; i < asNums.length; i++) {
      expect(asNums[i]! > asNums[i - 1]!).toBe(true);
    }
    holders.forEach((h, i) => expect(h.index).toBe(i));
    // amount = balance * rate / 1e18
    const a = holders.find((h) => h.account === A)!;
    expect(a.amount).toBe((10n * RATE) / 10n ** 18n);
  });
});

describe("generateSnapshot", () => {
  const balances = new Map<Address, bigint>([
    [A, 10_000_000_000_000_000_000n],
    [B, 14_000_000_000_000_000_000n],
    [C, 0n], // excluded
  ]);

  it("produces a valid corporax-merkle-v1 artifact", async () => {
    const artifact = await generateSnapshot(baseInput(), fixtureProvider(balances));
    expect(artifact.format).toBe("corporax-merkle-v1");
    expect(artifact.chainId).toBe(31337);
    expect(artifact.asset).toBe(ASSET);
    expect(artifact.payoutToken).toBe(PAYOUT);
    expect(artifact.holderCount).toBe(2);
    expect(artifact.leafEncoding).toEqual([
      "uint256 actionId",
      "uint256 index",
      "address account",
      "uint256 amount",
    ]);
    // claims keyed by lowercase address
    expect(Object.keys(artifact.claims)).toEqual(
      Object.keys(artifact.claims).map((k) => k.toLowerCase()),
    );
    // totalPayout == Σ amount
    const sum = Object.values(artifact.claims).reduce(
      (acc, c) => acc + BigInt(c.amount),
      0n,
    );
    expect(BigInt(artifact.totalPayout)).toBe(sum);
  });

  it("the artifact self-verifies through the verify gate", async () => {
    const artifact = await generateSnapshot(baseInput(), fixtureProvider(balances));
    const result = verifyProofs(artifact);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("totalPayout equals Σ(balance * rate / 1e18)", async () => {
    const artifact = await generateSnapshot(baseInput(), fixtureProvider(balances));
    const expected = sumPayout(deriveHolders(balances, RATE));
    expect(BigInt(artifact.totalPayout)).toBe(expected);
  });

  it("throws when no holder has a positive balance", async () => {
    const empty = new Map<Address, bigint>([[A, 0n]]);
    await expect(generateSnapshot(baseInput(), fixtureProvider(empty))).rejects.toThrow(
      /no eligible holders/i,
    );
  });
});

describe("determinism (core selling point)", () => {
  it("same input twice => identical root and byte-identical artifact", async () => {
    const balances = new Map<Address, bigint>([
      [A, 10_000_000_000_000_000_000n],
      [B, 14_000_000_000_000_000_000n],
      [C, 3_000_000_000_000_000_000n],
    ]);
    const run1 = await generateSnapshot(baseInput(), fixtureProvider(balances));
    const run2 = await generateSnapshot(baseInput(), fixtureProvider(balances));

    expect(run2.merkleRoot).toBe(run1.merkleRoot);
    expect(serializeProofs(run2)).toBe(serializeProofs(run1));
  });

  it("input balance map ORDER does not affect the root", async () => {
    const ordered = new Map<Address, bigint>([
      [A, 10n ** 18n],
      [B, 2n * 10n ** 18n],
      [C, 3n * 10n ** 18n],
    ]);
    const shuffled = new Map<Address, bigint>([
      [C, 3n * 10n ** 18n],
      [A, 10n ** 18n],
      [B, 2n * 10n ** 18n],
    ]);
    const r1 = await generateSnapshot(baseInput(), fixtureProvider(ordered));
    const r2 = await generateSnapshot(baseInput(), fixtureProvider(shuffled));
    expect(r2.merkleRoot).toBe(r1.merkleRoot);
    expect(serializeProofs(r2)).toBe(serializeProofs(r1));
  });

  it("scales to a large holder set without losing determinism", async () => {
    const big = new Map<Address, bigint>();
    for (let i = 1; i <= 500; i++) {
      const addr = ("0x" + i.toString(16).padStart(40, "0")) as Address;
      big.set(addr, BigInt(i) * 10n ** 16n);
    }
    const r1 = await generateSnapshot(baseInput(), fixtureProvider(big));
    const r2 = await generateSnapshot(baseInput(), fixtureProvider(big));
    expect(r1.holderCount).toBe(500);
    expect(r2.merkleRoot).toBe(r1.merkleRoot);
    expect(verifyProofs(r1).ok).toBe(true);
  });
});
