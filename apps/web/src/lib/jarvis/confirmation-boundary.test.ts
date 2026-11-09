import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { crmToday } from "@enginious-hr/domain";
import { registerAllJarvisActions } from "./actions";
import { createAssistant, type JarvisAssistant } from "./assistant";
import type { ActionConfirmResult, EnquiryCard, SendResult } from "./protocol";
import { simulatedProviderCalls } from "./provider/simulated";
import { fakeDeps, ID, mkOpp, newWorld, sha, type Opp, type World } from "./testing/fake-world";

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

describe.each(["create", "update", "stage", "meeting", "org"] as const)("%s: the exact signed payload reaches the wrapper", (kind) => {
  it("the payload text sent is the text whose SHA-256 is in the proof; the MAC, company, target and version are the signed ones", async () => {
    const r = await propose(kind);
    const c = await confirm(r);
    expect(c.ok, JSON.stringify(c)).toBe(true);
    const sent = writeCalls();
    expect(sent).toHaveLength(1);
    const args = sent[0]!.args as { p_confirmation: string; p_company: string; p_target: string; p_version: number | null; p_expires: number; p_mac: string; p_payload: string };
    expect(args.p_confirmation).toBe(r.id);
    expect(sha(args.p_payload)).toBe(body(r.token).ph);
    expect(args.p_mac).toBe(r.token.split(".")[1]);
    expect(args.p_company).toBe(ID.co1);
    expect(args.p_expires).toBe(body(r.token).exp);
    expect(args.p_target).toBe(kind === "create" || kind === "org" ? "new" : e.id);
    expect(args.p_version).toBe(kind === "update" || kind === "stage" ? 4 : null);
    // nothing the caller could add: no user id, no hash, no values hash argument exists any more
    expect(Object.keys(args).sort()).toEqual(["p_ack", "p_company", "p_confirmation", "p_expires", "p_mac", "p_payload", "p_target", "p_version"].filter((k) => k !== "p_ack" || kind === "org"));
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
