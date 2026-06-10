/**
 * Unit tests for the pure eligibility transforms: exclusions (P1-3) and
 * withholding math (P1-5). No RPC, no tree — just BigInt/set logic.
 */
import { describe, it, expect } from "vitest";
import {
  applyExclusions,
  normalizeExclusions,
  netFromGross,
  assertBps,
  type Address,
} from "./index.js";

const A = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;
const B = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Address;
const C = "0x90f79bf6eb2c4f870365e785982e1f101e93b906" as Address;

describe("normalizeExclusions", () => {
  it("lowercases, de-dupes, and sorts ascending", () => {
    const mixed = [
      C,
      A.toUpperCase() as Address,
      A, // dup (different case)
      B,
    ];
    const out = normalizeExclusions(mixed);
    expect(out).toHaveLength(3);
    // strictly ascending by numeric address value
    const nums = out.map((a) => BigInt(a));
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i]! > nums[i - 1]!).toBe(true);
    }
    // all lowercase
    expect(out).toEqual(out.map((a) => a.toLowerCase()));
  });
});

describe("applyExclusions", () => {
  it("drops excluded holders and records addresses + applied subset", () => {
    const balances = new Map<Address, bigint>([
      [A, 10n],
      [B, 5n],
      [C, 7n],
    ]);
    const { balances: filtered, record } = applyExclusions(balances, [B]);

    expect(filtered.has(B)).toBe(false);
    expect(filtered.has(A)).toBe(true);
    expect(filtered.has(C)).toBe(true);
    expect(filtered.size).toBe(2);

    expect(record.addresses).toEqual([B]);
    // B held a positive balance, so it was materially applied
    expect(record.applied).toEqual([B]);
  });

  it("records a listed-but-absent address in `addresses` but not `applied`", () => {
    const balances = new Map<Address, bigint>([
      [A, 10n],
      [C, 7n],
    ]);
    // B is excluded but was never a holder
    const { balances: filtered, record } = applyExclusions(balances, [B]);
    expect(filtered.size).toBe(2);
    expect(record.addresses).toEqual([B]);
    expect(record.applied).toEqual([]); // no material effect
  });

  it("is case-insensitive and does not mutate the input map", () => {
    const balances = new Map<Address, bigint>([
      [A, 10n],
      [B, 5n],
    ]);
    const before = balances.size;
    const { balances: filtered } = applyExclusions(balances, [
      B.toUpperCase() as Address,
    ]);
    expect(filtered.has(B)).toBe(false);
    // original untouched
    expect(balances.size).toBe(before);
    expect(balances.has(B)).toBe(true);
  });
});

describe("netFromGross (withholding math)", () => {
  it("bps=0 is the identity", () => {
    expect(netFromGross(1_000_000_000_000_000_000n, 0)).toBe(
      1_000_000_000_000_000_000n,
    );
  });

  it("applies gross*(10000-bps)/10000 with floor division", () => {
    // 1e18 @ 1500 bps (15%) -> 0.85e18
    expect(netFromGross(10n ** 18n, 1500)).toBe(850_000_000_000_000_000n);
    // 100 @ 2500 bps (25%) -> 75
    expect(netFromGross(100n, 2500)).toBe(75n);
    // floor: 7 @ 3300 bps -> 7*6700/10000 = 4.69 -> 4
    expect(netFromGross(7n, 3300)).toBe(4n);
  });

  it("bps=10000 withholds everything", () => {
    expect(netFromGross(123_456n, 10000)).toBe(0n);
  });

  it("rejects out-of-range bps", () => {
    expect(() => netFromGross(1n, -1)).toThrow();
    expect(() => netFromGross(1n, 10001)).toThrow();
    expect(() => netFromGross(1n, 1.5)).toThrow();
  });
});

describe("assertBps", () => {
  it("accepts the endpoints and rejects beyond them", () => {
    expect(() => assertBps(0)).not.toThrow();
    expect(() => assertBps(10000)).not.toThrow();
    expect(() => assertBps(-1)).toThrow();
    expect(() => assertBps(10001)).toThrow();
  });
});
