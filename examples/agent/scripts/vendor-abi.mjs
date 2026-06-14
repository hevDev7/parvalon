#!/usr/bin/env node
/**
 * vendor-abi.mjs — refresh src/abi.ts from the monorepo's canonical typed ABIs.
 *
 * This example package vendors the single ABI it needs (`registryAbi`) as a
 * verbatim, mechanically-extracted copy of the auto-generated export in
 * ../../../abis/index.ts (INTEGRATION.md §7). Run this after a contract change
 * (once the repo's `npm run abi` has regenerated abis/index.ts) so the example
 * stays in lockstep with the deployed contracts. The ABIs are never hand-edited.
 *
 * Usage (from examples/agent/):  node scripts/vendor-abi.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const abisIndex = resolve(here, "../../../abis/index.ts");
const out = resolve(here, "../src/abi.ts");

const source = readFileSync(abisIndex, "utf8");
const match = source.match(/export const registryAbi = (\[.*?\]) as const;/s);
if (!match) {
  console.error(`vendor-abi: could not find \`registryAbi\` in ${abisIndex}`);
  process.exit(1);
}
const abiLiteral = match[1];

const header = `// AUTO-VENDORED from ../../abis/index.ts (\`registryAbi\`) — do NOT hand-edit.
//
// Parvalon ships auto-generated, typed (\`as const\`) ABIs in the monorepo
// abis/ package (INTEGRATION.md §7). This example is a self-contained, npm-
// publishable package, so it vendors the single ABI it needs as a verbatim,
// mechanically-extracted copy of that canonical export — preserving full viem
// type inference without reaching across the monorepo at build time.
//
// PRODUCTION PATH: inside the Parvalon monorepo, import directly instead:
//
//     import { registryAbi } from "@parvalon/abis";   // or the abis/ workspace
//
// To refresh this file after a contract change, re-run the repo's ABI export
// (\`npm run abi\`) and re-vendor with:
//
//     node scripts/vendor-abi.mjs   // (extracts registryAbi from abis/index.ts)
//
// The leaf encoding, event signatures, and enums these ABIs encode are FROZEN
// by docs/INTEGRATION.md and docs/eip/eip-cae1.md.

/**
 * Typed CorporateActionRegistry ABI (\`as const\` for viem/wagmi inference).
 * Carries the CAE-1 registry events — notably \`ActionAnnounced\`,
 * \`MerkleRootPublished\`, and \`ActionStatusChanged\`.
 */
export const registryAbi = ${abiLiteral} as const;
`;

writeFileSync(out, header);
console.log(`vendor-abi: wrote ${out}`);
