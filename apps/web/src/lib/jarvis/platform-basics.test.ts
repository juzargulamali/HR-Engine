import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canonicalJson, valuesHash } from "./canonical";
import { signConfirmation, verifyConfirmation, type ConfirmationPayload } from "./token";
import { readJarvisConfig, simulatedAllowed, configUnavailableReason, DEFAULT_JARVIS_MODEL } from "./config";
import { selectProvider } from "./provider";
import { sanitiseLog } from "./log";
import { clearJarvisRegistryForTests, listJarvisActions, registerJarvisAction, resolveJarvisAction } from "./registry";
import type { AnyJarvisAction } from "./types";
import { z } from "zod";

const SECRET = "s".repeat(40);
const now = new Date("2026-11-09T10:00:00Z");
const payload = (over: Partial<ConfirmationPayload> = {}): ConfirmationPayload => ({ v: 1, cid: "c1", uid: "u1", co: "co1", act: "jarvis.sales.enquiry.create_from_brief", tgt: "new", ver: null, h: valuesHash({ a: 1 }), iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + 900, ...over });

describe("canonical values hash", () => {
  it("is the same whatever the key order, and changes with any value", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { y: 1, x: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { x: 2, y: 1 }], d: 2 }, b: 1 }));
    expect(valuesHash({ a: 1, b: undefined })).toBe(valuesHash({ a: 1 }));
    expect(valuesHash({ a: 1 })).not.toBe(valuesHash({ a: 2 }));
    expect(valuesHash({ a: "1" })).not.toBe(valuesHash({ a: 1 }));
    expect(valuesHash({ t: [{ name: "x", qty: 1 }] })).not.toBe(valuesHash({ t: [{ name: "x", qty: 2 }] }));
  });
});

describe("confirmation token", () => {
  it("round-trips a valid token and carries no brief text", () => {
    const t = signConfirmation(payload(), SECRET);
    const v = verifyConfirmation(t, SECRET, now);
    expect(v.ok && v.payload.cid).toBe("c1");
    expect(Object.keys(JSON.parse(Buffer.from(t.split(".")[0]!, "base64url").toString())).sort()).toEqual(["act", "cid", "co", "exp", "h", "iat", "tgt", "uid", "v", "ver"]);
  });
  it("rejects a tampered payload, a tampered signature, another secret, malformed and oversized input", () => {
    const t = signConfirmation(payload(), SECRET);
    const [body, sig] = t.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify(payload({ uid: "u2" }))).toString("base64url");
    expect(verifyConfirmation(`${forged}.${sig}`, SECRET, now)).toEqual({ ok: false, reason: "signature" });
    expect(verifyConfirmation(`${body}.${sig.slice(0, -2)}AA`, SECRET, now)).toEqual({ ok: false, reason: "signature" });
    expect(verifyConfirmation(t, "t".repeat(40), now)).toEqual({ ok: false, reason: "signature" });
    expect(verifyConfirmation("nonsense", SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyConfirmation("a.b.c", SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyConfirmation("x".repeat(3000), SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyConfirmation(undefined as unknown as string, SECRET, now)).toEqual({ ok: false, reason: "malformed" });
  });
  it("expires at the configured time (and not before)", () => {
    const t = signConfirmation(payload(), SECRET);
    expect(verifyConfirmation(t, SECRET, new Date(now.getTime() + 899_000)).ok).toBe(true);
    expect(verifyConfirmation(t, SECRET, new Date(now.getTime() + 900_000))).toEqual({ ok: false, reason: "expired" });
  });
  it("a token signed for a payload with a wrong shape is malformed", () => {
    const bad = signConfirmation({ ...payload(), v: 2 } as unknown as ConfirmationPayload, SECRET);
    expect(verifyConfirmation(bad, SECRET, now)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("configuration", () => {
  it("defaults: model, limits and bounds", () => {
    const c = readJarvisConfig({ ANTHROPIC_API_KEY: "k", NODE_ENV: "test" });
    expect(c).toMatchObject({ providerKind: "anthropic", model: DEFAULT_JARVIS_MODEL, maxInputChars: 6000, maxOutputTokens: 1200, timeoutMs: 20000, dailyLimit: 30, disabled: false });
    expect(c.confirmationTtlMs).toBe(15 * 60_000);
    const x = readJarvisConfig({ ANTHROPIC_API_KEY: "k", JARVIS_MODEL: "my-model", JARVIS_MAX_INPUT_CHARS: "999999", JARVIS_MAX_OUTPUT_TOKENS: "1", JARVIS_TIMEOUT_MS: "abc", JARVIS_DAILY_LIMIT_PER_USER: "0", JARVIS_CONFIRMATION_TTL_MINUTES: "500" });
    expect(x).toMatchObject({ model: "my-model", maxInputChars: 20000, maxOutputTokens: 100, timeoutMs: 20000, dailyLimit: 1 });
    expect(x.confirmationTtlMs).toBe(60 * 60_000);
  });
  it("no key = no provider = unavailable; JARVIS_DISABLED is a hard off", () => {
    const c = readJarvisConfig({ NODE_ENV: "test" });
    expect(c.providerKind).toBe("none");
    expect(configUnavailableReason(c, { needsProvider: true, needsSecret: false })).toMatch(/provider key/);
    expect(configUnavailableReason(readJarvisConfig({ ANTHROPIC_API_KEY: "k", JARVIS_DISABLED: "1" }), { needsProvider: true, needsSecret: true })).toMatch(/switched off/);
  });
  it("the confirmation secret is required in production and must be long enough", () => {
    expect(readJarvisConfig({ NODE_ENV: "production", ANTHROPIC_API_KEY: "k" }).confirmationSecret).toBeNull();
    expect(readJarvisConfig({ NODE_ENV: "production", ANTHROPIC_API_KEY: "k", JARVIS_CONFIRMATION_SECRET: "short" }).confirmationSecret).toBeNull();
    expect(readJarvisConfig({ VERCEL_ENV: "production", ANTHROPIC_API_KEY: "k" }).confirmationSecret).toBeNull();
    expect(readJarvisConfig({ NODE_ENV: "production", ANTHROPIC_API_KEY: "k", JARVIS_CONFIRMATION_SECRET: SECRET }).confirmationSecret).toBe(SECRET);
    expect(configUnavailableReason(readJarvisConfig({ NODE_ENV: "production", ANTHROPIC_API_KEY: "k" }), { needsProvider: true, needsSecret: true })).toMatch(/confirmation secret/);
    expect(readJarvisConfig({ NODE_ENV: "development", ANTHROPIC_API_KEY: "k" }).confirmationSecret).toBeTruthy();
  });
  it("the SIMULATED provider is refused in production (NODE_ENV or Vercel production) and allowed elsewhere", () => {
    expect(readJarvisConfig({ JARVIS_PROVIDER: "simulated", NODE_ENV: "test" }).providerKind).toBe("simulated");
    expect(readJarvisConfig({ JARVIS_PROVIDER: "simulated", NODE_ENV: "development" }).providerKind).toBe("simulated");
    for (const env of [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }, { NODE_ENV: "production", VERCEL_ENV: "production", VERCEL: "1" }, { NODE_ENV: "production", VERCEL_ENV: "preview" }]) {
      const c = readJarvisConfig({ JARVIS_PROVIDER: "simulated", ...env });
      expect(c.providerKind).toBe("none");
      expect(c.providerNote).toMatch(/refused in production/);
      expect(selectProvider({ ...c, providerKind: "simulated" }, { JARVIS_PROVIDER: "simulated", ...env })).toBeNull();
    }
  });
  it("the isolated local stack exception needs the explicit switch, a loopback database and NO Vercel runtime", () => {
    const base = { NODE_ENV: "production", VERCEL_ENV: "production", JARVIS_PROVIDER: "simulated", JARVIS_ALLOW_SIMULATED_ON_LOCAL_STACK: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };
    expect(simulatedAllowed(base)).toBe(true);
    expect(simulatedAllowed({ ...base, VERCEL: "1" })).toBe(false);
    expect(simulatedAllowed({ ...base, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" })).toBe(false);
    expect(simulatedAllowed({ ...base, JARVIS_ALLOW_SIMULATED_ON_LOCAL_STACK: undefined })).toBe(false);
    expect(simulatedAllowed({ ...base, NEXT_PUBLIC_SUPABASE_URL: "http://localhost.evil.com" })).toBe(false);
  });
  it("an unknown provider name selects nothing", () => {
    expect(readJarvisConfig({ JARVIS_PROVIDER: "other", ANTHROPIC_API_KEY: "k" }).providerKind).toBe("none");
  });
});

describe("operational log redaction", () => {
  it("keeps short identifier-like fields and drops anything that looks like text", () => {
    const out = sanitiseLog({ event: "propose", actionId: "jarvis.sales.enquiry.create_from_brief", outcome: "needs_input", ms: 12.4, code: "Dear Ahmed, the budget is AED 45,000 for the gala" });
    expect(out).toMatchObject({ event: "propose", actionId: "jarvis.sales.enquiry.create_from_brief", outcome: "needs_input", ms: 12 });
    expect(JSON.stringify(out)).not.toMatch(/Ahmed|budget|AED/);
    expect(out.code).toBeUndefined();
    expect(sanitiseLog({ event: "execute", outcome: "x".repeat(200) }).outcome).toBeUndefined();
  });
});

describe("registry: deny by default", () => {
  const mk = (over: Partial<AnyJarvisAction> = {}): AnyJarvisAction => ({
    id: "jarvis.sales.test.thing", module: "sales", title: "t", description: "d", risk: "read", requires: { moduleGrant: "sales" }, status: { enabled: true }, usesProvider: false,
    inputSchema: z.unknown(), valuesSchema: z.unknown(), describe: () => "x", propose: async () => ({ values: {}, target: { kind: "new" }, valid: true, card: {} }), ...over,
  });
  it("only registered AND enabled actions resolve; unknown ids and non-strings are refused", () => {
    clearJarvisRegistryForTests();
    registerJarvisAction(mk());
    registerJarvisAction(mk({ id: "jarvis.sales.test.off", status: { enabled: false, reason: "Not yet" } }));
    expect(resolveJarvisAction("jarvis.sales.test.thing").ok).toBe(true);
    expect(resolveJarvisAction("jarvis.sales.test.off")).toMatchObject({ ok: false, code: "action_disabled", reason: "Not yet" });
    for (const id of ["jarvis.sales.test.missing", "crm_create_opportunity", "", "__proto__", "constructor", 5, null, undefined, { id: "jarvis.sales.test.thing" }]) {
      expect(resolveJarvisAction(id)).toMatchObject({ ok: false, code: "unknown_action" });
    }
    expect(listJarvisActions().length).toBe(2);
  });
  it("refuses a malformed id, a wrong module prefix, a duplicate id and a disabled action without a reason", () => {
    clearJarvisRegistryForTests();
    expect(() => registerJarvisAction(mk({ id: "Sales.Thing" }))).toThrow(/Invalid/);
    expect(() => registerJarvisAction(mk({ id: "jarvis.inventory.test.thing" }))).toThrow(/own module prefix/);
    registerJarvisAction(mk());
    expect(() => registerJarvisAction(mk())).toThrow(/twice/);
    expect(() => registerJarvisAction(mk({ id: "jarvis.sales.test.nr", status: { enabled: false } }))).toThrow(/reason/);
  });
});
