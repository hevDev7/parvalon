// =============================================================================
// CorporaX — Chainlink Functions source (the script the DON runs off-chain)
//
// Purpose: independently verify that a corporate action a CorporaX issuer is about
// to announce on-chain is AUTHENTIC according to a licensed market-data vendor,
// and return a single boolean verdict.
//
// SECURITY MODEL — why this only returns a bool:
//   The action's `dataHash` is computed ON-CHAIN by FunctionsActionSource from the
//   exact fields it sends to the DON, and the attestation is keyed by that hash.
//   So the DON cannot be tricked into vouching for fields it did not verify, and it
//   does NOT need keccak/abi-encoding (unavailable in the restricted runtime). It
//   only answers: "does this declared action match the vendor's record?"
//
// REQUEST ARGS (set by FunctionsActionSource via the FunctionsRequest builder):
//   args[0] asset            (address, context/logging)
//   args[1] actionType       (uint8 as string: 0=CASH_DIVIDEND, 1=STOCK_SPLIT, 2=STOCK_DIVIDEND)
//   args[2] ratePerShareWei  (uint256 string; payout-token units per 1e18 shares)
//   args[3] recordBlock      (uint64 string)
//   args[4] payableAt        (unix seconds string)
//   args[5] claimDeadline    (unix seconds string)
//   args[6] payoutToken      (address)
//   args[7] ticker           (e.g. "TSLA")
//   args[8] exDate           (ISO date "YYYY-MM-DD")
//   args[9] splitRatio       (optional, "N:M" for STOCK_SPLIT/STOCK_DIVIDEND)
//
// SECRETS (DON-hosted or user-hosted secrets):
//   secrets.vendorUrl   base URL of the corporate-actions data vendor
//   secrets.vendorApiKey bearer token for the vendor
//
// RETURN: Functions.encodeUint256(1) if authentic, else Functions.encodeUint256(0).
//   The contract decodes this as a Solidity bool (1 => true, 0 => false).
// =============================================================================

const CASH_DIVIDEND = 0;
const STOCK_SPLIT = 1;
const STOCK_DIVIDEND = 2;

// Tolerances: vendor amounts are decimals; on-chain rate is wei per 1e18 share.
const RATE_TOLERANCE = 0.005; // half a cent per share
const ONE = 1000000000000000000n; // 1e18

function notAuthentic(reason) {
  console.log(`CorporaX attestation: NOT authentic — ${reason}`);
  return Functions.encodeUint256(0);
}

function authentic() {
  console.log("CorporaX attestation: authentic");
  return Functions.encodeUint256(1);
}

const actionType = Number(args[1]);
const ratePerShareWei = BigInt(args[2] || "0");
const ticker = (args[7] || "").toUpperCase();
const exDate = args[8] || "";
const splitRatio = args[9] || "";

if (!ticker) return notAuthentic("missing ticker");

const vendorUrl = secrets.vendorUrl;
const vendorApiKey = secrets.vendorApiKey;
if (!vendorUrl) return notAuthentic("vendor URL not configured in secrets");

// Pull the vendor's recent corporate actions for this ticker.
const resp = await Functions.makeHttpRequest({
  url: `${vendorUrl}/corporate-actions`,
  method: "GET",
  headers: vendorApiKey ? { Authorization: `Bearer ${vendorApiKey}` } : {},
  params: { ticker, limit: 50 },
  timeout: 9000,
});

if (resp.error) return notAuthentic(`vendor request failed: ${resp.status || "network"}`);

const records = (resp.data && (resp.data.actions || resp.data.data || resp.data)) || [];
if (!Array.isArray(records)) return notAuthentic("unexpected vendor payload shape");

// Normalize a vendor record's ex-date to YYYY-MM-DD for comparison.
const dayOf = (v) => (v ? String(v).slice(0, 10) : "");

if (actionType === CASH_DIVIDEND) {
  const expectedRate = Number(ratePerShareWei) / Number(ONE); // payout-token (≈USD) per share
  const match = records.find((r) => {
    const type = String(r.type || r.actionType || "").toLowerCase();
    const amt = Number(r.amountPerShare ?? r.cashAmount ?? r.rate ?? NaN);
    const isCash = type.includes("cash") || type.includes("dividend");
    const rateOk = Number.isFinite(amt) && Math.abs(amt - expectedRate) <= RATE_TOLERANCE;
    const dateOk = !exDate || dayOf(r.exDate ?? r.exDividendDate ?? r.ex_date) === exDate;
    return isCash && rateOk && dateOk;
  });
  return match ? authentic() : notAuthentic(`no matching cash dividend (rate≈${expectedRate}, ex=${exDate})`);
}

if (actionType === STOCK_SPLIT || actionType === STOCK_DIVIDEND) {
  const want = splitRatio.replace(/\s/g, "");
  const match = records.find((r) => {
    const type = String(r.type || r.actionType || "").toLowerCase();
    const isSplit =
      actionType === STOCK_SPLIT ? type.includes("split") : type.includes("stock") && type.includes("dividend");
    const ratio = String(r.ratio ?? `${r.newShares ?? ""}:${r.oldShares ?? ""}`).replace(/\s/g, "");
    const ratioOk = !want || ratio === want;
    const dateOk = !exDate || dayOf(r.exDate ?? r.ex_date) === exDate;
    return isSplit && ratioOk && dateOk;
  });
  return match ? authentic() : notAuthentic(`no matching split/stock-dividend (ratio=${want}, ex=${exDate})`);
}

return notAuthentic(`unsupported actionType ${actionType}`);
