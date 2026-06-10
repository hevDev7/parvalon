/**
 * IPFS pinning seam for snapshot artifacts (PRD P1-2).
 *
 * Content-addressing the `proofs.json` lets any consumer fetch it by CID and be
 * sure the bytes match the published Merkle root — the same "anyone can re-run
 * and verify" story, extended to distribution. Pinning is the only way to keep
 * an artifact retrievable on IPFS, so we expose a small, pluggable seam.
 *
 *   - `Pinner` — the interface: `pin(bytes, name) -> { cid }`.
 *   - `HttpPinner` — a default that POSTs to a standard IPFS pinning API
 *     (Pinata-/IPFS-compatible `/pinning/pinFileToIPFS` or `/api/v0/add`) when
 *     `$IPFS_API_URL` (and optionally `$IPFS_API_KEY`) are set.
 *   - `NoopPinner` — a clear stub that logs a warning and returns no CID, used
 *     when no API is configured. Honest about being a no-op.
 *
 * `resolvePinner()` picks the right one from the environment. The artifact write
 * path stays the same whether or not pinning is enabled; on success we stamp the
 * returned CID into the artifact as `proofsCid`.
 *
 * NOTE: this performs network I/O only via the injected/global `fetch`. Tests
 * inject a fake `Pinner` (or a fake `fetch`) so nothing here touches the network.
 */

/** The result of a successful pin. */
export interface PinResult {
  /** The IPFS content identifier (CIDv0/v1 string) of the pinned bytes. */
  readonly cid: string;
}

/**
 * A pluggable pinning function. Implementations MUST be deterministic in the
 * sense that the same bytes yield the same CID (true of IPFS by construction);
 * they MUST NOT mutate the input.
 */
export interface Pinner {
  /**
   * Pin `bytes` (the serialised artifact) under a human label `name`.
   * Resolves with the CID, or rejects with a descriptive error on failure.
   */
  pin(bytes: Uint8Array, name: string): Promise<PinResult>;
}

/** Logger sink — defaults to stderr so stdout stays clean for piping. */
export type Log = (msg: string) => void;
const defaultLog: Log = (msg) => void process.stderr.write(msg + "\n");

/** Minimal `fetch` shape we depend on, so it can be faked in tests. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: Uint8Array | Blob | FormData | string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

export interface HttpPinnerOptions {
  /** Base API URL, e.g. `https://api.pinata.cloud` or a local `http://127.0.0.1:5001`. */
  readonly apiUrl: string;
  /** Optional bearer token / JWT for authenticated pinning services. */
  readonly apiKey?: string;
  /**
   * Path appended to `apiUrl`. Defaults to the Pinata-compatible
   * `/pinning/pinFileToIPFS`. For a raw Kubo node use `/api/v0/add?pin=true`.
   */
  readonly path?: string;
  /** Injected fetch (defaults to global `fetch`). */
  readonly fetchImpl?: FetchLike;
  readonly log?: Log;
}

/**
 * Default HTTP pinner. POSTs the artifact as a multipart file to an IPFS pinning
 * API and extracts the CID from the JSON response.
 *
 * It accepts the two common response shapes:
 *   - Pinata:   `{ "IpfsHash": "Qm..." , ... }`
 *   - Kubo add: `{ "Hash": "Qm...", "Name": "...", "Size": "..." }`
 * and a couple of generic fallbacks (`cid`, `Cid`).
 */
export class HttpPinner implements Pinner {
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly path: string;
  private readonly fetchImpl: FetchLike;
  private readonly log: Log;

  constructor(opts: HttpPinnerOptions) {
    this.apiUrl = opts.apiUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.path = opts.path ?? "/pinning/pinFileToIPFS";
    const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!f) {
      throw new Error(
        "HttpPinner: no fetch available (Node < 18?) — pass fetchImpl or upgrade Node",
      );
    }
    this.fetchImpl = f;
    this.log = opts.log ?? defaultLog;
  }

  async pin(bytes: Uint8Array, name: string): Promise<PinResult> {
    const url = this.apiUrl + this.path;
    const form = new FormData();
    // Copy into a fresh ArrayBuffer-backed view so Blob gets a clean buffer.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: "application/json" });
    form.append("file", blob, name);

    const headers: Record<string, string> = {};
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    this.log(`[pin] POST ${url} (${bytes.byteLength} bytes) as "${name}"`);
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: form,
    });
    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(
        `IPFS pin failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ""}`,
      );
    }
    const text = await res.text();
    const cid = extractCid(text);
    if (!cid) {
      throw new Error(
        `IPFS pin response had no recognisable CID field (IpfsHash/Hash/cid): ${truncate(text, 200)}`,
      );
    }
    this.log(`[pin] pinned as ${cid}`);
    return { cid };
  }
}

/**
 * The clear no-op. Returned when no pinning API is configured: it logs a loud
 * warning and reports that nothing was pinned, so callers omit `proofsCid`
 * rather than silently pretending it was content-addressed.
 */
export class NoopPinner implements Pinner {
  constructor(private readonly log: Log = defaultLog) {}

  async pin(_bytes: Uint8Array, _name: string): Promise<PinResult> {
    this.log(
      "[pin] WARNING: --pin-ipfs requested but no pinning API is configured " +
        "($IPFS_API_URL unset). Skipping IPFS pin; artifact written locally only " +
        "and `proofsCid` will be absent. Set $IPFS_API_URL (+ optional $IPFS_API_KEY) " +
        "to enable content-addressing.",
    );
    throw new NoPinnerConfiguredError();
  }
}

/** Thrown by {@link NoopPinner} so the CLI can treat "not configured" as a soft skip. */
export class NoPinnerConfiguredError extends Error {
  constructor() {
    super("no IPFS pinning API configured");
    this.name = "NoPinnerConfiguredError";
  }
}

/**
 * Pick a pinner from the environment:
 *   - `$IPFS_API_URL` set  → {@link HttpPinner} (with `$IPFS_API_KEY` if present),
 *   - otherwise            → {@link NoopPinner} (logs a warning, no CID).
 *
 * `env` and `fetchImpl` are injectable for tests.
 */
export function resolvePinner(opts: {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  log?: Log;
} = {}): Pinner {
  const env = opts.env ?? process.env;
  const log = opts.log ?? defaultLog;
  const apiUrl = env["IPFS_API_URL"]?.trim();
  if (apiUrl) {
    const httpOpts: HttpPinnerOptions = {
      apiUrl,
      log,
      ...(env["IPFS_API_KEY"] ? { apiKey: env["IPFS_API_KEY"] } : {}),
      ...(env["IPFS_API_PATH"] ? { path: env["IPFS_API_PATH"] } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    };
    return new HttpPinner(httpOpts);
  }
  return new NoopPinner(log);
}

/* ----------------------------- small helpers ------------------------------ */

/** Pull a CID out of the common pinning-API JSON response shapes. */
export function extractCid(responseText: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(responseText);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const obj = json as Record<string, unknown>;
  for (const key of ["IpfsHash", "Hash", "cid", "Cid", "CID"]) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return truncate(await res.text(), 300);
  } catch {
    return "";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
