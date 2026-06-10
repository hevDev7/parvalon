# CorporaX — Key Management (HSM / KMS)

> Custody, policy, and audit logging for the three privileged key classes —
> **admin**, **issuer**, **relayer** — plus how to wire a cloud KMS signer into
> `forge`/`cast` and `viem`. This is a **policy + code-sketch** document: no live
> cloud is provisioned here, but every sketch is real and runnable once you point
> it at your KMS. Pair with [DEPLOY.md](./DEPLOY.md), [ONBOARDING.md](./ONBOARDING.md),
> [THREAT-MODEL.md](./THREAT-MODEL.md), [DR.md](./DR.md).

---

## 1. Key classes & blast radius

| Key | On-chain role | What it can do | Recommended custody |
|---|---|---|---|
| **admin** | `DEFAULT_ADMIN_ROLE` → **TimelockController** (post-handover); Safe is proposer/executor | Set issuers, swap action source, grant/revoke roles. Slow (timelock `minDelay`) + observable. | **Gnosis Safe** (N-of-M), each signer key in its own **HSM/KMS**. The timelock makes any admin action delayed & cancellable. |
| **pauser** | `PAUSER_ROLE` → **Safe** directly | Emergency `pause()`/`unpause()` on registry + distributor. Fast, no delay. | Same Safe, possibly a lower-threshold "break-glass" sub-policy for speed. |
| **issuer** | `assetIssuer(asset)` | `fund`/`sweep`/announce/publish for that asset. Funds dividends; cannot touch user claims. | Dedicated per-asset ops account or Safe; signing key in **KMS/HSM**. Rotatable via `setAssetIssuer`. |
| **relayer** | none on-chain | Submits claim-on-behalf txs; pays gas. **Cannot redirect funds** (claim always pays `account`). | KMS-backed hot key, low balance, rate-limited. Compromise = gas griefing only. |

Design principle: **no single EOA holds protocol power in production.** After
[governance handover](./DEPLOY.md#2-governance-handover-p0-1p0-2) the deployer
renounces everything; admin lives behind the timelock+Safe, pauser on the Safe.

---

## 2. Custody model: HSM / KMS

Use a cloud KMS (AWS KMS or GCP KMS) with **non-exportable** `secp256k1` keys, or
an on-prem HSM (CloudHSM / YubiHSM / Ledger for Safe signers). The private key
material never leaves the HSM boundary; the host only ever sees signatures.

- **AWS KMS**: create an asymmetric key, `KeySpec=ECC_SECG_P256K1`,
  `KeyUsage=SIGN_VERIFY`. The Ethereum address is derived from the KMS public key.
- **GCP KMS**: a key ring + key with `EC_SIGN_SECP256K1_SHA256`.
- **Gnosis Safe**: each Safe owner is itself a KMS/HSM/Ledger key; the Safe
  threshold (e.g. 3-of-5) is the real admin/pauser authority.

Why KMS over a `.env` private key:
- Key material is non-exportable; theft of a host ≠ theft of the key.
- Every signature is an authenticated, logged API call (see §5).
- Rotation/disable is a console action, not a redeploy.

---

## 3. Wiring a KMS signer into forge / cast

`cast` and `forge` support AWS KMS natively via `--aws`. No code needed:

```bash
# AWS creds + region from the environment (instance role / SSO / env).
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=…            # or an instance/role profile
export AWS_SECRET_ACCESS_KEY=…
export AWS_KMS_KEY_ID=arn:aws:kms:us-east-1:1234:key/abcd-…   # the signing key

# Read the address Foundry will sign as:
cast wallet address --aws

# Sign / send through KMS (no private key ever on disk):
cast send <registry> 'setAssetIssuer(address,address)' <asset> <issuer> \
  --rpc-url "$RPC_URL" --aws

# Deploy through KMS — substitute for --private-key in scripts/deploy-and-verify.sh:
forge script script/Deploy.s.sol:Deploy --root contracts \
  --rpc-url "$RPC_URL" --broadcast --aws
```

> In `scripts/*.sh` the examples use `--private-key "$PRIVATE_KEY"` for
> readability. In production replace each `--private-key "$PRIVATE_KEY"` with
> `--aws` (KMS) or `--account <keystore> --password-file <f>` (encrypted local
> keystore). The scripts' verification logic is signer-agnostic — only the
> signing flag changes. For the **admin/pauser** class you generally do *not*
> sign directly at all: the scripts print Safe/timelock calldata you submit
> through the Safe UI/SDK (whose owners are the KMS keys).

GCP KMS has no first-class `cast` flag; bridge it with a local **EIP-1193/JSON-RPC
signer proxy** (e.g. an `ethers`/`web3signer` adapter exposing
`eth_signTransaction`) and point `--rpc-url` / the Safe SDK at it, or use
[Web3Signer](https://docs.web3signer.consensys.io/) which speaks GCP/AWS/Azure KMS
and Vault behind a standard signing API.

---

## 4. Wiring a KMS signer into viem (relayer / app server)

The relayer (gasless claims) and any server-side signer should use a KMS
`LocalAccount` adapter so the key stays in the HSM. Sketch with AWS KMS:

```ts
// kms-signer.ts — viem custom account backed by AWS KMS (sketch; not wired into build).
// deps: viem, @aws-sdk/client-kms, and a tiny secp256k1/asn1 helper for DER->rs.
import {
  KMSClient, GetPublicKeyCommand, SignCommand,
} from "@aws-sdk/client-kms";
import {
  type Address, type Hash, type Hex,
  toAccount, keccak256, serializeTransaction, hashMessage,
} from "viem";
import { publicKeyToAddress } from "viem/utils";
// derSignatureToRS / asn1 helpers omitted for brevity — KMS returns DER; EVM wants {r,s,v}.

const kms = new KMSClient({ region: process.env.AWS_REGION });
const KEY_ID = process.env.AWS_KMS_KEY_ID!;

async function kmsSignDigest(digest: Hex): Promise<{ r: Hex; s: Hex; v: 27n | 28n }> {
  const { Signature } = await kms.send(new SignCommand({
    KeyId: KEY_ID,
    Message: Buffer.from(digest.slice(2), "hex"),
    MessageType: "DIGEST",
    SigningAlgorithm: "ECDSA_SHA_256",
  }));
  // 1) DER-decode Signature -> r,s   2) normalize s to low-S (EIP-2)
  // 3) recover v by trying 27/28 against the expected address.
  return derSignatureToRS(Signature!, digest, address);
}

// Derive the address once from the KMS public key (DER SubjectPublicKeyInfo).
const { PublicKey } = await kms.send(new GetPublicKeyCommand({ KeyId: KEY_ID }));
const address: Address = publicKeyToAddress(spkiToUncompressed(PublicKey!));

export const kmsAccount = toAccount({
  address,
  async signMessage({ message }) { const { r, s, v } = await kmsSignDigest(hashMessage(message)); return concatSig(r, s, v); },
  async signTransaction(tx) { const { r, s, v } = await kmsSignDigest(keccak256(serializeTransaction(tx))); return serializeTransaction(tx, { r, s, v }); },
  async signTypedData(td) { /* hashTypedData(td) -> kmsSignDigest */ },
});

// Use it exactly like a privateKeyToAccount:
//   const wallet = createWalletClient({ account: kmsAccount, chain, transport: http(RPC_URL) });
//   await wallet.writeContract({ address: distributor, abi: distributorAbi, functionName: "claim", args: [...] });
```

Production note: prefer a vetted adapter (e.g. `@rumblefishdev/eth-aws-kms-signer`
for ethers, or `web3signer` fronting viem over JSON-RPC) over hand-rolling the
DER→{r,s,v} recovery; the sketch above shows the shape, not a paste-in library.
The relayer key is intentionally **low-privilege** — even if it signed a malicious
tx, claim-on-behalf pays `account`, never the relayer, so the worst case is wasted
gas (rate-limit + cap its balance).

---

## 5. Policy & audit logging

**Access policy**
- Least privilege per key: separate KMS keys for admin-signer(s), issuer(s),
  relayer. No key reuse across roles or chains.
- IAM/KMS key policy grants `kms:Sign` only to the specific service principal
  (the deploy CI role, the relayer task role), scoped by `kms:ViaService` and
  source VPC where possible. `kms:GetPublicKey` may be broader (it's public).
- Admin/pauser actions require the **Safe threshold** — a single KMS key cannot
  move the protocol; it can only co-sign a Safe tx.
- Issuer/relayer keys are **disable-able** instantly (KMS key state → Disabled)
  as a faster-than-rotation kill switch.

**Audit logging**
- Every KMS `Sign`/`GetPublicKey` call is logged to **AWS CloudTrail** /
  **GCP Cloud Audit Logs** with caller identity, time, and key id. Ship these to
  your SIEM; alert on `Sign` calls outside expected windows or principals.
- Correlate KMS sign events ↔ on-chain txs (CAE-1 events, [INTEGRATION §3](./INTEGRATION.md#3-cae-1-event-schema-subscribe-to-these))
  ↔ the signed deploy manifest (`deployments/manifests/*` — `provenance.signer`,
  verifiable with `cast wallet verify`). A privileged tx with **no** matching KMS
  sign log is an immediate incident.
- Safe transactions are independently logged by the Safe service (proposer,
  confirmations, executor) — keep that history as the admin-action ledger.

**Rotation**
- Scheduled rotation: issuer/relayer quarterly, admin Safe signers on personnel
  change. Issuer rotation = `setAssetIssuer` (see [ONBOARDING §4](./ONBOARDING.md));
  relayer rotation = swap the KMS key id + redeploy the relayer config; admin =
  add/remove Safe owners.
- Emergency: KMS `DisableKey` first (stops new signatures immediately), then
  rotate the on-chain pointer/Safe owner set. See the signer-loss playbook in
  [DR.md](./DR.md).

---

## 6. Key-management checklist

- [ ] Admin = Safe (N-of-M) behind a TimelockController; deployer renounced all roles.
- [ ] Each Safe owner key is HSM/KMS/Ledger-backed and non-exportable.
- [ ] Issuer keys are dedicated, KMS-backed, per-asset; not personal EOAs.
- [ ] Relayer key is KMS-backed, low-balance, rate-limited (compromise = gas only).
- [ ] `--private-key` replaced with `--aws`/keystore in all production runs.
- [ ] CloudTrail / Cloud Audit Logs on for all KMS keys, shipped to SIEM, alerting.
- [ ] Deploy manifests signed + signatures verified; signer matches expected key.
- [ ] Rotation runbook tested; `DisableKey` break-glass verified in a drill.
