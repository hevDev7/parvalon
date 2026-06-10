/**
 * Unit tests for the alert sinks: console capture, webhook payload shaping,
 * and the composite sink's severity floor + per-key cooldown de-duplication.
 */
import { describe, it, expect, vi } from "vitest";

import {
  ConsoleNotifier,
  WebhookNotifier,
  CompositeNotifier,
  bigintReplacer,
  type FetchLike,
  type Notifier,
} from "./notifier.js";
import { makeAlert, type Alert } from "./types.js";

function alert(severity: Alert["severity"], key: string, code = "test"): Alert {
  return makeAlert(severity, code, key, `${code} ${key}`, { amount: 5n });
}

describe("ConsoleNotifier", () => {
  it("writes a severity-tagged line plus JSON details", async () => {
    const lines: string[] = [];
    const n = new ConsoleNotifier((l) => lines.push(l));
    await n.notify(alert("page", "solvency:0xabc", "solvency_drift"));
    expect(lines[0]).toContain("PAGE");
    expect(lines[0]).toContain("solvency_drift");
    // bigint detail serialised as a decimal string, not "[object]".
    expect(lines[1]).toContain('"amount":"5"');
  });
});

describe("bigintReplacer", () => {
  it("renders bigint as a decimal string", () => {
    expect(JSON.stringify({ x: 42n }, bigintReplacer)).toBe('{"x":"42"}');
  });
});

describe("WebhookNotifier", () => {
  it("POSTs a JSON body with the expected envelope", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, body: init.body });
      return { ok: true, status: 200 };
    };
    const n = new WebhookNotifier("https://hook.example/x", fetchImpl);
    await n.notify(alert("page", "solvency:0xabc", "solvency_drift"));

    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0]!.body);
    expect(payload.source).toBe("corporax-monitor");
    expect(payload.severity).toBe("page");
    expect(payload.code).toBe("solvency_drift");
    expect(payload.key).toBe("solvency:0xabc");
    expect(payload.details.amount).toBe("5"); // bigint -> string
  });

  it("never throws on a failed delivery; logs instead", async () => {
    const logs: string[] = [];
    const fetchImpl: FetchLike = async () => {
      throw new Error("network down");
    };
    const n = new WebhookNotifier("https://hook.example/x", fetchImpl, (l) => logs.push(l));
    await expect(n.notify(alert("notify", "k"))).resolves.toBeUndefined();
    expect(logs.join("\n")).toContain("delivery failed");
  });

  it("logs on a non-2xx response", async () => {
    const logs: string[] = [];
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 503 });
    const n = new WebhookNotifier("https://hook.example/x", fetchImpl, (l) => logs.push(l));
    await n.notify(alert("notify", "k"));
    expect(logs.join("\n")).toContain("non-2xx (503)");
  });
});

describe("CompositeNotifier", () => {
  it("fans out to every sink", async () => {
    const a: Alert[] = [];
    const b: Alert[] = [];
    const sinkA: Notifier = { notify: async (x) => void a.push(x) };
    const sinkB: Notifier = { notify: async (x) => void b.push(x) };
    const c = new CompositeNotifier([sinkA, sinkB]);
    await c.notify(alert("info", "k1"));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("drops alerts below the severity floor", async () => {
    const got: Alert[] = [];
    const sink: Notifier = { notify: async (x) => void got.push(x) };
    const c = new CompositeNotifier([sink], { minSeverity: "notify" });
    expect(await c.notifyChecked(alert("info", "k"))).toBe(false);
    expect(await c.notifyChecked(alert("notify", "k2"))).toBe(true);
    expect(await c.notifyChecked(alert("page", "k3"))).toBe(true);
    expect(got.map((g) => g.severity)).toEqual(["notify", "page"]);
  });

  it("suppresses a repeat of the same key within the cooldown, re-sends after", async () => {
    let now = 1_000;
    const got: Alert[] = [];
    const sink: Notifier = { notify: async (x) => void got.push(x) };
    const c = new CompositeNotifier([sink], { cooldownMs: 60_000, now: () => now });

    expect(await c.notifyChecked(alert("page", "solvency:0xabc"))).toBe(true);
    // Same key, 30s later → suppressed.
    now += 30_000;
    expect(await c.notifyChecked(alert("page", "solvency:0xabc"))).toBe(false);
    // Same key, past the 60s window → delivered again.
    now += 31_000;
    expect(await c.notifyChecked(alert("page", "solvency:0xabc"))).toBe(true);
    // A different key is independent.
    expect(await c.notifyChecked(alert("page", "solvency:0xdef"))).toBe(true);

    expect(got).toHaveLength(3);
  });

  it("a thrown sink does not abort the others (Promise.all semantics)", async () => {
    const good: Alert[] = [];
    const bad: Notifier = { notify: async () => void vi.fn() };
    const okSink: Notifier = { notify: async (x) => void good.push(x) };
    const c = new CompositeNotifier([bad, okSink]);
    await c.notify(alert("info", "k"));
    expect(good).toHaveLength(1);
  });
});
