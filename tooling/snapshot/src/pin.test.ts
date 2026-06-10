/**
 * Tests for the IPFS pinning seam (P1-2). No real network: a fake `fetch` is
 * injected. Covers the env-based selection, the two common response shapes, the
 * no-op stub, and CID extraction.
 */
import { describe, it, expect } from "vitest";
import {
  resolvePinner,
  extractCid,
  HttpPinner,
  NoopPinner,
  NoPinnerConfiguredError,
  type FetchLike,
} from "./index.js";

const QUIET = () => {};

function fakeFetch(
  body: string,
  status = 200,
): { fetchImpl: FetchLike; calls: Array<{ url: string; method: string }> } {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "ERR",
      text: async () => body,
    };
  };
  return { fetchImpl, calls };
}

describe("extractCid", () => {
  it("reads Pinata's IpfsHash", () => {
    expect(extractCid('{"IpfsHash":"QmPinata","PinSize":42}')).toBe("QmPinata");
  });
  it("reads Kubo's Hash", () => {
    expect(extractCid('{"Name":"f","Hash":"QmKubo","Size":"10"}')).toBe("QmKubo");
  });
  it("reads a generic cid field", () => {
    expect(extractCid('{"cid":"bafyGeneric"}')).toBe("bafyGeneric");
  });
  it("returns null for unrecognised / non-JSON bodies", () => {
    expect(extractCid("not json")).toBeNull();
    expect(extractCid('{"unrelated":1}')).toBeNull();
  });
});

describe("resolvePinner", () => {
  it("returns a NoopPinner when no $IPFS_API_URL is set", () => {
    const p = resolvePinner({ env: {}, log: QUIET });
    expect(p).toBeInstanceOf(NoopPinner);
  });

  it("returns an HttpPinner when $IPFS_API_URL is set", () => {
    const { fetchImpl } = fakeFetch('{"IpfsHash":"Qm"}');
    const p = resolvePinner({
      env: { IPFS_API_URL: "https://api.example" },
      fetchImpl,
      log: QUIET,
    });
    expect(p).toBeInstanceOf(HttpPinner);
  });
});

describe("NoopPinner", () => {
  it("warns and throws NoPinnerConfiguredError (clear soft-skip signal)", async () => {
    const logs: string[] = [];
    const p = new NoopPinner((m) => logs.push(m));
    await expect(p.pin(new Uint8Array([1, 2, 3]), "proofs.json")).rejects.toBeInstanceOf(
      NoPinnerConfiguredError,
    );
    expect(logs.join("\n")).toMatch(/no pinning API is configured/i);
  });
});

describe("HttpPinner", () => {
  it("POSTs to the pinning endpoint and returns the CID (Pinata shape)", async () => {
    const { fetchImpl, calls } = fakeFetch('{"IpfsHash":"QmAbc123"}');
    const pinner = new HttpPinner({
      apiUrl: "https://api.pinata.cloud/",
      apiKey: "jwt-token",
      fetchImpl,
      log: QUIET,
    });
    const res = await pinner.pin(new TextEncoder().encode("{}"), "proofs.json");
    expect(res.cid).toBe("QmAbc123");
    expect(calls).toHaveLength(1);
    // trailing slash on apiUrl is normalised; default path appended.
    expect(calls[0]!.url).toBe("https://api.pinata.cloud/pinning/pinFileToIPFS");
    expect(calls[0]!.method).toBe("POST");
  });

  it("honours a custom path (e.g. a raw Kubo node)", async () => {
    const { fetchImpl, calls } = fakeFetch('{"Hash":"QmKubo"}');
    const pinner = new HttpPinner({
      apiUrl: "http://127.0.0.1:5001",
      path: "/api/v0/add?pin=true",
      fetchImpl,
      log: QUIET,
    });
    const res = await pinner.pin(new TextEncoder().encode("{}"), "proofs.json");
    expect(res.cid).toBe("QmKubo");
    expect(calls[0]!.url).toBe("http://127.0.0.1:5001/api/v0/add?pin=true");
  });

  it("throws a descriptive error on a non-2xx response", async () => {
    const { fetchImpl } = fakeFetch("rate limited", 429);
    const pinner = new HttpPinner({
      apiUrl: "https://api.example",
      fetchImpl,
      log: QUIET,
    });
    await expect(
      pinner.pin(new TextEncoder().encode("{}"), "proofs.json"),
    ).rejects.toThrow(/pin failed: 429/i);
  });

  it("throws when the response has no recognisable CID", async () => {
    const { fetchImpl } = fakeFetch('{"unrelated":true}');
    const pinner = new HttpPinner({
      apiUrl: "https://api.example",
      fetchImpl,
      log: QUIET,
    });
    await expect(
      pinner.pin(new TextEncoder().encode("{}"), "proofs.json"),
    ).rejects.toThrow(/no recognisable CID/i);
  });
});
