# CAE-1 — EIP submission guide & checklist

[`eip-cae1.md`](./eip-cae1.md) is written to the [EIP-1](https://eips.ethereum.org/EIPS/eip-1)
process and format. This guide is the checklist to take it from an in-repo draft to a
submitted Standards-Track ERC.

## The path

```
in-repo draft ─▶ Ethereum Magicians thread ─▶ PR to ethereum/EIPs ─▶ Draft ─▶ Review ─▶ Last Call ─▶ Final
                 (discussions-to)             (eipw CI + editor)
```

- **Draft** — merged into ethereum/EIPs after an editor assigns a number and `eipw` (the
  EIP validator) passes. Editors check *format*, not merit.
- **Review** — author signals readiness; community + editors review.
- **Last Call** — ~14 days final window.
- **Final** — immutable.

## Pre-submission checklist (format — what `eipw` enforces)

- [x] **Preamble** present with `title`, `description`, `author`, `discussions-to`, `status`,
      `type`, `category`, `created`, `requires`.
- [x] **`title`** ≤ 44 chars, no EIP number, no the words "standard"/"interface"/"ERC".
      → "Corporate Action Events" (23).
- [x] **`description`** ≤ 140 chars, no title duplication. → 131 chars.
- [x] **`author`** in `Name (@github)` or `Name <email>` form. → `Parvalon (@corporax)`.
- [x] **Required sections** in order: Abstract, Motivation, Specification, Rationale,
      Backwards Compatibility, Reference Implementation (optional for Final but present),
      Security Considerations, Copyright.
- [x] **RFC-2119** keywords boilerplate present in Specification.
- [x] **Copyright** waived via CC0 with the exact `[CC0](../LICENSE)` link.
- [x] Internal EIP links use `./eip-N.md` (e.g. `[ERC-20](./eip-20.md)`).
- [ ] **`eip:`** number — replace the `7XXXX` placeholder with the number an editor assigns
      (and rename the file to `eip-<number>.md`).
- [ ] **`discussions-to`** — replace with the real Ethereum Magicians thread URL.

## Steps

1. **Open the discussion.** Post the abstract + a link to the reference implementation on
   [Ethereum Magicians](https://ethereum-magicians.org/) under *EIPs → ERCs*. Title it
   e.g. "ERC: Corporate Action Events (CAE-1)". Copy the thread URL.
2. **Set `discussions-to`** in the draft to that URL.
3. **Fork `ethereum/EIPs`.** Copy `eip-cae1.md` to `EIPS/eip-XXXX.md`. Leave the number as
   the PR number until an editor assigns the final one (they will tell you what to use).
4. **Validate locally** before opening the PR:
   ```bash
   # eipw — the official validator used in CI
   cargo install eipw           # or: docker run --rm -v "$PWD:/eips" ghcr.io/ethereum/eipw
   eipw EIPS/eip-XXXX.md
   # markdown/format lint
   npx @ethereum/eipw-action --help   # mirrors the GitHub Action
   ```
5. **Open the PR** to `ethereum/EIPs`. The `eipw` GitHub Action + an EIP editor review the
   format. Address comments; once merged it is **Draft**.
6. **Drive status** Draft → Review → Last Call → Final by updating `status:` in follow-up PRs
   as the process milestones are met.

## Notes specific to CAE-1

- The Specification is **frozen** (events + leaf binding). Editors may request wording/format
  changes; resist changing the normative bytes (they match the deployed reference impl and
  [INTEGRATION.md](../INTEGRATION.md)).
- The reference implementation (this repo) is already deployed/tested — link the verified
  contract addresses in the Magicians thread to strengthen the submission.
- If an editor prefers the events live on the token vs. an overlay, the Rationale already
  pre-empts this (§"Why an overlay registry"): tokenized equities are frequently *not*
  controlled by the action publisher.
