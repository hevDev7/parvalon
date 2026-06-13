// Lightweight, dependency-free abuse brake for the gasless claim relay.
//
// The relay can NEVER divert funds — claim-on-behalf always pays the Merkle-bound
// `account`, never the submitter — so this bounds COST / availability (RPC quota,
// serverless compute, relayer gas), not theft. It exists to stop an open endpoint
// from being flooded.
//
// NOTE: state is in-memory and therefore per-instance; it resets on cold start and
// does not coordinate across replicas. That is a deliberate, pragmatic trade-off for
// a single-instance testnet deployment. For multi-instance production, back this with
// a shared store (e.g. Upstash/Redis) — the call sites do not change.

type Window = { count: number; resetAt: number };

const WINDOW_MS = 60_000;

const perKey = new Map<string, Window>();
const globalWindow: Window = { count: 0, resetAt: 0 };

function intFromEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Per-client requests allowed per minute (default 10). */
const PER_KEY_PER_MIN = intFromEnv("RELAY_RATELIMIT_PER_MIN", 10);
/** Total relay requests allowed per minute across all clients (default 120). */
const GLOBAL_PER_MIN = intFromEnv("RELAY_RATELIMIT_GLOBAL_PER_MIN", 120);

function bump(win: Window, now: number, limit: number): { ok: boolean; retryAfterSec: number } {
  if (now >= win.resetAt) {
    win.count = 0;
    win.resetAt = now + WINDOW_MS;
  }
  win.count += 1;
  if (win.count > limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((win.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Count one relay attempt against both a global and a per-client window.
 * Returns `ok: false` with a `retryAfterSec` hint when either window is exceeded.
 */
export function checkRateLimit(key: string, now: number = Date.now()): { ok: boolean; retryAfterSec: number } {
  // Bound memory: drop expired per-key windows once the map grows large.
  if (perKey.size > 10_000) {
    for (const [k, w] of perKey) if (now >= w.resetAt) perKey.delete(k);
  }
  const g = bump(globalWindow, now, GLOBAL_PER_MIN);
  if (!g.ok) return g;
  let win = perKey.get(key);
  if (!win) {
    win = { count: 0, resetAt: now + WINDOW_MS };
    perKey.set(key, win);
  }
  return bump(win, now, PER_KEY_PER_MIN);
}

/** Best-effort client identity from proxy headers (falls back to "unknown"). */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}
