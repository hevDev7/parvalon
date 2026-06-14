/**
 * Shard a large proofs.json (corporax-merkle-v1) into per-address-prefix files so
 * a server route can return ONE holder's proof without loading the whole artifact.
 *
 * Layout written to <OUT_DIR>/<chainId>-<actionId>/:
 *   meta.json        — everything except `claims` (root, totalPayout, holderCount…)
 *   <prefix>.json    — { "<addr>": { index, amount, proof[] }, … } for addresses
 *                      whose first byte == <prefix> (256 shards, ~holders/256 each)
 *
 * Run:  IN=<big proofs.json> OUT_DIR=<store>/<chainId>-<actionId> \
 *       node --max-old-space-size=4096 shard-proofs.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const IN = process.env.IN;
const OUT_DIR = process.env.OUT_DIR;
if (!IN || !OUT_DIR) throw new Error("set IN and OUT_DIR");

process.stderr.write(`[shard] reading ${IN} …\n`);
const data = JSON.parse(readFileSync(IN, "utf8"));
const { claims, ...meta } = data;
if (!claims || typeof claims !== "object") throw new Error("no claims object in input");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "meta.json"), JSON.stringify(meta));

/** prefix = first byte of the address (2 hex chars after 0x) → 256 buckets. */
const shards = new Map();
let n = 0;
for (const addr in claims) {
  const prefix = addr.slice(2, 4).toLowerCase();
  let bucket = shards.get(prefix);
  if (!bucket) shards.set(prefix, (bucket = {}));
  bucket[addr.toLowerCase()] = claims[addr];
  n++;
}

for (const [prefix, bucket] of shards) {
  writeFileSync(join(OUT_DIR, `${prefix}.json`), JSON.stringify(bucket));
}

process.stderr.write(
  `[shard] wrote ${shards.size} shard files for ${n} holders -> ${OUT_DIR}\n`,
);
process.stdout.write(`${OUT_DIR}\n`);
