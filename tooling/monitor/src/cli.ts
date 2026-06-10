#!/usr/bin/env node
/**
 * `corporax-monitor` — the CorporaX monitoring & alerting service (P0-6).
 *
 * Commands:
 *
 *   start    Run the monitoring service: poll the solvency invariant + pause
 *            state every interval, and subscribe to CAE-1 lifecycle / funding /
 *            claim / sweep events, dispatching alerts to the configured sinks.
 *
 *   check    Run a single solvency/state sweep, print the per-token result, and
 *            exit non-zero if any invariant is violated. A CI / cron health gate.
 *
 * Config comes from flags > env > deployments JSON > defaults (see config.ts).
 * stdout carries machine-readable summaries; all diagnostics go to stderr.
 */
import { Command, InvalidArgumentError } from "commander";

import { resolveConfig, type CliOverrides } from "./config.js";
import {
  ConsoleNotifier,
  WebhookNotifier,
  CompositeNotifier,
  type Notifier,
} from "./notifier.js";
import { Monitor } from "./monitor.js";
import { checkSolvency } from "./checks.js";

const err = (msg: string): void => void process.stderr.write(msg + "\n");
const out = (msg: string): void => void process.stdout.write(msg + "\n");

/* ------------------------------ arg parsers ------------------------------- */

function parseIntArg(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidArgumentError(`expected a non-negative integer, got: ${value}`);
  }
  return n;
}

/** Build the composite notifier (console always; webhook if configured). */
function buildNotifier(cfg: ReturnType<typeof resolveConfig>): CompositeNotifier {
  const sinks: Notifier[] = [new ConsoleNotifier()];
  if (cfg.webhookUrl) {
    sinks.push(new WebhookNotifier(cfg.webhookUrl));
    err(`[monitor] webhook sink enabled -> ${cfg.webhookUrl}`);
  }
  return new CompositeNotifier(sinks, {
    minSeverity: cfg.minSeverity,
    cooldownMs: cfg.alertCooldownMs,
  });
}

/** Collect shared flag overrides into a {@link CliOverrides}. */
function overridesFrom(opts: Record<string, unknown>): CliOverrides {
  const o: CliOverrides = {};
  if (typeof opts.rpc === "string") o.rpcUrl = opts.rpc;
  if (typeof opts.chainId === "number") o.chainId = opts.chainId;
  if (typeof opts.registry === "string") o.registry = opts.registry;
  if (typeof opts.distributor === "string") o.distributor = opts.distributor;
  if (typeof opts.interval === "number") o.pollIntervalMs = opts.interval;
  if (typeof opts.webhook === "string") o.webhookUrl = opts.webhook;
  if (typeof opts.minSeverity === "string") o.minSeverity = opts.minSeverity;
  if (typeof opts.deployments === "string") o.deploymentsPath = opts.deployments;
  return o;
}

/* -------------------------------- program --------------------------------- */

const program = new Command();
program
  .name("corporax-monitor")
  .description("Monitoring & alerting for the CorporaX corporate-actions protocol.")
  .version("1.0.0");

const shared = (c: Command): Command =>
  c
    .option("--rpc <url>", "RPC URL (overrides $RPC_URL); ws(s):// enables event push")
    .option("--chain-id <n>", "chain id (resolves addresses from deployments/<id>.json)", parseIntArg)
    .option("--registry <addr>", "registry address (overrides $REGISTRY_ADDRESS)")
    .option("--distributor <addr>", "distributor address (overrides $DISTRIBUTOR_ADDRESS)")
    .option("--webhook <url>", "alert webhook URL (overrides $ALERT_WEBHOOK_URL)")
    .option("--min-severity <level>", "min severity to emit: info|notify|page")
    .option("--deployments <path>", "explicit path to a deployments/<id>.json");

shared(program.command("start"))
  .description("Run the monitoring service (poll loop + event subscription).")
  .option("--interval <ms>", "poll interval in milliseconds (overrides $POLL_INTERVAL_MS)", parseIntArg)
  .action(async (opts: Record<string, unknown>) => {
    try {
      const cfg = resolveConfig(overridesFrom(opts));
      const notifier = buildNotifier(cfg);
      const monitor = new Monitor(cfg, notifier);

      const shutdown = (): void => {
        err("\n[monitor] shutting down...");
        monitor.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      await monitor.start();
    } catch (e) {
      err(`[start] ERROR: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  });

shared(program.command("check"))
  .description("One-shot solvency/state sweep; exit non-zero on any violation.")
  .action(async (opts: Record<string, unknown>) => {
    try {
      const cfg = resolveConfig(overridesFrom(opts));
      const notifier = buildNotifier(cfg);
      const monitor = new Monitor(cfg, notifier);

      const snap = await monitor.readSnapshot();
      const { results, alerts } = checkSolvency(snap.actions, snap.balances);

      for (const r of results) {
        err(
          `[check] token=${r.token} balance=${r.balance} obligation=${r.obligation} ` +
            `surplus=${r.surplus} ${r.solvent ? "OK" : "INSOLVENT"}`,
        );
      }
      err(`[check] registryPaused=${snap.registryPaused} distributorPaused=${snap.distributorPaused}`);

      if (alerts.length === 0) {
        out("OK");
        return;
      }
      for (const a of alerts) await notifier.notify(a);
      out("VIOLATION");
      process.exitCode = 1;
    } catch (e) {
      err(`[check] ERROR: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
