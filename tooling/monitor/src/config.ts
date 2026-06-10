/**
 * Configuration resolution.
 *
 * Precedence: explicit CLI flags > environment variables > the deployments JSON
 * (`deployments/<chainId>.json`, INTEGRATION.md §6) > built-in defaults. Address
 * resolution from the deployments file means an operator only needs `RPC_URL`
 * and `--chain-id` (or `CHAIN_ID`) to point the monitor at a known deployment.
 *
 * Env var names follow INTEGRATION.md §9 where they exist (`RPC_URL`); the
 * monitor-specific names (`REGISTRY_ADDRESS`, `DISTRIBUTOR_ADDRESS`,
 * `ALERT_WEBHOOK_URL`, `POLL_INTERVAL_MS`, thresholds) are documented in README.
 */
import { readFileSync } from "node:fs";
import { isAddress, getAddress } from "viem";

import {
  type Address,
  type MonitorConfig,
  type Severity,
  type Thresholds,
  DEFAULT_THRESHOLDS,
} from "./types.js";

/** Raw flag overrides from the CLI (all optional). */
export interface CliOverrides {
  rpcUrl?: string;
  chainId?: number;
  registry?: string;
  distributor?: string;
  pollIntervalMs?: number;
  webhookUrl?: string;
  minSeverity?: string;
  deploymentsPath?: string;
  alertCooldownMs?: number;
}

/** Shape of a `deployments/<chainId>.json` registry (INTEGRATION.md §6). */
interface DeploymentFile {
  chainId: number;
  registry: string;
  distributor: string;
  actionSource?: string;
  issuer?: string;
  admin?: string;
}

/** Default poll interval: 30s — fast enough to catch a breach, gentle on RPC. */
const DEFAULT_POLL_MS = 30_000;
/** Default alert cooldown: 5 min per condition key. */
const DEFAULT_COOLDOWN_MS = 5 * 60_000;

/**
 * Resolve the full {@link MonitorConfig}. Throws (with an actionable message) if
 * a required field can't be resolved from any source.
 */
export function resolveConfig(
  overrides: CliOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): MonitorConfig {
  const rpcUrl = overrides.rpcUrl ?? env.RPC_URL ?? env.MONITOR_RPC_URL;
  if (!rpcUrl) {
    throw new Error("no RPC URL — pass --rpc <url> or set $RPC_URL");
  }

  const chainId =
    overrides.chainId ?? numEnv(env.CHAIN_ID) ?? numEnv(env.MONITOR_CHAIN_ID);

  // Address resolution: flags/env first, else the deployments file by chainId.
  let registry = pickAddress(overrides.registry ?? env.REGISTRY_ADDRESS);
  let distributor = pickAddress(overrides.distributor ?? env.DISTRIBUTOR_ADDRESS);

  let resolvedChainId = chainId;
  if ((!registry || !distributor) && chainId !== undefined) {
    const dep = loadDeployment(chainId, overrides.deploymentsPath ?? env.DEPLOYMENTS_PATH);
    if (dep) {
      registry = registry ?? pickAddress(dep.registry);
      distributor = distributor ?? pickAddress(dep.distributor);
      resolvedChainId = dep.chainId;
    }
  }

  if (!registry) {
    throw new Error(
      "no registry address — pass --registry, set $REGISTRY_ADDRESS, or provide --chain-id with a deployments/<chainId>.json",
    );
  }
  if (!distributor) {
    throw new Error(
      "no distributor address — pass --distributor, set $DISTRIBUTOR_ADDRESS, or provide --chain-id with a deployments/<chainId>.json",
    );
  }
  if (resolvedChainId === undefined) {
    throw new Error("no chain id — pass --chain-id or set $CHAIN_ID");
  }

  const webhookUrl = overrides.webhookUrl ?? env.ALERT_WEBHOOK_URL;
  const minSeverity = parseSeverity(overrides.minSeverity ?? env.MIN_SEVERITY) ?? "info";

  const config: MonitorConfig = {
    rpcUrl,
    chainId: resolvedChainId,
    registry,
    distributor,
    pollIntervalMs:
      overrides.pollIntervalMs ?? numEnv(env.POLL_INTERVAL_MS) ?? DEFAULT_POLL_MS,
    minSeverity,
    alertCooldownMs:
      overrides.alertCooldownMs ?? numEnv(env.ALERT_COOLDOWN_MS) ?? DEFAULT_COOLDOWN_MS,
    thresholds: resolveThresholds(env),
    expectedFunders: parseAddressList(env.EXPECTED_FUNDERS),
    ...(webhookUrl !== undefined ? { webhookUrl } : {}),
  };
  return config;
}

/** Merge threshold env overrides over the defaults. */
export function resolveThresholds(env: NodeJS.ProcessEnv): Thresholds {
  return {
    maxRatePerShare: bigEnv(env.MAX_RATE_PER_SHARE) ?? DEFAULT_THRESHOLDS.maxRatePerShare,
    maxTotalPayout: bigEnv(env.MAX_TOTAL_PAYOUT) ?? DEFAULT_THRESHOLDS.maxTotalPayout,
    largeFundingRatio: floatEnv(env.LARGE_FUNDING_RATIO) ?? DEFAULT_THRESHOLDS.largeFundingRatio,
    maxClaimRevertRate: floatEnv(env.MAX_CLAIM_REVERT_RATE) ?? DEFAULT_THRESHOLDS.maxClaimRevertRate,
    minClaimAttemptsForRate:
      numEnv(env.MIN_CLAIM_ATTEMPTS) ?? DEFAULT_THRESHOLDS.minClaimAttemptsForRate,
    largeSweepRemainderRatio:
      floatEnv(env.LARGE_SWEEP_REMAINDER_RATIO) ?? DEFAULT_THRESHOLDS.largeSweepRemainderRatio,
    earlySweepWindowSecs:
      numEnv(env.EARLY_SWEEP_WINDOW_SECS) ?? DEFAULT_THRESHOLDS.earlySweepWindowSecs,
  };
}

/* -------------------------------- helpers --------------------------------- */

function loadDeployment(chainId: number, path?: string): DeploymentFile | undefined {
  const candidates = path
    ? [path]
    : [
        // From the package dir, the repo's deployments live two levels up.
        new URL(`../../../deployments/${chainId}.json`, import.meta.url).pathname,
        // From dist/ the same relative climb holds (dist is a sibling of src).
        new URL(`../../../../deployments/${chainId}.json`, import.meta.url).pathname,
      ];
  for (const c of candidates) {
    try {
      const raw = readFileSync(c, "utf8");
      const parsed = JSON.parse(raw) as DeploymentFile;
      if (parsed && parsed.registry && parsed.distributor) return parsed;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

function pickAddress(v: string | undefined): Address | undefined {
  if (!v) return undefined;
  if (!isAddress(v)) throw new Error(`not a valid address: ${v}`);
  return getAddress(v).toLowerCase() as Address;
}

function parseAddressList(v: string | undefined): readonly Address[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      if (!isAddress(s)) throw new Error(`not a valid address in list: ${s}`);
      return getAddress(s).toLowerCase() as Address;
    });
}

function parseSeverity(v: string | undefined): Severity | undefined {
  if (v === "page" || v === "notify" || v === "info") return v;
  return undefined;
}

function numEnv(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function floatEnv(v: string | undefined): number | undefined {
  return numEnv(v);
}

function bigEnv(v: string | undefined): bigint | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  try {
    return BigInt(v);
  } catch {
    return undefined;
  }
}
