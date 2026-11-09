import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import path from "node:path";
import { canonicalJson } from "./canonical";
import { issueProof, payloadHash, proofMac, proofRpcArgs, proofString, verifyProof, type ProofFields } from "./token";
import { readJarvisConfig, simulatedAllowed, configUnavailableReason, DEFAULT_JARVIS_MODEL } from "./config";
import { selectProvider } from "./provider";
import { sanitiseLog } from "./log";
import { clearJarvisRegistryForTests, listJarvisActions, registerJarvisAction, resolveJarvisAction } from "./registry";
import type { AnyJarvisAction } from "./types";
import { z } from "zod";

const SECRET = "s".repeat(40);
const now = new Date("2026-11-09T10:00:00Z");
const CID = "11111111-1111-4111-8111-111111111111";
const UID = "22222222-2222-4222-8222-222222222222";
const CO = "33333333-3333-4333-8333-333333333333";
const PAYLOAD = canonicalJson({ b: 1, a: "x" });
const payload = (over: Partial<ProofFields> = {}): ProofFields => ({ cid: CID, uid: UID, co: CO, act: "jarvis.sales.enquiry.create_from_brief", tgt: "new", ver: null, ph: payloadHash(PAYLOAD), exp: Math.floor(now.getTime() / 1000) + 900, ...over });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("canonical payload text", () => {
  it("is the same whatever the key order, and its hash changes with any value", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { y: 1, x: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { x: 2, y: 1 }], d: 2 }, b: 1 }));
    const h = (v: unknown) => payloadHash(canonicalJson(v));
    expect(h({ a: 1, b: undefined })).toBe(h({ a: 1 }));
    expect(h({ a: 1 })).not.toBe(h({ a: 2 }));
    expect(h({ a: "1" })).not.toBe(h({ a: 1 }));
    expect(h({ t: [{ name: "x", qty: 1 }] })).not.toBe(h({ t: [{ name: "x", qty: 2 }] }));
  });
});

describe("confirmation proof (the app side of the database's proof)", () => {
  it("round-trips a valid proof and carries no brief text", () => {
    const t = issueProof(payload(), SECRET);
    const v = verifyProof(t, SECRET, now);
    expect(v.ok && v.fields.cid).toBe(CID);
    expect(v.ok && v.mac).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(JSON.parse(Buffer.from(t.split(".")[0]!, "base64url").toString())).sort()).toEqual(["act", "cid", "co", "exp", "ph", "tgt", "uid", "v", "ver"]);
  });
  it("rejects a tampered body, a tampered MAC, another secret, malformed and oversized input", () => {
    const t = issueProof(payload(), SECRET);
    const [body, mac] = t.split(".") as [string, string];
    const forge = (over: Partial<ProofFields>) => `${Buffer.from(JSON.stringify({ v: 2, ...payload(over) })).toString("base64url")}.${mac}`;
    for (const over of [{ uid: "99999999-9999-4999-8999-999999999999" }, { co: "99999999-9999-4999-8999-999999999999" }, { act: "jarvis.sales.enquiry.update" }, { tgt: "99999999-9999-4999-8999-999999999999" }, { ver: 3 }, { ph: sha("other") }, { exp: payload().exp + 1 }, { cid: "99999999-9999-4999-8999-999999999999" }]) {
      expect(verifyProof(forge(over), SECRET, now)).toEqual({ ok: false, reason: "signature" });
    }
    expect(verifyProof(`${body}.${mac.slice(0, -2)}${mac.endsWith("aa") ? "bb" : "aa"}`, SECRET, now)).toEqual({ ok: false, reason: "signature" });
    expect(verifyProof(t, "t".repeat(40), now)).toEqual({ ok: false, reason: "signature" });
    expect(verifyProof("nonsense", SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyProof("a.b.c", SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyProof(`${body}.nothex`, SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyProof("x".repeat(3000), SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyProof(undefined as unknown as string, SECRET, now)).toEqual({ ok: false, reason: "malformed" });
  });
  it("expires at the configured time (and not before)", () => {
    const t = issueProof(payload(), SECRET);
    expect(verifyProof(t, SECRET, new Date(now.getTime() + 899_000)).ok).toBe(true);
    expect(verifyProof(t, SECRET, new Date(now.getTime() + 900_000))).toEqual({ ok: false, reason: "expired" });
  });
  it("a body with a wrong shape or an old format version is malformed", () => {
    const mac = proofMac(payload(), SECRET);
    const enc = (o: unknown) => `${Buffer.from(JSON.stringify(o)).toString("base64url")}.${mac}`;
    expect(verifyProof(enc({ v: 1, ...payload() }), SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyProof(enc({ v: 2, ...payload(), cid: "c1" }), SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyProof(enc({ v: 2, ...payload(), tgt: "somewhere" }), SECRET, now)).toEqual({ ok: false, reason: "malformed" });
  });
  it("the wrapper arguments are exactly the signed fields and the payload text", () => {
    const a = proofRpcArgs({ confirmationId: CID, company: CO, target: "new", version: null, expires: 5, mac: "ab", payload: PAYLOAD });
    expect(a).toEqual({ p_confirmation: CID, p_company: CO, p_target: "new", p_version: null, p_expires: 5, p_mac: "ab", p_payload: PAYLOAD });
  });
});

/** Vectors shared with the database tests (packages/rls-tests/test/jarvis-proof.rls.test.ts): the SQL verifier must accept exactly what this signer produces. */
describe("shared proof vectors (TypeScript signer = SQL verifier)", () => {
  const vectors = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../supabase/tests/jarvis-proof-vectors.json"), "utf8")) as {
    secret: string;
    proofs: { name: string; jti: string; uid: string; co: string; exp: number; act: string; tgt: string; ver: number | null; payload: string; payloadSha256: string; canonical: string; mac: string }[];
    hmac: { key: string; message: string; mac: string }[];
  };
  it("the payload hash, the signed text and the MAC all match the independently computed vectors", () => {
    expect(vectors.proofs.length).toBeGreaterThanOrEqual(3);
    for (const v of vectors.proofs) {
      const f: ProofFields = { cid: v.jti, uid: v.uid, co: v.co, act: v.act, tgt: v.tgt, ver: v.ver, exp: v.exp, ph: payloadHash(v.payload) };
      expect(f.ph, v.name).toBe(v.payloadSha256);
      expect(proofString(f), v.name).toBe(v.canonical);
      expect(proofMac(f, vectors.secret), v.name).toBe(v.mac);
      expect(issueProof(f, vectors.secret).endsWith(`.${v.mac}`)).toBe(true);
    }
  });
  it("the plain HMAC-SHA256 vectors match Node's implementation", () => {
    for (const v of vectors.hmac) expect(createHmac("sha256", v.key).update(v.message, "utf8").digest("hex")).toBe(v.mac);
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
