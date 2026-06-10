// Chainlink Functions request configuration (CommonJS — the Functions toolkit
// `npx env-enc`/`functions simulate`/deploy scripts consume this shape).
//
// Usage with the Chainlink Functions toolkit:
//   1. Set DON-hosted secrets (vendorUrl, vendorApiKey).
//   2. Build the CBOR request from this config; set it on the contract via
//      FunctionsActionSource.setRequestData(...).
//   3. Per action, the contract supplies `args` (see the source header) when it
//      calls requestAttestation(...). The DON runs `source` with those args.
//
// NOTE: `args` here is a placeholder shape for simulation/local runs; in
// production the args are injected per-request by FunctionsActionSource.

const fs = require("fs");
const path = require("path");

const Location = { Inline: 0, Remote: 1, DONHosted: 2 };
const CodeLanguage = { JavaScript: 0 };
const ReturnType = { uint: "uint256", uint256: "uint256", int: "int256", string: "string", bytes: "Buffer" };

const requestConfig = {
  source: fs.readFileSync(path.join(__dirname, "corporate-action-source.js")).toString(),
  codeLocation: Location.Inline,
  codeLanguage: CodeLanguage.JavaScript,
  // Secrets are DON-hosted in production (never inline). Provide via the toolkit.
  secrets: { vendorUrl: process.env.VENDOR_URL || "", vendorApiKey: process.env.VENDOR_API_KEY || "" },
  secretsLocation: Location.DONHosted,
  perNodeSecrets: [],
  walletPrivateKey: process.env.PRIVATE_KEY,
  // Example args for a local simulate run (TSLA, 0.50 USDG cash dividend).
  args: [
    "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", // asset
    "0", // actionType = CASH_DIVIDEND
    "500000000000000000", // ratePerShareWei (0.5)
    "100", // recordBlock
    "1781110880", // payableAt
    "0", // claimDeadline
    "0x5FbDB2315678afecb367f032d93F642f64180aa3", // payoutToken (USDG)
    "TSLA", // ticker
    "2026-06-12", // exDate
    "", // splitRatio (n/a for cash dividend)
  ],
  expectedReturnType: ReturnType.uint256,
  // Funded billing subscription + DON id are set per network; see functions/README.md.
};

module.exports = requestConfig;
