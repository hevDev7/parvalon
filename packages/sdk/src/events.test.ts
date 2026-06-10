/**
 * Event decoder tests.
 *
 * For each CAE-1 event we synthesise a raw `{ topics, data }` log with viem's
 * `encodeEventTopics` (indexed args + signature) + `encodeAbiParameters`
 * (non-indexed data), then decode it back through the SDK decoders and assert
 * the typed payload round-trips exactly. The ABIs are the imported (generated)
 * ones, so this also pins the event signatures to the deployed contracts.
 */
import { describe, it, expect } from "vitest";
import {
  encodeEventTopics,
  encodeAbiParameters,
  type AbiParameter,
  type Hex as ViemHex,
} from "viem";
import { registryAbi, distributorAbi } from "./generated/abis.js";
import {
  decodeActionAnnounced,
  decodeMerkleRootPublished,
  decodeActionStatusChanged,
  decodeFunded,
  decodeClaimed,
  decodeUnclaimedSwept,
  type RawLog,
} from "./events.js";
import { ActionStatus, ActionType, type Address, type Hex } from "./types.js";

type AnyAbi = readonly unknown[];

/** Build a synthetic log for `eventName` from a full args object. */
function makeLog(
  abi: AnyAbi,
  eventName: string,
  args: Record<string, unknown>,
): RawLog {
  // Indexed args → topics (viem orders them per the ABI).
  const topics = encodeEventTopics({
    abi: abi as never,
    eventName: eventName as never,
    args: args as never,
  });
  // Non-indexed args → data, in ABI order.
  const event = (abi as Array<Record<string, unknown>>).find(
    (e) => e.type === "event" && e.name === eventName,
  ) as { inputs: Array<AbiParameter & { indexed?: boolean; name: string }> };
  const dataParams = event.inputs.filter((i) => !i.indexed);
  const data =
    dataParams.length === 0
      ? "0x"
      : encodeAbiParameters(
          dataParams,
          dataParams.map((p) => args[p.name]),
        );
  return { topics: topics as ViemHex[], data: data as ViemHex };
}

const ASSET = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const HOLDER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const ROOT =
  "0x9daa2db93985d682fb9490802adb983d82f4922fc23cb599506238e84fd05a21" as Hex;

describe("Registry event decoders", () => {
  it("ActionAnnounced round-trips", () => {
    const log = makeLog(registryAbi, "ActionAnnounced", {
      id: 1n,
      asset: ASSET,
      actionType: ActionType.CASH_DIVIDEND,
      ratePerShare: 500000000000000000n,
      recordBlock: 2n,
      payableAt: 1781110880n,
      claimDeadline: 1781715680n,
      payoutToken: TOKEN,
      metadataURI: "ipfs://demo",
    });
    const e = decodeActionAnnounced(log);
    expect(e.id).toBe(1n);
    expect(e.asset.toLowerCase()).toBe(ASSET.toLowerCase());
    expect(e.actionType).toBe(ActionType.CASH_DIVIDEND);
    expect(e.ratePerShare).toBe(500000000000000000n);
    expect(e.recordBlock).toBe(2n);
    expect(e.payableAt).toBe(1781110880n);
    expect(e.claimDeadline).toBe(1781715680n);
    expect(e.payoutToken.toLowerCase()).toBe(TOKEN.toLowerCase());
    expect(e.metadataURI).toBe("ipfs://demo");
  });

  it("MerkleRootPublished round-trips", () => {
    const log = makeLog(registryAbi, "MerkleRootPublished", {
      id: 1n,
      root: ROOT,
      totalPayout: 12000000000000000000n,
      holderCount: 2n,
    });
    const e = decodeMerkleRootPublished(log);
    expect(e.id).toBe(1n);
    expect(e.root).toBe(ROOT);
    expect(e.totalPayout).toBe(12000000000000000000n);
    expect(e.holderCount).toBe(2n);
  });

  it("ActionStatusChanged round-trips (enum-typed)", () => {
    const log = makeLog(registryAbi, "ActionStatusChanged", {
      id: 1n,
      previousStatus: ActionStatus.ROOT_PUBLISHED,
      newStatus: ActionStatus.CLAIMABLE,
    });
    const e = decodeActionStatusChanged(log);
    expect(e.id).toBe(1n);
    expect(e.previousStatus).toBe(ActionStatus.ROOT_PUBLISHED);
    expect(e.newStatus).toBe(ActionStatus.CLAIMABLE);
  });
});

describe("Distributor event decoders", () => {
  it("Funded round-trips", () => {
    const log = makeLog(distributorAbi, "Funded", {
      id: 1n,
      from: HOLDER,
      amount: 12000000000000000000n,
      totalFunded: 12000000000000000000n,
    });
    const e = decodeFunded(log);
    expect(e.id).toBe(1n);
    expect(e.from.toLowerCase()).toBe(HOLDER.toLowerCase());
    expect(e.amount).toBe(12000000000000000000n);
    expect(e.totalFunded).toBe(12000000000000000000n);
  });

  it("Claimed round-trips", () => {
    const log = makeLog(distributorAbi, "Claimed", {
      id: 1n,
      index: 0n,
      account: HOLDER,
      amount: 7000000000000000000n,
    });
    const e = decodeClaimed(log);
    expect(e.id).toBe(1n);
    expect(e.index).toBe(0n);
    expect(e.account.toLowerCase()).toBe(HOLDER.toLowerCase());
    expect(e.amount).toBe(7000000000000000000n);
  });

  it("UnclaimedSwept round-trips", () => {
    const log = makeLog(distributorAbi, "UnclaimedSwept", {
      id: 1n,
      to: HOLDER,
      amount: 5000000000000000000n,
    });
    const e = decodeUnclaimedSwept(log);
    expect(e.id).toBe(1n);
    expect(e.to.toLowerCase()).toBe(HOLDER.toLowerCase());
    expect(e.amount).toBe(5000000000000000000n);
  });
});
