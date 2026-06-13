/**
 * Finality / reorg-buffer guard tests (audit M-x).
 *
 * The off-chain snapshot scans Transfer logs over [deployBlock, recordBlock] and
 * commits a Merkle root immutably. On an Orbit/L2, logs at or just below
 * recordBlock read during snapshotting can still be reorged out, so paying the
 * resulting holder set is unsafe until recordBlock is buried under enough
 * confirmations. `RpcBalanceProvider` therefore supports a `confirmations`
 * (finality depth) option: before scanning it reads the chain head and REFUSES
 * to snapshot a record block still inside the reorg window.
 *
 * These tests inject a fake viem-style client (only `getBlockNumber` + `getLogs`
 * are exercised) so the guard runs offline and deterministically.
 */
import { describe, it, expect } from "vitest";
import { RpcBalanceProvider, FinalityError, type Address, type SnapshotInput } from "./index.js";

const ASSET = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" as Address;
const A = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Address;

/**
 * A minimal stand-in for viem's PublicClient: returns a fixed head from
 * `getBlockNumber` and a single canned Transfer log from `getLogs`. We only
 * implement the two methods `RpcBalanceProvider` actually calls.
 */
function fakeClient(head: bigint, calls?: { getBlockNumber: number }): any {
  return {
    getBlockNumber: async () => {
      if (calls) calls.getBlockNumber += 1;
      return head;
    },
    getLogs: async () => [
      {
        args: { from: "0x0000000000000000000000000000000000000000", to: A, value: 10n },
      },
    ],
  };
}

function input(recordBlock: bigint): SnapshotInput {
  return {
    rpcUrl: "http://unused",
    asset: ASSET,
    deployBlock: 0n,
    recordBlock,
    ratePerShare: 10n ** 18n,
    actionId: 1n,
    chunkSize: 5000n,
    chainId: 31337,
  };
}

const QUIET = () => {};

describe("finality guard (confirmations / reorg buffer)", () => {
  it("THROWS FinalityError when head is too close to recordBlock", async () => {
    // head=105, recordBlock=100 → 5 confirmations available, need 12.
    const provider = new RpcBalanceProvider(fakeClient(105n), {
      confirmations: 12n,
      log: QUIET,
    });
    await expect(provider.balancesAt(input(100n))).rejects.toBeInstanceOf(FinalityError);
  });

  it("FinalityError message names the deficit (head, recordBlock, required, actual)", async () => {
    const provider = new RpcBalanceProvider(fakeClient(105n), {
      confirmations: 12n,
      log: QUIET,
    });
    await expect(provider.balancesAt(input(100n))).rejects.toThrow(/confirmations?/i);
  });

  it("does NOT scan logs when the guard trips (refuses before reading)", async () => {
    let scanned = false;
    const client: any = {
      getBlockNumber: async () => 101n, // only 1 confirmation
      getLogs: async () => {
        scanned = true;
        return [];
      },
    };
    const provider = new RpcBalanceProvider(client, { confirmations: 6n, log: QUIET });
    await expect(provider.balancesAt(input(100n))).rejects.toBeInstanceOf(FinalityError);
    expect(scanned).toBe(false);
  });

  it("PROCEEDS when head is buried under enough confirmations", async () => {
    // head=130, recordBlock=100 → 30 confirmations available, need 12.
    const calls = { getBlockNumber: 0 };
    const provider = new RpcBalanceProvider(fakeClient(130n, calls), {
      confirmations: 12n,
      log: QUIET,
    });
    const balances = await provider.balancesAt(input(100n));
    expect(balances.get(A)).toBe(10n);
    expect(calls.getBlockNumber).toBe(1); // head was read exactly once
  });

  it("boundary: exactly `confirmations` deep is allowed (head - recordBlock == confirmations)", async () => {
    // head=112, recordBlock=100 → exactly 12 confirmations, need 12 → OK.
    const provider = new RpcBalanceProvider(fakeClient(112n), {
      confirmations: 12n,
      log: QUIET,
    });
    const balances = await provider.balancesAt(input(100n));
    expect(balances.get(A)).toBe(10n);
  });

  it("boundary: one short trips the guard (head - recordBlock == confirmations - 1)", async () => {
    // head=111, recordBlock=100 → 11 confirmations, need 12 → throws.
    const provider = new RpcBalanceProvider(fakeClient(111n), {
      confirmations: 12n,
      log: QUIET,
    });
    await expect(provider.balancesAt(input(100n))).rejects.toBeInstanceOf(FinalityError);
  });

  it("default (confirmations=0) preserves existing behavior: no head read, no guard", async () => {
    const calls = { getBlockNumber: 0 };
    // head is BELOW recordBlock here — would always trip any guard — but with the
    // default the head is never read and the scan proceeds (legacy behavior).
    const provider = new RpcBalanceProvider(fakeClient(5n, calls), { log: QUIET });
    const balances = await provider.balancesAt(input(100n));
    expect(balances.get(A)).toBe(10n);
    expect(calls.getBlockNumber).toBe(0); // head NEVER read when guard is off
  });

  it("confirmations=0 emits a LOUD reorg-unsafe warning to the log sink", async () => {
    const lines: string[] = [];
    const provider = new RpcBalanceProvider(fakeClient(5n), {
      log: (m) => lines.push(m),
    });
    await provider.balancesAt(input(100n));
    expect(lines.join("\n")).toMatch(/reorg|finality|confirmations/i);
    expect(lines.join("\n")).toMatch(/warning/i);
  });
});
