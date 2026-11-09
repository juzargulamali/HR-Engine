import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import path from "node:path";
import { canonicalJson } from "./canonical";
import { deriveProofKey, deriveReviewKey, issueDbProof, issueReview, payloadHash, proofMac, proofRpcArgs, proofString, reviewMac, reviewString, verifyReview, type ProofFields } from "./token";
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

describe("review token (what the browser holds; verified only by this server)", () => {
  it("round-trips a valid review token and carries no brief text", () => {
    const t = issueReview(payload(), SECRET);
    const v = verifyReview(t, SECRET, now);
    expect(v.ok && v.fields.cid).toBe(CID);
    expect(Object.keys(JSON.parse(Buffer.from(t.split(".")[0]!, "base64url").toString())).sort()).toEqual(["act", "cid", "co", "exp", "ph", "tgt", "uid", "v", "ver"]);
    expect(t.split(".")[1]).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rejects a tampered body, a tampered MAC, another secret, malformed and oversized input", () => {
    const t = issueReview(payload(), SECRET);
    const [body, mac] = t.split(".") as [string, string];
    const forge = (over: Partial<ProofFields>) => `${Buffer.from(JSON.stringify({ v: 3, ...payload(over) })).toString("base64url")}.${mac}`;
    for (const over of [{ uid: "99999999-9999-4999-8999-999999999999" }, { co: "99999999-9999-4999-8999-999999999999" }, { act: "jarvis.sales.enquiry.update" }, { tgt: "99999999-9999-4999-8999-999999999999" }, { ver: 3 }, { ph: sha("other") }, { exp: payload().exp + 1 }, { cid: "99999999-9999-4999-8999-999999999999" }]) {
      expect(verifyReview(forge(over), SECRET, now)).toEqual({ ok: false, reason: "signature" });
    }
    expect(verifyReview(`${body}.${mac.slice(0, -2)}${mac.endsWith("aa") ? "bb" : "aa"}`, SECRET, now)).toEqual({ ok: false, reason: "signature" });
    expect(verifyReview(t, "t".repeat(40), now)).toEqual({ ok: false, reason: "signature" });
    expect(verifyReview("nonsense", SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReview("a.b.c", SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReview(`${body}.nothex`, SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReview("x".repeat(3000), SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReview(undefined as unknown as string, SECRET, now)).toEqual({ ok: false, reason: "malformed" });
  });
  it("expires at the configured time (and not before)", () => {
    const t = issueReview(payload(), SECRET);
    expect(verifyReview(t, SECRET, new Date(now.getTime() + 899_000)).ok).toBe(true);
    expect(verifyReview(t, SECRET, new Date(now.getTime() + 900_000))).toEqual({ ok: false, reason: "expired" });
  });
  it("a body with a wrong shape or an old format version is malformed", () => {
    const mac = reviewMac(payload(), SECRET);
    const enc = (o: unknown) => `${Buffer.from(JSON.stringify(o)).toString("base64url")}.${mac}`;
    expect(verifyReview(enc({ v: 2, ...payload() }), SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReview(enc({ v: 3, ...payload(), cid: "c1" }), SECRET, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyReview(enc({ v: 3, ...payload(), tgt: "somewhere" }), SECRET, now)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("two artefacts: a review token can never be a database proof, and a database proof can never be a review token", () => {
  const f = payload();
  it("the two keys are derived from the one secret with different labels, and differ from it and from each other", () => {
    expect(deriveProofKey(SECRET).toString("hex")).toBe(createHmac("sha256", SECRET).update("JARVIS-PROOF-KEY-V1").digest("hex"));
    expect(deriveReviewKey(SECRET).toString("hex")).toBe(createHmac("sha256", SECRET).update("JARVIS-REVIEW-KEY-V1").digest("hex"));
    expect(deriveProofKey(SECRET).equals(deriveReviewKey(SECRET))).toBe(false);
  });
  it("another domain prefix AND another key: for the very same fields the two MACs and the two signed texts differ", () => {
    expect(reviewString(f).split("\n")[0]).toBe("JARVIS-REVIEW-V1");
    expect(proofString(f).split("\n")[0]).toBe("JARVIS-PROOF-V1");
    expect(reviewString(f)).not.toBe(proofString(f));
    expect(reviewMac(f, SECRET)).not.toBe(proofMac(f, SECRET));
    // even with the same key the texts differ; even with the same text the keys differ
    expect(createHmac("sha256", deriveReviewKey(SECRET)).update(proofString(f)).digest("hex")).not.toBe(proofMac(f, SECRET));
    expect(createHmac("sha256", deriveProofKey(SECRET)).update(reviewString(f)).digest("hex")).not.toBe(reviewMac(f, SECRET));
  });
  it("the browser's review token MAC verifies as NOTHING the database accepts, and a database proof's MAC is not a review token's", () => {
    const token = issueReview(f, SECRET);
    const reviewMacHex = token.split(".")[1]!;
    const proof = issueDbProof({ cid: f.cid, uid: f.uid, co: f.co, act: f.act, tgt: f.tgt, ver: f.ver, exp: f.exp, payload: PAYLOAD }, SECRET);
    expect(reviewMacHex).not.toBe(proof.mac);
    // what the database computes for the same fields (proof key, proof domain) is not the review MAC
    expect(createHmac("sha256", deriveProofKey(SECRET)).update(proofString({ ...f, ph: payloadHash(PAYLOAD) }), "utf8").digest("hex")).toBe(proof.mac);
    expect(proof.mac).not.toBe(reviewMacHex);
    // a database proof's MAC put into a review token fails the review check
    const body = token.split(".")[0]!;
    expect(verifyReview(`${body}.${proof.mac}`, SECRET, now)).toEqual({ ok: false, reason: "signature" });
  });
  it("the database proof carries the SAME confirmation id as the review token, the exact payload text and the signed fields", () => {
    const proof = issueDbProof({ cid: f.cid, uid: f.uid, co: f.co, act: f.act, tgt: f.tgt, ver: f.ver, exp: f.exp, payload: PAYLOAD }, SECRET);
    expect(proof).toEqual({ confirmationId: CID, company: CO, target: "new", version: null, expires: f.exp, mac: proof.mac, payload: PAYLOAD });
    expect(proof.mac).toMatch(/^[0-9a-f]{64}$/);
  });
  it("the wrapper arguments are exactly the signed fields and the payload text", () => {
    const a = proofRpcArgs({ confirmationId: CID, company: CO, target: "new", version: null, expires: 5, mac: "ab", payload: PAYLOAD });
    expect(a).toEqual({ p_confirmation: CID, p_company: CO, p_target: "new", p_version: null, p_expires: 5, p_mac: "ab", p_payload: PAYLOAD });
  });
});

/** Vectors shared with the database tests (packages/rls-tests/test/jarvis-proof.rls.test.ts): the SQL verifier must accept exactly what this signer produces, and the derivations agree. */
describe("shared vectors (TypeScript signer = SQL verifier; both derivations)", () => {
  const vectors = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../supabase/tests/jarvis-proof-vectors.json"), "utf8")) as {
    secret: string;
    proofKey: string; reviewKey: string;
    derivation: { label: string; key: string }[];
    proofs: { name: string; jti: string; uid: string; co: string; exp: number; act: string; tgt: string; ver: number | null; payload: string; payloadSha256: string; canonical: string; mac: string }[];
    reviews: { name: string; jti: string; uid: string; co: string; exp: number; act: string; tgt: string; ver: number | null; payloadSha256: string; canonical: string; mac: string }[];
    hmac: { key: string; message: string; mac: string }[];
  };
  it("both key derivations match the independently computed vectors", () => {
    expect(deriveProofKey(vectors.secret).toString("hex")).toBe(vectors.proofKey);
    expect(deriveReviewKey(vectors.secret).toString("hex")).toBe(vectors.reviewKey);
    for (const d of vectors.derivation) expect(createHmac("sha256", vectors.secret).update(d.label, "utf8").digest("hex")).toBe(d.key);
  });
  it("the payload hash, the signed text and the proof MAC all match the independently computed vectors", () => {
    expect(vectors.proofs.length).toBeGreaterThanOrEqual(4);
    for (const v of vectors.proofs) {
      const f: ProofFields = { cid: v.jti, uid: v.uid, co: v.co, act: v.act, tgt: v.tgt, ver: v.ver, exp: v.exp, ph: payloadHash(v.payload) };
      expect(f.ph, v.name).toBe(v.payloadSha256);
      expect(proofString(f), v.name).toBe(v.canonical);
      expect(proofMac(f, vectors.secret), v.name).toBe(v.mac);
      expect(issueDbProof({ cid: v.jti, uid: v.uid, co: v.co, act: v.act, tgt: v.tgt, ver: v.ver, exp: v.exp, payload: v.payload }, vectors.secret).mac).toBe(v.mac);
    }
  });
  it("the review text and review MAC match their vectors, and no review MAC equals the proof MAC of the same fields", () => {
    for (const [i, v] of vectors.reviews.entries()) {
      const f: ProofFields = { cid: v.jti, uid: v.uid, co: v.co, act: v.act, tgt: v.tgt, ver: v.ver, exp: v.exp, ph: v.payloadSha256 };
      expect(reviewString(f), v.name).toBe(v.canonical);
      expect(reviewMac(f, vectors.secret), v.name).toBe(v.mac);
      expect(issueReview(f, vectors.secret).endsWith(`.${v.mac}`)).toBe(true);
      expect(v.mac).not.toBe(vectors.proofs[i]!.mac);
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
    expect(c.proofTtlMs).toBe(120_000);
    expect(readJarvisConfig({ ANTHROPIC_API_KEY: "k", JARVIS_PROOF_TTL_SECONDS: "5" }).proofTtlMs).toBe(30_000);
    expect(readJarvisConfig({ ANTHROPIC_API_KEY: "k", JARVIS_PROOF_TTL_SECONDS: "99999" }).proofTtlMs).toBe(600_000);
    expect(readJarvisConfig({ ANTHROPIC_API_KEY: "k", JARVIS_PROOF_TTL_SECONDS: "90" }).proofTtlMs).toBe(90_000);
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
