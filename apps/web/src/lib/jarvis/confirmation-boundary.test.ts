import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { crmToday } from "@enginious-hr/domain";
import { registerAllJarvisActions } from "./actions";
import { createAssistant, type JarvisAssistant } from "./assistant";
import type { ActionConfirmResult, EnquiryCard, SendResult } from "./protocol";
import { simulatedProviderCalls } from "./provider/simulated";
import { fakeDeps, ID, mkOpp, newWorld, sha, SECRET, type Opp, type World } from "./testing/fake-world";

/**
 * The confirmation boundary as the APP sees it (the database's own checks are proved in packages/rls-tests/test/jarvis-proof.rls.test.ts; the fake database here runs the same rules):
 *   * a tampered, expired, replayed (= original result) or wrong-user token is refused BEFORE any write RPC is called;
 *   * the payload text sent to the wrapper is exactly the text the proof's hash covers (byte for byte), for every write action;
 *   * a changed value needs a NEW proof; an old proof cannot be reused with a modified payload;
 *   * a database without the key, with another key, or with a clock past the expiry refuses and nothing is written.
 */
let w: World;
let a: JarvisAssistant;
let e: Opp;
const make = (over: Parameters<typeof fakeDeps>[1] = {}) => createAssistant(fakeDeps(w, over));
beforeAll(() => registerAllJarvisActions());
beforeEach(() => {
  w = newWorld(); a = make(); simulatedProviderCalls.length = 0;
  e = mkOpp({ company_id: ID.co1, title: "Harbour gala LED wall", stage: "qualified", owner_id: ID.u1, version: 4, value: 987654, location: "Harbour Hall" });
  w.opps.push(e);
});

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const FUTURE = addDays(crmToday(), 3);
const WRITES = ["jarvis_create_enquiry", "jarvis_register_organisation", "jarvis_update_enquiry", "jarvis_change_stage", "jarvis_record_meeting"];
const writeCalls = () => w.rpcLog.filter((c) => WRITES.includes(c.name));
const body = (t: string) => JSON.parse(Buffer.from(t.split(".")[0]!, "base64url").toString()) as { ph: string; cid: string; exp: number };
const keyOf = (secret: string) => createHmac("sha256", secret).update("JARVIS-PROOF-KEY-V1").digest();
const refusal = <T extends { ok: boolean }>(r: T) => { if (r.ok) throw new Error(`expected a refusal, got ${JSON.stringify(r).slice(0, 200)}`); return r as Extract<T, { ok: false }> & { code: string; message: string }; };
type Ready = { card: { values: unknown }; id: string; token: string; actionId: string };

async function propose(kind: "create" | "update" | "stage" | "meeting" | "org"): Promise<Ready> {
  if (kind === "create") {
    const brief = `Title: Harbour gala LED wall\nAgency: Fictional Wave Agency\nClient: Fictional Harbour Brands\nSource: WhatsApp\nBudget: AED 45,000\nLocation: Harbour Hall\nNext: Call to qualify on ${FUTURE}`;
    const r = (await a.send({ companyId: ID.co1, text: brief })) as SendResult;
    if (!r.ok || r.kind !== "card" || !r.confirmation) throw new Error(`no card ${JSON.stringify(r).slice(0, 200)}`);
    return { card: r.card as EnquiryCard, ...r.confirmation, actionId: "jarvis.sales.enquiry.create_from_brief" };
  }
  const sent = kind === "update" ? await a.send({ companyId: ID.co1, text: "Location: Marina Arena", intent: "update", enquiryId: e.id })
    : kind === "stage" ? await a.send({ companyId: ID.co1, text: "move this to proposal prep", intent: "stage", enquiryId: e.id })
    : kind === "meeting" ? await a.send({ companyId: ID.co1, text: `Type: meeting\nSummary: Met the agency about the gala.\nNext: Send the proposal on ${FUTURE}`, intent: "meeting", enquiryId: e.id })
    : await a.act({ companyId: ID.co1, actionId: "jarvis.sales.organisation.register", input: { mode: "details", name: "Fictional Lantern Events", fields: { roles: ["agency"], country: "AE" } } });
  if (!sent.ok || sent.kind !== "action" || !sent.confirmation) throw new Error(`no action card ${JSON.stringify(sent).slice(0, 200)}`);
  return { card: sent.card as { values: unknown }, ...sent.confirmation, actionId: (sent.card as unknown as { actionId?: string }).actionId ?? ({ update: "jarvis.sales.enquiry.update", stage: "jarvis.sales.enquiry.change_stage", meeting: "jarvis.sales.meeting.record", org: "jarvis.sales.organisation.register" } as const)[kind] };
}
const confirm = (r: Ready, over: { values?: unknown; companyId?: string; token?: string } = {}): Promise<ActionConfirmResult> =>
  r.actionId === "jarvis.sales.enquiry.create_from_brief"
    ? (a.confirm({ companyId: over.companyId ?? ID.co1, token: over.token ?? r.token, values: over.values ?? r.card.values }) as unknown as Promise<ActionConfirmResult>)
    : a.confirmAction({ companyId: over.companyId ?? ID.co1, actionId: r.actionId, token: over.token ?? r.token, values: over.values ?? r.card.values });

describe.each(["create", "update", "stage", "meeting", "org"] as const)("%s: the review token is not the database proof; the exact proof reaches the wrapper", (kind) => {
  it("the payload text sent is the reviewed text (plus the verified acknowledgement); the proof is NEW (not the review MAC), with the same jti, a short expiry and the signed company, target and version", async () => {
    const r = await propose(kind);
    const before = Math.floor(Date.now() / 1000);
    const c = await confirm(r);
    expect(c.ok, JSON.stringify(c)).toBe(true);
    const sent = writeCalls();
    expect(sent).toHaveLength(1);
    const args = sent[0]!.args as { p_confirmation: string; p_company: string; p_target: string; p_version: number | null; p_expires: number; p_mac: string; p_payload: string };
    expect(args.p_confirmation).toBe(r.id);
    const sentPayload = JSON.parse(args.p_payload) as Record<string, unknown>;
    if (kind === "org") {
      // the verified acknowledgement is part of the signed text; everything else is exactly what was reviewed
      const { acknowledged_org_ids: ack, ...rest } = sentPayload;
      expect(ack).toEqual([]);
      expect(sha(JSON.stringify(Object.fromEntries(Object.entries(rest).sort(([x], [y]) => (x < y ? -1 : 1)))))).toBe(body(r.token).ph);
    } else expect(sha(args.p_payload)).toBe(body(r.token).ph);
    // TWO ARTEFACTS: what the browser held is not what the database got
    expect(args.p_mac).not.toBe(r.token.split(".")[1]);
    expect(args.p_company).toBe(ID.co1);
    expect(args.p_expires).toBeGreaterThanOrEqual(before + 119);
    expect(args.p_expires).toBeLessThanOrEqual(before + 125);
    expect(args.p_expires).toBeLessThan(body(r.token).exp);
    expect(args.p_target).toBe(kind === "create" || kind === "org" ? "new" : e.id);
    expect(args.p_version).toBe(kind === "update" || kind === "stage" ? 4 : null);
    // nothing the caller could add: no user id, no hash, no unsigned acknowledgement parameter
    expect(Object.keys(args).sort()).toEqual(["p_company", "p_confirmation", "p_expires", "p_mac", "p_payload", "p_target", "p_version"]);
  });
  it("the proposal response holds NO string that verifies as a database proof (the SQL-equivalent verifier is run over every string in it), and the confirm response and logs hold none either", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await propose(kind);
      const proposeResponse = JSON.stringify(r);
      const out = await confirm(r);
      expect(out.ok).toBe(true);
      const args = writeCalls()[0]!.args as { p_mac: string; p_payload: string; p_confirmation: string };
      // the database proof the server issued for this very call, as it exists only inside the server-to-database call
      expect(args.p_mac).toMatch(/^[0-9a-f]{64}$/);
      const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
      const candidates = (json: string) => strings(JSON.parse(json)).flatMap((s) => [s, ...s.split("."), ...(s.match(/[0-9a-f]{64}/g) ?? [])]);
      for (const where of [proposeResponse, JSON.stringify(out), log.mock.calls.map((c) => String(c[0])).join("\n") && JSON.stringify(log.mock.calls.map((c) => String(c[0]))), JSON.stringify(err.mock.calls.map((c) => String(c[0])))]) {
        expect(where).not.toContain(args.p_mac);
        expect(candidates(where)).not.toContain(args.p_mac);
      }
      // the token the browser held verifies as a proof in NO wrapper: the database's check (proof key, proof domain) over the same fields gives another MAC
      const tok = body(r.token) as { cid: string; uid: string; co: string; act: string; tgt: string; ver: number | null; exp: number; ph: string };
      const proofText = ["JARVIS-PROOF-V1", tok.cid, tok.uid, tok.co, tok.act, tok.tgt, tok.ver === null ? "-" : String(tok.ver), String(tok.exp), tok.ph].join("\n");
      const dbCheck = createHmac("sha256", keyOf(SECRET)).update(proofText).digest("hex");
      expect(r.token.split(".")[1]).not.toBe(dbCheck);
      for (const s of candidates(proposeResponse)) if (/^[0-9a-f]{64}$/.test(s)) expect(s, "a string in the propose response that is a proof MAC").not.toBe(dbCheck);
    } finally { log.mockRestore(); err.mockRestore(); }
  });
});

describe("refused in the app BEFORE any write RPC", () => {
  it("a tampered MAC, a tampered body, an expired token, another person's token and garbage never reach the database", async () => {
    const r = await propose("update");
    const [b, mac] = r.token.split(".") as [string, string];
    const flip = (x: string) => x.slice(0, -1) + (x.endsWith("a") ? "b" : "a");
    expect(refusal(await confirm(r, { token: `${b}.${flip(mac)}` })).code).toBe("token_invalid");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, "base64url").toString()), ver: 99 })).toString("base64url");
    expect(refusal(await confirm(r, { token: `${forged}.${mac}` })).code).toBe("token_invalid");
    expect(refusal(await confirm(r, { token: "x.y" })).code).toBe("token_invalid");
    expect(refusal(await make({ now: () => new Date(Date.now() + 16 * 60_000) }).confirmAction({ companyId: ID.co1, actionId: r.actionId, token: r.token, values: r.card.values })).code).toBe("token_expired");
    w.grants.push({ user_id: ID.u2, company_id: ID.co1, capabilities: [], revoked_at: null });
    w.signedIn = ID.u2;
    expect(refusal(await confirm(r)).code).toBe("token_invalid");
    expect(writeCalls()).toHaveLength(0);
  });
  it("an edited value needs a NEW proof: the old proof cannot be reused with a modified payload, and a new review issues a different proof", async () => {
    const r = await propose("update");
    const v = r.card.values as { patch: Record<string, unknown> };
    expect(refusal(await confirm(r, { values: { ...v, patch: { ...v.patch, location: "Somewhere else" } } })).code).toBe("values_changed");
    expect(writeCalls()).toHaveLength(0);
    const again = await a.act({ companyId: ID.co1, actionId: r.actionId, input: { mode: "revise", enquiryId: e.id, fields: { location: "Somewhere else" } } });
    if (!again.ok || again.kind !== "action" || !again.confirmation) throw new Error("no new proof");
    expect(again.confirmation.token).not.toBe(r.token);
    expect(again.confirmation.id).not.toBe(r.id);
    expect(body(again.confirmation.token).ph).not.toBe(body(r.token).ph);
    expect((await a.confirmAction({ companyId: ID.co1, actionId: r.actionId, token: again.confirmation.token, values: (again.card as { values: unknown }).values })).ok).toBe(true);
  });
  it("a replay of a valid proof returns the ORIGINAL result and writes nothing more", async () => {
    const r = await propose("stage");
    const first = await confirm(r);
    const again = await confirm(r);
    expect(first.ok && again.ok && again.replayed && again.reference === first.reference).toBe(true);
    expect(w.moves).toHaveLength(1);
  });
});

describe("the confirmation request issues the database proof ONLY after re-verification: every failure causes NO write RPC", () => {
  it("a wrong user, wrong company, wrong action (a token for one action presented to another), a changed value or an expired review: no RPC call at all", async () => {
    const r = await propose("update");
    const stage = await propose("stage");
    w.grants.push({ user_id: ID.u2, company_id: ID.co1, capabilities: [], revoked_at: null });
    // wrong action
    expect(refusal(await a.confirmAction({ companyId: ID.co1, actionId: stage.actionId, token: r.token, values: stage.card.values })).code).toBe("token_invalid");
    // wrong company (the person has a grant for both: the token is still bound to the first)
    expect(refusal(await confirm(r, { companyId: ID.co2 })).code).toBe("company_changed");
    // changed value
    const v = r.card.values as { patch: Record<string, unknown> };
    expect(refusal(await confirm(r, { values: { ...v, patch: { ...v.patch, location: "Elsewhere" } } })).code).toBe("values_changed");
    // another person
    w.signedIn = ID.u2;
    expect(refusal(await confirm(r)).code).toBe("token_invalid");
    w.signedIn = ID.u1;
    // review expired
    expect(refusal(await make({ now: () => new Date(Date.now() + 16 * 60_000) }).confirmAction({ companyId: ID.co1, actionId: r.actionId, token: r.token, values: r.card.values })).code).toBe("token_expired");
    expect(writeCalls()).toHaveLength(0);
  });
  it("revoked access (module grant, pilot membership, write switch, the pilot switch itself) between the review and the confirmation: no RPC call, nothing written", async () => {
    for (const revoke of [
      () => { w.grants.length = 0; },
      () => { w.pilot.delete(ID.u1); },
      () => { w.settings.writes = false; },
      () => { w.settings.enabled = false; },
    ]) {
      w = newWorld(); a = make(); w.opps.push(e);
      const r = await propose("update");
      revoke();
      expect(refusal(await confirm(r)).ok).toBe(false);
      expect(writeCalls()).toHaveLength(0);
    }
  });
  it("the record changed after the review (its version moved on): no RPC call; the stale review is not sent to the database", async () => {
    const r = await propose("update");
    e.version = (e.version ?? 1) + 1;
    expect(refusal(await confirm(r)).ok).toBe(false);
    expect(writeCalls()).toHaveLength(0);
  });
  it("a duplicate organisation that appeared after the review: no RPC call; and an acknowledgement for something else is refused before any proof is issued", async () => {
    const r = await propose("org");
    w.orgs.push({ id: "00000000-0000-4000-8000-0000000000cc", name: "Fictional Lantern Events", kind: "agency", roles: ["agency"], place: null, name_key: "fictionallanternevents", archived_at: null });
    expect(refusal(await a.confirmAction({ companyId: ID.co1, actionId: r.actionId, token: r.token, values: r.card.values })).code).toBe("needs_review");
    expect(refusal(await a.confirmAction({ companyId: ID.co1, actionId: r.actionId, token: r.token, values: r.card.values, acknowledgements: { matchIds: ["00000000-0000-4000-8000-0000000000dd"] } })).code).toBe("needs_review");
    expect(writeCalls()).toHaveLength(0);
    // only the exact acknowledgement gets a proof, and it is signed INTO the payload text
    expect((await a.confirmAction({ companyId: ID.co1, actionId: r.actionId, token: r.token, values: r.card.values, acknowledgements: { matchIds: ["00000000-0000-4000-8000-0000000000cc"] } })).ok).toBe(true);
    expect(JSON.parse((writeCalls()[0]!.args as { p_payload: string }).p_payload).acknowledged_org_ids).toEqual(["00000000-0000-4000-8000-0000000000cc"]);
  });
});

describe("safe retries keep the same confirmation id", () => {
  it("a timeout (lost answer) then a retry with the SAME review token: a FRESH proof, the SAME jti, the ORIGINAL result, nothing written twice", async () => {
    const r = await propose("create");
    w.createMode = "lost";
    const first = await confirm(r);
    expect(refusal(first).code).toBe("ambiguous");
    expect((first as { confirmationId?: string }).confirmationId).toBe(r.id);
    w.createMode = "ok";
    const again = await confirm(r);
    expect(again).toMatchObject({ ok: true, replayed: true });
    const calls = writeCalls();
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => (c.args as { p_confirmation: string }).p_confirmation)).toEqual([r.id, r.id]);
    // each request signed its own proof over the same payload text (issued per request, never taken from the browser)
    expect(calls.every((c) => /^[0-9a-f]{64}$/.test((c.args as { p_mac: string }).p_mac) && (c.args as { p_mac: string }).p_mac !== r.token.split(".")[1])).toBe(true);
    expect(w.opps.filter((o) => o.title === "Harbour gala LED wall")).toHaveLength(2); // the fixture enquiry + exactly ONE created
    // the read-only status call is by confirmation id and writes nothing
    const before = writeCalls().length;
    expect(await a.status(r.id)).toMatchObject({ ok: true, state: "done" });
    expect(writeCalls()).toHaveLength(before);
  });
});

describe("the database proof key and the review key never reach the browser", () => {
  const root = path.resolve(__dirname, "../..");
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(tsx?|jsx?)$/.test(d.name) && !/\.test\./.test(d.name) ? [path.join(dir, d.name)] : []));
  it("no client component or server-action wrapper imports the signer, the secret or the derivations; the token module is server-only", () => {
    for (const f of [...files(path.join(root, "components/jarvis")), path.join(root, "lib/actions/jarvis.ts")]) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/issueDbProof|deriveProofKey|deriveReviewKey|proofRpcArgs|confirmationSecret|JARVIS_CONFIRMATION_SECRET|lib\/jarvis\/token/);
    }
    expect(readFileSync(path.join(root, "lib/jarvis/token.ts"), "utf8")).toMatch(/^import "server-only";/);
  });
  it("the protocol types the browser receives hold a review token and a confirmation id only (no MAC, no proof fields)", () => {
    const text = readFileSync(path.join(root, "lib/jarvis/protocol.ts"), "utf8");
    expect(text).toMatch(/ConfirmationView \{ id: string; token: string; expiresAt: string \}/);
    expect(text).not.toMatch(/p_mac|proof/i);
  });
});

describe("the database refuses (fake database running the same rules): nothing is written", () => {
  it("no key set: every wrapper fails closed with a plain message", async () => {
    w.proofKey = null;
    for (const kind of ["create", "update", "stage", "meeting", "org"] as const) {
      const r = await propose(kind);
      const out = refusal(await confirm(r));
      expect(out.code, kind).toBe("save_failed");
      expect(out.message).toMatch(/cannot save changes right now/);
    }
    expect(w.ledger.size).toBe(0);
    expect(w.opps).toHaveLength(1);
    expect(w.updates).toEqual([]);
    expect(w.moves).toEqual([]);
    expect(w.activities).toEqual([]);
    expect(w.registered).toEqual([]);
  });
  it("the database holds another key (the app and the database were set to different secrets): refused, nothing written", async () => {
    w.proofKey = "z".repeat(40);
    for (const kind of ["create", "update", "stage", "meeting", "org"] as const) expect(refusal(await confirm(await propose(kind))).code, kind).toBe("needs_review");
    expect(w.ledger.size).toBe(0);
    expect(w.opps).toHaveLength(1);
  });
  it("the DATABASE clock decides expiry: a proof the app still accepts is refused when the database says it is past the expiry", async () => {
    const r = await propose("create");
    w.dbNow = () => new Date(Date.now() + 20 * 60_000);
    const out = refusal(await confirm(r));
    expect(out.code).toBe("needs_review");
    expect(out.message).toMatch(/expired/);
    expect(w.opps).toHaveLength(1);
    expect(w.ledger.size).toBe(0);
  });
});
