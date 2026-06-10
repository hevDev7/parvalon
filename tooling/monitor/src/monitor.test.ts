/**
 * Integration-ish test of the Monitor orchestrator with a MOCKED viem client.
 *
 * This wires the real read path (actionCount -> actionView -> totalFunded/
 * totalClaimed -> erc20 balanceOf -> paused) against a fake contract state, and
 * asserts the end-to-end behaviour: an insolvent state pages, a healthy state is
 * silent, and pause toggles notify. No RPC, no chain.
 */
import { describe, it, expect } from "vitest";
import type { PublicClient } from "viem";

import { Monitor } from "./monitor.js";
import { CompositeNotifier, type Notifier } from "./notifier.js";
import { type Alert, type Address, type MonitorConfig, DEFAULT_THRESHOLDS } from "./types.js";

const REGISTRY = "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9" as Address;
const DISTRIBUTOR = "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707" as Address;
const USDG = "0x5fbdb2315678afecb367f032d93f642f64180aa3" as Address;
const ONE = 10n ** 18n;

/** A capturing sink so tests can assert on produced alerts. */
function capture(): { sink: Notifier; alerts: Alert[] } {
  const alerts: Alert[] = [];
  return { alerts, sink: { notify: async (a) => void alerts.push(a) } };
}

/** Minimal in-memory chain state the fake client serves. */
interface FakeState {
  actionCount: bigint;
  // id -> view fields we read
  views: Record<string, { status: number; payoutToken: Address; totalPayout: bigint }>;
  funded: Record<string, bigint>;
  claimed: Record<string, bigint>;
  balances: Record<string, bigint>; // token -> distributor balance
  registryPaused: boolean;
  distributorPaused: boolean;
}

/** Build a fake viem PublicClient over {@link FakeState}. */
function fakeClient(state: FakeState): PublicClient {
  const readContract = async (req: {
    address: string;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown> => {
    const fn = req.functionName;
    const addr = req.address.toLowerCase();
    if (fn === "actionCount") return state.actionCount;
    if (fn === "actionView") {
      const id = String(req.args![0]);
      const v = state.views[id]!;
      // Return the full tuple shape the monitor destructures.
      return {
        actionType: 0,
        status: v.status,
        payableAt: 0n,
        claimDeadline: 0n,
        asset: "0x0000000000000000000000000000000000000001",
        payoutToken: v.payoutToken,
        merkleRoot: "0x".padEnd(66, "0"),
        totalPayout: v.totalPayout,
      };
    }
    if (fn === "totalFunded") return state.funded[String(req.args![0])] ?? 0n;
    if (fn === "totalClaimed") return state.claimed[String(req.args![0])] ?? 0n;
    if (fn === "balanceOf") return state.balances[req.address.toLowerCase()] ?? 0n;
    if (fn === "paused") {
      if (addr === REGISTRY) return state.registryPaused;
      if (addr === DISTRIBUTOR) return state.distributorPaused;
    }
    throw new Error(`unexpected read ${fn}`);
  };
  // Only the methods Monitor uses; cast through unknown for the test double.
  return { readContract, watchContractEvent: () => () => {} } as unknown as PublicClient;
}

function cfg(): MonitorConfig {
  return {
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 31337,
    registry: REGISTRY,
    distributor: DISTRIBUTOR,
    pollIntervalMs: 1_000,
    minSeverity: "info",
    alertCooldownMs: 0,
    thresholds: DEFAULT_THRESHOLDS,
    expectedFunders: [],
  };
}

describe("Monitor.pollOnce (mocked chain)", () => {
  it("healthy, fully-backed state → no solvency page", async () => {
    const state: FakeState = {
      actionCount: 1n,
      views: { "1": { status: 2 /* CLAIMABLE */, payoutToken: USDG, totalPayout: 12n * ONE } },
      funded: { "1": 12n * ONE },
      claimed: { "1": 5n * ONE },
      balances: { [USDG]: 7n * ONE }, // obligation = 12-5 = 7, fully backed
      registryPaused: false,
      distributorPaused: false,
    };
    const { sink, alerts } = capture();
    const m = new Monitor(cfg(), sink, () => {}, fakeClient(state));
    const produced = await m.pollOnce();
    expect(produced.filter((a) => a.severity === "page")).toHaveLength(0);
    expect(alerts.filter((a) => a.code === "solvency_drift")).toHaveLength(0);
  });

  it("insolvent state (balance < obligation) → a `page` solvency alert", async () => {
    const state: FakeState = {
      actionCount: 1n,
      views: { "1": { status: 2, payoutToken: USDG, totalPayout: 12n * ONE } },
      funded: { "1": 12n * ONE },
      claimed: { "1": 5n * ONE },
      balances: { [USDG]: 6n * ONE }, // obligation 7, on-hand 6 → short by 1
      registryPaused: false,
      distributorPaused: false,
    };
    const { sink, alerts } = capture();
    const m = new Monitor(cfg(), sink, () => {}, fakeClient(state));
    await m.pollOnce();
    const page = alerts.find((a) => a.code === "solvency_drift");
    expect(page).toBeDefined();
    expect(page!.severity).toBe("page");
    expect(page!.details.shortfall).toBe(1n * ONE);
  });

  it("pause toggling across two polls → a notify on the change only", async () => {
    const state: FakeState = {
      actionCount: 0n,
      views: {},
      funded: {},
      claimed: {},
      balances: {},
      registryPaused: false,
      distributorPaused: false,
    };
    const { sink, alerts } = capture();
    const m = new Monitor(cfg(), sink, () => {}, fakeClient(state));

    // First poll establishes the baseline (no pause alert on first read).
    await m.pollOnce();
    expect(alerts.filter((a) => a.code === "pause_changed")).toHaveLength(0);

    // Distributor gets paused; next poll should notify exactly once.
    state.distributorPaused = true;
    await m.pollOnce();
    const pauses = alerts.filter((a) => a.code === "pause_changed");
    expect(pauses).toHaveLength(1);
    expect(pauses[0]!.severity).toBe("notify");
    expect(pauses[0]!.title).toContain("PAUSED");
  });

  it("an RPC read failure surfaces a notify rather than throwing", async () => {
    const broken = {
      readContract: async () => {
        throw new Error("connection refused");
      },
      watchContractEvent: () => () => {},
    } as unknown as PublicClient;
    const { sink, alerts } = capture();
    const m = new Monitor(cfg(), sink, () => {}, broken);
    const produced = await m.pollOnce();
    expect(produced).toHaveLength(1);
    expect(produced[0]!.code).toBe("rpc_error");
    expect(alerts[0]!.severity).toBe("notify");
  });
});

describe("Monitor + CompositeNotifier de-dup", () => {
  it("a persistent insolvency pages once within the cooldown window", async () => {
    const state: FakeState = {
      actionCount: 1n,
      views: { "1": { status: 2, payoutToken: USDG, totalPayout: 12n * ONE } },
      funded: { "1": 12n * ONE },
      claimed: { "1": 0n },
      balances: { [USDG]: ONE }, // wildly short
      registryPaused: false,
      distributorPaused: false,
    };
    const delivered: Alert[] = [];
    const composite = new CompositeNotifier(
      [{ notify: async (a) => void delivered.push(a) }],
      { cooldownMs: 60_000, now: () => 1_000 }, // frozen clock → cooldown active
    );
    const m = new Monitor(cfg(), composite, () => {}, fakeClient(state));
    await m.pollOnce();
    await m.pollOnce();
    await m.pollOnce();
    // Three polls, same persistent breach → exactly one page delivered.
    expect(delivered.filter((a) => a.code === "solvency_drift")).toHaveLength(1);
  });
});
