/**
 * Alert sinks.
 *
 * A {@link Notifier} is the pluggable seam between the monitor's checks and the
 * outside world. Two concrete sinks ship:
 *
 *   - {@link ConsoleNotifier} — the default; writes structured lines to stderr
 *     (severity-tagged) so a container's log pipeline / journald picks them up.
 *   - {@link WebhookNotifier} — POSTs the alert as JSON to `$ALERT_WEBHOOK_URL`
 *     (PagerDuty Events v2, Slack/Discord incoming-webhook, Opsgenie, etc. all
 *     accept a JSON body; map fields at the receiver).
 *
 * {@link CompositeNotifier} fans out to many sinks and enforces severity
 * thresholding + per-key cooldown de-duplication, so a *persistent* invariant
 * breach pages once per cooldown window rather than on every poll.
 */
import type { Alert, Severity } from "./types.js";
import { SEVERITY_RANK } from "./types.js";

/** The sink contract. Implementations must not throw on a single bad send. */
export interface Notifier {
  /** Deliver one alert. Resolves once handed off (best-effort for webhooks). */
  notify(alert: Alert): Promise<void>;
}

/** Minimal logger seam (defaults to `console.error`), so tests can capture. */
export interface Logger {
  (line: string): void;
}

/* -------------------------------------------------------------------------- */
/*  Console sink                                                                */
/* -------------------------------------------------------------------------- */

const SEV_TAG: Record<Severity, string> = {
  page: "PAGE ",
  notify: "NOTIFY",
  info: "INFO ",
};

/**
 * Default sink: one line per alert on stderr, plus the JSON details. stdout is
 * left clean for any machine-readable summary the CLI emits.
 */
export class ConsoleNotifier implements Notifier {
  constructor(private readonly log: Logger = (l) => process.stderr.write(l + "\n")) {}

  async notify(alert: Alert): Promise<void> {
    const tag = SEV_TAG[alert.severity];
    this.log(`[${alert.at}] ${tag} ${alert.code}: ${alert.title}`);
    if (Object.keys(alert.details).length > 0) {
      this.log(`         ${JSON.stringify(alert.details, bigintReplacer)}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Webhook sink                                                                */
/* -------------------------------------------------------------------------- */

/** Injectable fetch so tests don't hit the network. Matches the global shape. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/**
 * POSTs each alert as a JSON body to a configured URL. Failures are swallowed
 * (logged via the fallback logger) — a down webhook must never crash the
 * monitor; the console sink is the durable record.
 */
export class WebhookNotifier implements Notifier {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: FetchLike = defaultFetch,
    private readonly log: Logger = (l) => process.stderr.write(l + "\n"),
  ) {}

  async notify(alert: Alert): Promise<void> {
    const body = JSON.stringify(
      {
        source: "corporax-monitor",
        severity: alert.severity,
        code: alert.code,
        title: alert.title,
        key: alert.key,
        details: alert.details,
        at: alert.at,
      },
      bigintReplacer,
    );
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (!res.ok) {
        this.log(`[webhook] non-2xx (${res.status}) delivering ${alert.code}`);
      }
    } catch (e) {
      this.log(`[webhook] delivery failed for ${alert.code}: ${errMsg(e)}`);
    }
  }
}

/** Adapts the platform `fetch` (Node >=18) to {@link FetchLike}. */
const defaultFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status };
};

/* -------------------------------------------------------------------------- */
/*  Composite sink — fan-out, thresholding, de-dup                             */
/* -------------------------------------------------------------------------- */

export interface CompositeOptions {
  /** Drop alerts below this severity entirely. Default `info`. */
  readonly minSeverity?: Severity;
  /** Suppress a repeat alert with the same `key` within this many ms. */
  readonly cooldownMs?: number;
  /** Clock seam for tests. Default `Date.now`. */
  readonly now?: () => number;
}

/**
 * Fans one alert out to every child sink, after applying a severity floor and a
 * per-key cooldown. Returns whether the alert was actually delivered (useful in
 * tests). De-dup is keyed on `alert.key`, so callers control granularity: a
 * solvency breach uses a per-token key (pages once per window), while a funding
 * anomaly uses a per-tx key (each distinct event alerts).
 */
export class CompositeNotifier implements Notifier {
  private readonly sinks: readonly Notifier[];
  private readonly minRank: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly lastSent = new Map<string, number>();

  constructor(sinks: readonly Notifier[], opts: CompositeOptions = {}) {
    this.sinks = sinks;
    this.minRank = SEVERITY_RANK[opts.minSeverity ?? "info"];
    this.cooldownMs = opts.cooldownMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** True if the alert passed the floor + cooldown and was dispatched. */
  async notifyChecked(alert: Alert): Promise<boolean> {
    if (SEVERITY_RANK[alert.severity] < this.minRank) return false;

    const t = this.now();
    const prev = this.lastSent.get(alert.key);
    if (prev !== undefined && t - prev < this.cooldownMs) return false;
    this.lastSent.set(alert.key, t);

    await Promise.all(this.sinks.map((s) => s.notify(alert)));
    return true;
  }

  async notify(alert: Alert): Promise<void> {
    await this.notifyChecked(alert);
  }
}

/* -------------------------------------------------------------------------- */
/*  utils                                                                       */
/* -------------------------------------------------------------------------- */

/** JSON replacer that renders bigint as a decimal string (wei stays exact). */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
