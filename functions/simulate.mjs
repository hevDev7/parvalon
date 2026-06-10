// Local simulation + test for corporate-action-source.js. Loads the REAL Functions
// source as text and executes it with a mocked Functions runtime + vendor, exactly
// as the Chainlink Functions toolkit's simulateScript would — so this tests the
// shipped source, not a copy. Run: `node simulate.mjs` (exits non-zero on failure).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(__dirname, "corporate-action-source.js"), "utf8");

/** Minimal shim of the Chainlink Functions runtime surface the source uses. */
function makeFunctions() {
  return {
    makeHttpRequest: null, // injected per-scenario
    encodeUint256: (n) => {
      const b = new Uint8Array(32);
      let v = BigInt(n);
      for (let i = 31; i >= 0 && v > 0n; i--) {
        b[i] = Number(v & 0xffn);
        v >>= 8n;
      }
      return b;
    },
  };
}

/** Execute the real source string with injected globals; returns the bool verdict. */
async function runSource(args, secrets, httpResponder) {
  const Functions = makeFunctions();
  Functions.makeHttpRequest = async (req) => httpResponder(req);
  // The source ends with top-level `return`; wrap it in an async IIFE.
  const wrapped = new Function("args", "secrets", "Functions", `return (async () => { ${SOURCE} })();`);
  const out = await wrapped(args, secrets, Functions);
  if (!(out instanceof Uint8Array) || out.length !== 32) throw new Error("source did not return 32 bytes");
  return out[31] === 1;
}

// --- Fixtures -------------------------------------------------------------
const SECRETS = { vendorUrl: "https://vendor.example", vendorApiKey: "test-key" };
const ASSET = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const USDG = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

// args layout per the source header.
const cashArgs = (rateWei, ticker = "TSLA", exDate = "2026-06-12") => [
  ASSET,
  "0", // CASH_DIVIDEND
  String(rateWei),
  "100",
  "1781110880",
  "0",
  USDG,
  ticker,
  exDate,
  "",
];
const splitArgs = (ratio, exDate = "2026-06-12") => [ASSET, "1", "0", "100", "0", "0", USDG, "TSLA", exDate, ratio];

const vendorWith = (records) => async () => ({ error: undefined, data: { actions: records } });
const vendorError = () => async () => ({ error: true, status: 503 });

// --- Scenarios ------------------------------------------------------------
const cases = [
  {
    name: "authentic 0.50 cash dividend matches vendor",
    run: () =>
      runSource(
        cashArgs(500000000000000000n),
        SECRETS,
        vendorWith([{ type: "cash_dividend", amountPerShare: 0.5, exDate: "2026-06-12" }]),
      ),
    expect: true,
  },
  {
    name: "rate mismatch (0.50 announced vs 0.40 vendor) -> reject",
    run: () =>
      runSource(
        cashArgs(500000000000000000n),
        SECRETS,
        vendorWith([{ type: "cash_dividend", amountPerShare: 0.4, exDate: "2026-06-12" }]),
      ),
    expect: false,
  },
  {
    name: "ex-date mismatch -> reject",
    run: () =>
      runSource(
        cashArgs(500000000000000000n, "TSLA", "2026-06-12"),
        SECRETS,
        vendorWith([{ type: "cash_dividend", amountPerShare: 0.5, exDate: "2026-09-01" }]),
      ),
    expect: false,
  },
  {
    name: "no vendor record -> reject",
    run: () => runSource(cashArgs(500000000000000000n), SECRETS, vendorWith([])),
    expect: false,
  },
  {
    name: "vendor request error -> reject",
    run: () => runSource(cashArgs(500000000000000000n), SECRETS, vendorError()),
    expect: false,
  },
  {
    name: "within tolerance (0.504 vs 0.50) -> accept",
    run: () =>
      runSource(
        cashArgs(500000000000000000n),
        SECRETS,
        vendorWith([{ type: "cash_dividend", amountPerShare: 0.504, exDate: "2026-06-12" }]),
      ),
    expect: true,
  },
  {
    name: "4-for-1 split matches vendor -> accept",
    run: () =>
      runSource(splitArgs("4:1"), SECRETS, vendorWith([{ type: "stock_split", ratio: "4:1", exDate: "2026-06-12" }])),
    expect: true,
  },
  {
    name: "split ratio mismatch -> reject",
    run: () =>
      runSource(splitArgs("4:1"), SECRETS, vendorWith([{ type: "stock_split", ratio: "2:1", exDate: "2026-06-12" }])),
    expect: false,
  },
  {
    name: "missing vendor URL -> reject",
    run: () => runSource(cashArgs(500000000000000000n), {}, vendorWith([{ type: "cash_dividend", amountPerShare: 0.5 }])),
    expect: false,
  },
];

let failed = 0;
for (const c of cases) {
  let got;
  try {
    got = await c.run();
  } catch (e) {
    got = `THREW: ${e.message}`;
  }
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${c.name} (got ${got}, expected ${c.expect})`);
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed > 0) process.exit(1);
