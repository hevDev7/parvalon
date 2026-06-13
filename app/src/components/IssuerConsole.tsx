"use client";

import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { addresses, distributorAbi, erc20Abi, registryAbi, selectableAssets, tokens } from "@/lib/contracts";
import { explorerTxUrl } from "@/lib/chain";
import { Button, Card, Field, inputClass, Kicker } from "@/components/ui";
import { WalletButton } from "@/components/WalletButton";

const STEPS = ["Announce", "Snapshot", "Publish", "Fund"] as const;

export function IssuerConsole() {
  const { isConnected } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState(0);
  const [actionId, setActionId] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [tx, setTx] = useState<`0x${string}`>();

  // Announce form
  const [asset, setAsset] = useState<string>(selectableAssets[0]?.address ?? "");
  const [rate, setRate] = useState("0.5");
  const [recordBlock, setRecordBlock] = useState("");
  const [payableAt, setPayableAt] = useState("");
  const [claimDeadline, setClaimDeadline] = useState("");
  const [metadataURI, setMetadataURI] = useState("ipfs://corporax/tsla-dividend.json");

  // Snapshot inputs (pasted from proofs.json)
  const [root, setRoot] = useState("");
  const [totalPayout, setTotalPayout] = useState("");
  const [holderCount, setHolderCount] = useState("");

  useEffect(() => {
    if (!client) return;
    client.getBlockNumber().then((b) => setRecordBlock(String(b + 5n))).catch(() => {});
    const now = new Date();
    setPayableAt(toLocalInput(now));
    setClaimDeadline(toLocalInput(new Date(now.getTime() + 7 * 86400_000)));
  }, [client]);

  function reset() {
    setStep(0);
    setActionId(null);
    setTx(undefined);
    setErr(undefined);
    setRoot("");
    setTotalPayout("");
    setHolderCount("");
  }

  async function guard<T>(fn: () => Promise<T>) {
    setErr(undefined);
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : "Transaction failed");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function onAnnounce() {
    await guard(async () => {
      const hash = await writeContractAsync({
        address: addresses.registry!,
        abi: registryAbi,
        functionName: "announceAction",
        args: [
          asset as `0x${string}`,
          0, // CASH_DIVIDEND
          parseUnits(rate || "0", 18),
          BigInt(recordBlock || "0"),
          BigInt(toUnix(payableAt)),
          BigInt(toUnix(claimDeadline)),
          tokens.usdg!,
          metadataURI,
        ],
      });
      setTx(hash);
      const count = (await client!.readContract({
        address: addresses.registry!,
        abi: registryAbi,
        functionName: "actionCount",
      })) as bigint;
      setActionId(count);
      setStep(1);
    });
  }

  async function onPublish() {
    await guard(async () => {
      const hash = await writeContractAsync({
        address: addresses.registry!,
        abi: registryAbi,
        functionName: "publishRoot",
        args: [actionId!, root as `0x${string}`, parseUnits(totalPayout || "0", 18), BigInt(holderCount || "0")],
      });
      setTx(hash);
      setStep(3);
    });
  }

  async function onFund() {
    await guard(async () => {
      const amount = parseUnits(totalPayout || "0", 18);
      await writeContractAsync({
        address: tokens.usdg!,
        abi: erc20Abi,
        functionName: "approve",
        args: [addresses.distributor!, amount],
      });
      const hash = await writeContractAsync({
        address: addresses.distributor!,
        abi: distributorAbi,
        functionName: "fund",
        args: [actionId!, amount],
      });
      setTx(hash);
      setStep(4); // done
    });
  }

  if (!isConnected) {
    return (
      <Card className="p-10 text-center">
        <Kicker>Issuer access</Kicker>
        <h2 className="display mt-3 text-3xl text-ink">Connect the issuer wallet</h2>
        <p className="mx-auto mt-2 max-w-md text-ink-soft">
          Only the address onboarded as issuer for an asset can announce and fund corporate actions.
        </p>
        <div className="mt-7 flex justify-center">
          <WalletButton />
        </div>
      </Card>
    );
  }

  const cliCommand = `npm run snapshot -- \\
  --token ${asset || "<asset>"} \\
  --record-block ${recordBlock || "<block>"} \\
  --rate ${rate ? parseUnits(rate, 18).toString() : "<rateWei>"} \\
  --action-id ${actionId?.toString() ?? "<id>"} \\
  --out proofs.json`;

  return (
    <div>
      {/* Stepper */}
      <ol className="mb-8 flex items-center gap-2">
        {STEPS.map((label, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[0.78rem] font-semibold transition ${
                  done
                    ? "bg-money text-on-ink"
                    : active
                      ? "bg-ink text-on-ink"
                      : "border border-line-strong bg-surface-raised text-ink-faint"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={`text-sm ${active ? "font-semibold text-ink" : "text-ink-faint"}`}>{label}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line" />}
            </li>
          );
        })}
      </ol>

      <Card className="p-7">
        {step === 0 && (
          <div className="space-y-5">
            <Kicker>Step 1 — record the action on-chain</Kicker>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Asset">
                <select className={inputClass} value={asset} onChange={(e) => setAsset(e.target.value)}>
                  {selectableAssets.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.symbol}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Rate per share" hint="USDG per 1 token">
                <input className={inputClass} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Record block" hint="snapshot point">
                <input className={inputClass} value={recordBlock} onChange={(e) => setRecordBlock(e.target.value)} inputMode="numeric" />
              </Field>
              <Field label="Payable at">
                <input type="datetime-local" className={inputClass} value={payableAt} onChange={(e) => setPayableAt(e.target.value)} />
              </Field>
              <Field label="Claim deadline">
                <input type="datetime-local" className={inputClass} value={claimDeadline} onChange={(e) => setClaimDeadline(e.target.value)} />
              </Field>
              <Field label="Metadata URI">
                <input className={inputClass} value={metadataURI} onChange={(e) => setMetadataURI(e.target.value)} />
              </Field>
            </div>
            <Button variant="ink" onClick={onAnnounce} loading={busy}>
              Announce dividend
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <Kicker>Step 2 — take the snapshot (deterministic & auditable)</Kicker>
            <p className="text-sm text-ink-soft">
              Once the record block has passed, anyone can reconstruct the holder set from on-chain Transfer logs and
              build the Merkle root. Run the CLI, then paste the result below.
            </p>
            <pre className="overflow-x-auto rounded-md bg-ink p-4 text-[0.78rem] leading-relaxed text-white/80">
              <code>{cliCommand}</code>
            </pre>
            <Button variant="outline" onClick={() => setStep(2)}>
              I&apos;ve generated the snapshot →
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <Kicker>Step 3 — publish the snapshot root</Kicker>
            <div className="grid gap-5">
              <Field label="Merkle root" hint="from proofs.json">
                <input className={inputClass} value={root} onChange={(e) => setRoot(e.target.value)} placeholder="0x…" />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Total payout" hint="USDG">
                  <input className={inputClass} value={totalPayout} onChange={(e) => setTotalPayout(e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Holder count">
                  <input className={inputClass} value={holderCount} onChange={(e) => setHolderCount(e.target.value)} inputMode="numeric" />
                </Field>
              </div>
            </div>
            <Button variant="ink" onClick={onPublish} loading={busy} disabled={!root || !totalPayout}>
              Publish root
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <Kicker>Step 4 — fund the distribution</Kicker>
            <p className="text-sm text-ink-soft">
              Deposit <span className="tabular font-medium text-ink">{totalPayout} USDG</span>. This approves and funds
              in two transactions; when fully funded the action turns claimable.
            </p>
            <Button variant="primary" onClick={onFund} loading={busy}>
              Approve &amp; fund
            </Button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 text-center">
            <span className="mx-auto grid h-14 w-14 animate-seal place-items-center rounded-full bg-money-wash text-money">
              <span className="display text-2xl">✓</span>
            </span>
            <h3 className="display text-2xl text-ink">Action #{actionId?.toString()} is now claimable.</h3>
            <p className="text-ink-soft">Holders can claim immediately. The whole cycle is visible in the feed.</p>
            <Button variant="outline" onClick={reset}>
              Start another
            </Button>
          </div>
        )}

        {err && <p className="mt-4 text-sm text-danger">{err}</p>}
        {tx && step !== 4 && (
          <a href={explorerTxUrl(tx)} target="_blank" rel="noreferrer" className="mt-4 block text-sm text-ink-soft hover:text-ink">
            Last transaction ↗
          </a>
        )}
      </Card>
    </div>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toUnix(local: string): number {
  return local ? Math.floor(new Date(local).getTime() / 1000) : 0;
}
