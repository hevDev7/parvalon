/**
 * Calldata encoding + read/write wiring tests.
 *
 * No live chain: we decode the SDK's calldata back with viem `decodeFunctionData`
 * to prove the function selector + args are correct, and we drive the read/write
 * helpers and `CorporaXClient` with hand-rolled mock viem clients that capture
 * the request the SDK would send.
 */
import { describe, it, expect, vi } from "vitest";
import { decodeFunctionData, type PublicClient, type WalletClient } from "viem";
import { registryAbi, distributorAbi } from "./generated/abis.js";
import {
  announceActionCalldata,
  publishRootCalldata,
  claimCalldata,
  fundCalldata,
  encodeClaim,
  claimArgsFromEligible,
  type AnnounceActionArgs,
} from "./encode.js";
import * as reads from "./reads.js";
import * as writes from "./writes.js";
import { CorporaXClient } from "./client.js";
import { localAnvil } from "./chains.js";
import {
  ActionType,
  type Address,
  type EligibleClaim,
  type Hex,
} from "./types.js";

const REGISTRY = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as Address;
const DISTRIBUTOR = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" as Address;
const ASSET = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const HOLDER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const SIGNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const PROOF = ["0x1cb3790dba7b57c0a2f299cdf8733019551025dd79c98c01e08e94584c0075f7" as Hex];

describe("calldata encoders decode back to the right call", () => {
  it("announceAction", () => {
    const args: AnnounceActionArgs = {
      asset: ASSET,
      actionType: ActionType.CASH_DIVIDEND,
      ratePerShare: 500000000000000000n,
      recordBlock: 2n,
      payableAt: 1781110880n,
      claimDeadline: 1781715680n,
      payoutToken: TOKEN,
      metadataURI: "ipfs://demo",
    };
    const data = announceActionCalldata(args);
    const decoded = decodeFunctionData({ abi: registryAbi, data });
    expect(decoded.functionName).toBe("announceAction");
    expect(decoded.args).toEqual([
      ASSET,
      ActionType.CASH_DIVIDEND,
      500000000000000000n,
      2n,
      1781110880n,
      1781715680n,
      TOKEN,
      "ipfs://demo",
    ]);
  });

  it("publishRoot", () => {
    const root =
      "0x9daa2db93985d682fb9490802adb983d82f4922fc23cb599506238e84fd05a21" as Hex;
    const data = publishRootCalldata({
      id: 1n,
      root,
      totalPayout: 12000000000000000000n,
      holderCount: 2n,
    });
    const decoded = decodeFunctionData({ abi: registryAbi, data });
    expect(decoded.functionName).toBe("publishRoot");
    expect(decoded.args).toEqual([1n, root, 12000000000000000000n, 2n]);
  });

  it("claim", () => {
    const data = claimCalldata({
      id: 1n,
      index: 0n,
      account: HOLDER,
      amount: 7000000000000000000n,
      proof: PROOF,
    });
    const decoded = decodeFunctionData({ abi: distributorAbi, data });
    expect(decoded.functionName).toBe("claim");
    expect(decoded.args).toEqual([1n, 0n, HOLDER, 7000000000000000000n, PROOF]);
  });

  it("fund", () => {
    const data = fundCalldata(1n, 12000000000000000000n);
    const decoded = decodeFunctionData({ abi: distributorAbi, data });
    expect(decoded.functionName).toBe("fund");
    expect(decoded.args).toEqual([1n, 12000000000000000000n]);
  });
});

describe("claimArgsFromEligible", () => {
  it("maps an EligibleClaim to claim args", () => {
    const eligible: EligibleClaim = {
      actionId: 1n,
      index: 0n,
      account: HOLDER,
      amount: 7000000000000000000n,
      proof: PROOF,
    };
    expect(claimArgsFromEligible(eligible)).toEqual({
      id: 1n,
      index: 0n,
      account: HOLDER,
      amount: 7000000000000000000n,
      proof: PROOF,
    });
    // encodeClaim accepts the mapped args directly.
    const e = encodeClaim(claimArgsFromEligible(eligible));
    expect(e.functionName).toBe("claim");
  });
});

/** A mock PublicClient that records readContract calls and returns a fixed value. */
function mockPublicClient(returnValue: unknown) {
  const readContract = vi.fn().mockResolvedValue(returnValue);
  return { client: { readContract } as unknown as PublicClient, readContract };
}

/** A mock WalletClient that records writeContract calls. */
function mockWalletClient() {
  const writeContract = vi
    .fn()
    .mockResolvedValue(
      "0xabc0000000000000000000000000000000000000000000000000000000000000",
    );
  const client = {
    account: { address: SIGNER, type: "json-rpc" },
    chain: localAnvil,
    writeContract,
  } as unknown as WalletClient;
  return { client, writeContract };
}

describe("read helpers send the right request", () => {
  it("getAction maps the struct result", async () => {
    const struct = {
      id: 1n,
      asset: ASSET,
      actionType: ActionType.CASH_DIVIDEND,
      ratePerShare: 5n,
      recordBlock: 2n,
      payableAt: 3n,
      claimDeadline: 4n,
      payoutToken: TOKEN,
      merkleRoot: "0x00" as Hex,
      totalPayout: 12n,
      status: 2,
      metadataURI: "ipfs://x",
    };
    const { client, readContract } = mockPublicClient(struct);
    const a = await reads.getAction(client, REGISTRY, 1n);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "getAction",
        args: [1n],
      }),
    );
    expect(a.id).toBe(1n);
    expect(a.metadataURI).toBe("ipfs://x");
  });

  it("isClaimed targets the distributor", async () => {
    const { client, readContract } = mockPublicClient(true);
    const claimed = await reads.isClaimed(client, DISTRIBUTOR, 1n, 0n);
    expect(claimed).toBe(true);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: DISTRIBUTOR,
        functionName: "isClaimed",
        args: [1n, 0n],
      }),
    );
  });

  it("listActions loops 1..count", async () => {
    const readContract = vi
      .fn()
      // actionCount()
      .mockResolvedValueOnce(2n)
      // getAction(1), getAction(2)
      .mockResolvedValueOnce({ id: 1n, asset: ASSET, actionType: 0, ratePerShare: 0n, recordBlock: 0n, payableAt: 0n, claimDeadline: 0n, payoutToken: TOKEN, merkleRoot: "0x00", totalPayout: 0n, status: 0, metadataURI: "" })
      .mockResolvedValueOnce({ id: 2n, asset: ASSET, actionType: 0, ratePerShare: 0n, recordBlock: 0n, payableAt: 0n, claimDeadline: 0n, payoutToken: TOKEN, merkleRoot: "0x00", totalPayout: 0n, status: 0, metadataURI: "" });
    const client = { readContract } as unknown as PublicClient;
    const list = await reads.listActions(client, REGISTRY);
    expect(list.map((a) => a.id)).toEqual([1n, 2n]);
    expect(readContract).toHaveBeenCalledTimes(3);
  });
});

describe("write helpers send the right request", () => {
  it("claim forwards args and uses the wallet account/chain", async () => {
    const { client, writeContract } = mockWalletClient();
    const hash = await writes.claim(client, DISTRIBUTOR, {
      id: 1n,
      index: 0n,
      account: HOLDER,
      amount: 7000000000000000000n,
      proof: PROOF,
    });
    expect(hash).toMatch(/^0x/);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: DISTRIBUTOR,
        functionName: "claim",
        args: [1n, 0n, HOLDER, 7000000000000000000n, PROOF],
        chain: localAnvil,
      }),
    );
  });

  it("fund targets the distributor", async () => {
    const { client, writeContract } = mockWalletClient();
    await writes.fund(client, DISTRIBUTOR, 1n, 12n);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: DISTRIBUTOR,
        functionName: "fund",
        args: [1n, 12n],
      }),
    );
  });

  it("throws a clear error when no account is available", async () => {
    const writeContract = vi.fn();
    const noAccount = { chain: localAnvil, writeContract } as unknown as WalletClient;
    await expect(writes.fund(noAccount, DISTRIBUTOR, 1n, 12n)).rejects.toThrow(
      /no account/,
    );
  });
});

describe("CorporaXClient wiring", () => {
  it("routes reads to the public client", async () => {
    const { client: publicClient, readContract } = mockPublicClient(42n);
    const cx = new CorporaXClient({
      chain: localAnvil,
      addresses: { registry: REGISTRY, distributor: DISTRIBUTOR },
      publicClient,
    });
    const funded = await cx.totalFunded(1n);
    expect(funded).toBe(42n);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: DISTRIBUTOR, functionName: "totalFunded" }),
    );
  });

  it("throws when a write is attempted without a wallet", async () => {
    const { client: publicClient } = mockPublicClient(0n);
    const cx = new CorporaXClient({
      chain: localAnvil,
      addresses: { registry: REGISTRY, distributor: DISTRIBUTOR },
      publicClient,
    });
    // requireWallet fails fast (synchronous throw) — a misconfiguration, not a
    // chain error — so assert on the call expression itself.
    expect(() => cx.fund(1n, 1n)).toThrow(/needs a walletClient/);
  });

  it("claimForAccount resolves proofs + submits via the wallet", async () => {
    const { client: publicClient } = mockPublicClient(0n);
    const { client: walletClient, writeContract } = mockWalletClient();
    const cx = new CorporaXClient({
      chain: localAnvil,
      addresses: { registry: REGISTRY, distributor: DISTRIBUTOR },
      publicClient,
      walletClient,
    });
    const proofs = {
      format: "corporax-merkle-v1",
      actionId: "1",
      chainId: 31337,
      asset: ASSET,
      payoutToken: TOKEN,
      ratePerShare: "500000000000000000",
      recordBlock: 2,
      merkleRoot: "0x9daa2db93985d682fb9490802adb983d82f4922fc23cb599506238e84fd05a21" as Hex,
      totalPayout: "12000000000000000000",
      holderCount: 2,
      leafEncoding: ["uint256 actionId", "uint256 index", "address account", "uint256 amount"],
      claims: {
        "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": { index: 0, amount: "7000000000000000000", proof: PROOF },
      },
    } as const;
    await cx.claimForAccount(proofs, HOLDER);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: DISTRIBUTOR,
        functionName: "claim",
        args: [1n, 0n, HOLDER, 7000000000000000000n, PROOF],
      }),
    );
  });

  it("claimForAccount throws for a non-eligible account", async () => {
    const { client: publicClient } = mockPublicClient(0n);
    const { client: walletClient } = mockWalletClient();
    const cx = new CorporaXClient({
      chain: localAnvil,
      addresses: { registry: REGISTRY, distributor: DISTRIBUTOR },
      publicClient,
      walletClient,
    });
    const proofs = {
      format: "corporax-merkle-v1",
      actionId: "1",
      chainId: 31337,
      asset: ASSET,
      payoutToken: TOKEN,
      ratePerShare: "0",
      recordBlock: 2,
      merkleRoot: "0x00" as Hex,
      totalPayout: "0",
      holderCount: 0,
      leafEncoding: [],
      claims: {},
    } as const;
    // Eligibility is resolved before any async work, so this throws synchronously.
    expect(() => cx.claimForAccount(proofs, HOLDER)).toThrow(/not eligible/);
  });
});
