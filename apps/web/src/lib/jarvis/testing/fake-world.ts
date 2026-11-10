import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JarvisConfig } from "../config";
import type { JarvisDeps } from "../dispatcher";
import { createSimulatedProvider } from "../provider/simulated";
import type { JarvisProvider } from "../provider/types";

/**
 * A small in-memory stand-in for the database, for the JARVIS unit tests ONLY (fictional data). It mimics what the app layer relies on: the person's own session (what they can
 * see depends on their grants), the pilot switches, the ledger with its idempotency, and a lost-response failure mode. The real SQL is proved in packages/rls-tests/test/jarvis.rls.test.ts.
 */
export interface Org { id: string; name: string; kind: string; roles: string[]; place: string | null; name_key: string; archived_at: string | null; website?: string | null; website_domain?: string | null; country_code?: string | null }
export interface Opp {
  id: string; company_id: string; reference: string; title: string; stage: string; agency_org_id: string | null; client_org_id: string | null; event_start: string | null; install_start: string | null; location: string | null;
  technologies: { name: string; qty: number }[]; created_at: string;
  owner_id?: string | null; version?: number; currency?: string | null; value?: number | null; budget_note?: string | null; brief?: string | null; event_end?: string | null; scope?: string | null; waiting_on?: string | null;
}
let oppCounter = 100;
/** A fictional enquiry row for the unit tests (the fake database lets a person see it only when they hold a grant for its company). */
export const mkOpp = (over: Partial<Opp> & { company_id: string }): Opp => ({
  id: randomUUID(), reference: `OPP-UAE-2026-${String(++oppCounter).padStart(4, "0")}`, title: "Fictional harbour gala", stage: "new", agency_org_id: null, client_org_id: null, event_start: null, install_start: null, location: null,
  technologies: [], created_at: new Date().toISOString(), owner_id: ID.u1, version: 1, currency: null, value: null, budget_note: null, brief: null, event_end: null, scope: null, waiting_on: null, ...over,
});

export const ID = { co1: "11111111-1111-4111-8111-111111111111", co2: "22222222-2222-4222-8222-222222222222", u1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", u2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", u3: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3" };
export const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "");
export const domainOf = (w: string | null | undefined): string | null => { const d = (w ?? "").trim().replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "").replace(/^www\./i, "").replace(/[/?#:].*$/, "").toLowerCase(); return d.includes(".") ? d : null; };
export const mkOrg = (name: string, roles: string[], place: string | null = null, website: string | null = null): Org => ({ id: randomUUID(), name, kind: roles[0] ?? "client", roles, place, name_key: key(name), archived_at: null, website, website_domain: domainOf(website), country_code: null });

export interface World {
  signedIn: string | null;
  settings: { enabled: boolean; writes: boolean };
  pilot: Set<string>;
  pilotCompanies: Set<string>;
  grants: { user_id: string; company_id: string; capabilities: string[]; revoked_at: string | null }[];
  companies: { id: string; legal_name: string }[];
  orgs: Org[];
  opps: Opp[];
  ledger: Map<string, { confirmation_id: string; user_id: string; company_id: string; values_hash: string; status: "done" | "failed"; result_id: string | null; result_ref: string | null; error_message: string | null; action_id: string; target: string; result_extra: Record<string, unknown> | null; error_code?: string | null }>;
  usage: Map<string, number>;
  /** ok | refuse (the database refuses, nothing created) | network (no answer, nothing created) | lost (created, but the answer is lost) */
  createMode: "ok" | "refuse" | "network" | "lost";
  dupFails: boolean;
  /** ok | missing (PGRST202: the migration is not applied) | error */
  accessFn: "ok" | "missing" | "error";
  orgReadFails: boolean;
  rpcLog: { name: string; args: Record<string, unknown> }[];
  /** Every table the person's session read (select), in order. */
  readLog: string[];
  createdArgs: Record<string, unknown>[];
  /** What the organisation wrapper was asked to register (after its checks). */
  registered: Record<string, unknown>[];
  /** What the update wrapper applied. */
  updates: { id: string; patch: Record<string, unknown>; version: number }[];
  /** Evidence rows the stage gates read, and the moves the stage wrapper applied. */
  proposals: { opportunity_id: string; status: string }[];
  zoho: { opportunity_id: string; quote_ref: string | null }[];
  moves: { id: string; from: string; to: string; version: number }[];
  evidenceFails: boolean;
  /** The activities and follow-ups the meeting wrapper stored (both or neither). */
  activities: { id: string; opportunity_id: string; kind: string; body: string; occurred_at: string | null; internal: boolean; created_by: string }[];
  followUps: { id: string; opportunity_id: string | null; title: string; due_at: string; kind: string; assigned_to: string; company_id?: string; status?: string }[];
  /** Personal memory (jarvis_preferences) and suggestions; `memoryFn` mimics the migration not being applied or a failed read. */
  prefs: { user_id: string; pref_key: string; pref_value: string }[];
  suggestions: { user_id: string; topic_id: string; body: string; status: string }[];
  memoryFn: "ok" | "missing" | "error";
  followUpReadFails: boolean;
  /** HR roles and budget grants (what the protected-access check reads through the person's session). */
  roles: { user_id: string; role: string }[];
  budgetGrants: { user_id: string; company_id: string }[];
  protectedAccessFails: boolean;
  meetingFailAfterActivity: boolean;
  counter: number;
  /** The secret the owner gave the fake database with jarvis_set_proof_key (the database stores and uses only the DERIVED proof key). null = not set: every write wrapper fails closed. */
  proofKey: string | null;
  /** The fake database's clock. */
  dbNow: () => Date;
}

export function newWorld(): World {
  const orgs = [mkOrg("Fictional Wave Agency", ["agency"], "Dubai"), mkOrg("Fictional Harbour Brands", ["client"], "Dubai")];
  return {
    signedIn: ID.u1, settings: { enabled: true, writes: true }, pilot: new Set([ID.u1, ID.u2, ID.u3]), pilotCompanies: new Set(),
    grants: [{ user_id: ID.u1, company_id: ID.co1, capabilities: [], revoked_at: null }, { user_id: ID.u1, company_id: ID.co2, capabilities: [], revoked_at: null }, { user_id: ID.u2, company_id: ID.co2, capabilities: [], revoked_at: null }],
    companies: [{ id: ID.co1, legal_name: "Fictional Enginious UAE LLC" }, { id: ID.co2, legal_name: "Fictional Enginious KSA LLC" }],
    orgs, opps: [], ledger: new Map(), usage: new Map(), createMode: "ok", dupFails: false, accessFn: "ok", orgReadFails: false, rpcLog: [], readLog: [], createdArgs: [], registered: [], updates: [], proposals: [], zoho: [], moves: [], evidenceFails: false, activities: [], followUps: [], meetingFailAfterActivity: false, prefs: [], suggestions: [], memoryFn: "ok", followUpReadFails: false, roles: [], budgetGrants: [], protectedAccessFails: false, counter: 0, proofKey: SECRET, dbNow: () => new Date(),
  };
}

type Row = Record<string, unknown>;
const grantedCompanies = (w: World, u: string) => new Set(w.grants.filter((g) => g.user_id === u && !g.revoked_at).map((g) => g.company_id));

function table(w: World, user: string, name: string): Row[] {
  const has = grantedCompanies(w, user);
  switch (name) {
    case "crm_company_grants": return w.grants.filter((g) => g.user_id === user) as unknown as Row[];
    case "companies": return w.companies as unknown as Row[];
    case "crm_organisations": return has.size > 0 ? (w.orgs as unknown as Row[]) : [];
    case "crm_opportunities": return w.opps.filter((o) => has.has(o.company_id)) as unknown as Row[];
    case "crm_proposals": return w.proposals.filter((p) => w.opps.some((o) => o.id === p.opportunity_id && has.has(o.company_id))) as unknown as Row[];
    case "crm_zoho_references": return w.zoho.filter((p) => w.opps.some((o) => o.id === p.opportunity_id && has.has(o.company_id))) as unknown as Row[];
    case "crm_follow_ups": return w.followUps.map((f) => ({ status: "open", ...f, company_id: f.company_id ?? w.opps.find((o) => o.id === f.opportunity_id)?.company_id })).filter((f) => has.has(f.company_id as string)) as unknown as Row[];
    case "jarvis_action_ledger": return [...w.ledger.values()].filter((l) => l.user_id === user) as unknown as Row[];
    default: return [];
  }
}

function builder(w: World, user: string, name: string) {
  w.readLog.push(name);
  let rows = table(w, user, name).slice();
  let error: { message: string; code?: string } | null = (name === "crm_organisations" && w.orgReadFails) || ((name === "crm_proposals" || name === "crm_zoho_references") && w.evidenceFails) || (name === "crm_follow_ups" && w.followUpReadFails) ? { message: "unreadable" } : null;
  const api = {
    select() { return api; },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return api; },
    is(c: string, v: unknown) { rows = rows.filter((r) => (r[c] ?? null) === v); return api; },
    lt(c: string, v: string) { rows = rows.filter((r) => String(r[c]) < v); return api; },
    gte(c: string, v: string) { rows = rows.filter((r) => String(r[c]) >= v); return api; },
    in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return api; },
    ilike(c: string, p: string) { const needle = p.replace(/%/g, "").toLowerCase(); rows = rows.filter((r) => String(r[c] ?? "").toLowerCase().includes(needle)); return api; },
    order(c?: string) { if (c) rows = rows.slice().sort((a, b) => String(a[c]).localeCompare(String(b[c]))); return api; },
    limit(n: number) { rows = rows.slice(0, n); return api; },
    maybeSingle() { return Promise.resolve({ data: error ? null : (rows[0] ?? null), error }); },
    then(res: (v: { data: Row[] | null; error: typeof error }) => unknown) { return Promise.resolve({ data: error ? null : rows, error }).then(res); },
  };
  return api;
}

function access(w: World, user: string, company: string | null) {
  const inPilot = w.settings.enabled && w.pilot.has(user);
  return { is_available: inPilot, writes_allowed: inPilot && w.settings.writes, company_allowed: company === null || w.pilotCompanies.size === 0 || w.pilotCompanies.has(company) };
}

type LedgerRow = World["ledger"] extends Map<string, infer V> ? V : never;
const json = (r: LedgerRow, replayed: boolean) => ({ status: r.status, confirmation_id: r.confirmation_id, result_id: r.result_id, reference: r.result_ref, extra: r.result_extra, replayed, error_code: r.error_code ?? null, error_message: r.error_message });
/** The switches, company list and Sales-grant checks every wrapper makes first (refused with 42501 and no ledger row). */
function gateWrite(w: World, user: string, company: string) {
  const a = access(w, user, company);
  if (!a.writes_allowed || !a.company_allowed) return { data: null, error: { message: "JARVIS writes are not available to you for this company", code: "42501" } };
  if (!grantedCompanies(w, user).has(company)) return { data: null, error: { message: "You do not have Sales access for this company", code: "42501" } };
  return null;
}
/** A used confirmation id returns the ORIGINAL result; another person, company, action, target or values are refused. */
function replay(w: World, user: string, cid: string, company: string, action: string, target: string, hash: string) {
  const prior = w.ledger.get(cid);
  if (!prior) return null;
  if (prior.user_id !== user || prior.company_id !== company || prior.action_id !== action || prior.target !== target || prior.values_hash !== hash) return { data: null, error: { message: "This confirmation cannot be used for these details", code: "42501" } };
  return { data: json(prior, true), error: null };
}
function ledgerRow(w: World, user: string, cid: string, company: string, action: string, target: string, hash: string, o: Partial<LedgerRow>): LedgerRow {
  const row: LedgerRow = { confirmation_id: cid, user_id: user, company_id: company, values_hash: hash, status: "done", result_id: null, result_ref: null, error_message: null, action_id: action, target, result_extra: null, error_code: null, ...o };
  w.ledger.set(cid, row);
  return row;
}

/**
 * The fake database's proof check, written independently of the app's signer (plain Node crypto over the documented text): the same rules as jarvis_verify_proof. Returns the
 * parsed payload and its hash, or the database's refusal. Nothing is stored before this passes.
 */
function proofGate(w: World, user: string, action: string, args: Record<string, unknown>): { payload: Record<string, unknown>; hash: string } | { refusal: { data: null; error: { message: string; code: string } } } {
  const no = (message: string, code: string) => ({ refusal: { data: null as null, error: { message, code } } });
  if (w.proofKey === null) return no("JARVIS cannot save changes right now.", "JV004");
  const text = args.p_payload;
  if (typeof text !== "string" || typeof args.p_mac !== "string" || !/^[0-9a-f]{64}$/.test(args.p_mac) || typeof args.p_confirmation !== "string" || typeof args.p_company !== "string" || typeof args.p_target !== "string" || typeof args.p_expires !== "number") {
    return no("This confirmation is not valid. Review the details again.", "JV002");
  }
  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  const canonical = ["JARVIS-PROOF-V1", args.p_confirmation, user, args.p_company, action, args.p_target, args.p_version == null ? "-" : String(args.p_version), String(args.p_expires), hash].join("\n");
  // The database holds only the derived PROOF key (HMAC(secret, "JARVIS-PROOF-KEY-V1")); it never has the review key.
  const expected = createHmac("sha256", createHmac("sha256", w.proofKey).update("JARVIS-PROOF-KEY-V1", "utf8").digest()).update(canonical, "utf8").digest();
  const given = Buffer.from(args.p_mac, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return no("This confirmation is not valid. Review the details again.", "JV002");
  if (Math.floor(w.dbNow().getTime() / 1000) >= args.p_expires) return no("This review has expired. Review the details again.", "JV003");
  return { payload: JSON.parse(text) as Record<string, unknown>, hash };
}

function rpc(w: World, user: string, name: string, args: Record<string, unknown>) {
  w.rpcLog.push({ name, args });
  const run = async (): Promise<{ data: unknown; error: { message: string; code?: string } | null }> => {
    switch (name) {
      case "jarvis_my_access":
        if (w.accessFn === "missing") return { data: null, error: { message: "Could not find the function public.jarvis_my_access", code: "PGRST202" } };
        if (w.accessFn === "error") return { data: null, error: { message: "boom", code: "XX000" } };
        return { data: [access(w, user, (args.p_company_id as string | null) ?? null)], error: null };
      case "jarvis_usage_take": {
        const limit = args.p_limit as number; const used = w.usage.get(user) ?? 0;
        if (used >= limit) return { data: [{ allowed: false, used, remaining: 0 }], error: null };
        w.usage.set(user, used + 1);
        return { data: [{ allowed: true, used: used + 1, remaining: limit - used - 1 }], error: null };
      }
      case "jarvis_pref_list": case "jarvis_pref_set": case "jarvis_pref_delete": case "jarvis_suggest_correction": {
        if (w.memoryFn === "missing") return { data: null, error: { message: `Could not find the function public.${name}`, code: "PGRST202" } };
        if (w.memoryFn === "error") return { data: null, error: { message: "boom", code: "XX000" } };
        if (!access(w, user, null).is_available) return { data: null, error: { message: "JARVIS is not available to you", code: "42501" } };
        if (name === "jarvis_pref_list") return { data: w.prefs.filter((p) => p.user_id === user).map((p) => ({ pref_key: p.pref_key, pref_value: p.pref_value })), error: null };
        if (name === "jarvis_suggest_correction") { w.suggestions.push({ user_id: user, topic_id: args.p_topic as string, body: args.p_text as string, status: "pending" }); return { data: randomUUID(), error: null }; }
        w.prefs = w.prefs.filter((p) => !(p.user_id === user && p.pref_key === args.p_key));
        if (name === "jarvis_pref_set") {
          // The same closed set as the table CHECK.
          const ok: Record<string, string[]> = { email_length: ["short", "medium", "detailed"], english: ["british", "american"], tone: ["formal", "friendly", "neutral"], answer_length: ["brief", "detailed"] };
          if (!ok[args.p_key as string]?.includes(args.p_value as string)) return { data: null, error: { message: "violates check constraint", code: "23514" } };
          w.prefs.push({ user_id: user, pref_key: args.p_key as string, pref_value: args.p_value as string });
        }
        return { data: null, error: null };
      }
      case "crm_find_duplicate_candidates": {
        if (w.dupFails) return { data: null, error: { message: "boom", code: "XX000" } };
        const has = grantedCompanies(w, user);
        return { data: w.opps.filter((o) => has.has(o.company_id)).map((o) => ({ opportunity_id: o.id, company_id: o.company_id, reference: o.reference, title: o.title, stage: o.stage, owner_id: user, agency_org_id: o.agency_org_id, client_org_id: o.client_org_id, event_start: o.event_start, event_end: null, install_start: o.install_start, location: o.location, technologies: o.technologies, created_at: o.created_at })), error: null };
      }
      case "jarvis_create_enquiry": {
        const pg = proofGate(w, user, "jarvis.sales.enquiry.create_from_brief", args);
        if ("refusal" in pg) return pg.refusal;
        const a = access(w, user, args.p_company as string);
        const p = pg.payload as unknown as { company_id: string; title: string; agency_org_id: string | null; client_org_id: string | null; event_start: string | null; location: string | null; technologies: { name: string; qty: number }[] };
        if (!a.writes_allowed || !a.company_allowed) return { data: null, error: { message: "JARVIS writes are not available to you for this company", code: "42501" } };
        if (!grantedCompanies(w, user).has(p.company_id)) return { data: null, error: { message: "You do not have Sales access for this company", code: "42501" } };
        const cid = args.p_confirmation as string;
        const prior = w.ledger.get(cid);
        if (prior) {
          if (prior.user_id !== user || prior.company_id !== p.company_id || prior.values_hash !== pg.hash) return { data: null, error: { message: "This confirmation cannot be used for these details", code: "42501" } };
          return { data: { status: prior.status, confirmation_id: cid, opportunity_id: prior.result_id, reference: prior.result_ref, replayed: true, error_message: prior.error_message }, error: null };
        }
        if (w.createMode === "network") return { data: null, error: { message: "TypeError: fetch failed" } };
        if (w.createMode === "refuse") return { data: null, error: { message: "Only a founder (or someone they delegated) can assign another owner", code: "42501" } };
        w.createdArgs.push(pg.payload);
        const id = randomUUID(); w.counter += 1; const reference = `OPP-UAE-2026-${String(w.counter).padStart(4, "0")}`;
        w.opps.push(mkOpp({ id, company_id: p.company_id, reference, title: p.title, agency_org_id: p.agency_org_id, client_org_id: p.client_org_id, event_start: p.event_start, location: p.location, technologies: p.technologies, owner_id: user }));
        w.ledger.set(cid, { confirmation_id: cid, user_id: user, company_id: p.company_id, values_hash: pg.hash, status: "done", result_id: id, result_ref: reference, error_message: null, action_id: "jarvis.sales.enquiry.create_from_brief", target: "new", result_extra: null });
        if (w.createMode === "lost") return { data: null, error: { message: "TypeError: fetch failed" } };
        return { data: { status: "done", confirmation_id: cid, opportunity_id: id, reference, replayed: false, error_message: null }, error: null };
      }
      case "jarvis_record_meeting": {
        const pg = proofGate(w, user, "jarvis.sales.meeting.record", args);
        if ("refusal" in pg) return pg.refusal;
        const opp = w.opps.find((o) => o.id === args.p_target);
        const has = grantedCompanies(w, user);
        if (!opp || !has.has(opp.company_id)) return { data: null, error: { message: "Opportunity not found", code: "P0002" } };
        const act = pg.payload.activity as { kind: string; body: string; occurred_at: string | null; internal: boolean } | null;
        const fu = (pg.payload.follow_up ?? null) as { title: string; due_at: string; kind: string } | null;
        if (!act || !["call", "email", "meeting", "note", "client_response"].includes(act.kind) || !(act.body ?? "").trim()) return { data: null, error: { message: "Write what happened", code: "22023" } };
        if (fu && (!(fu.title ?? "").trim() || !fu.due_at)) return { data: null, error: { message: "The follow-up needs a title and a due date", code: "22023" } };
        const gate = gateWrite(w, user, opp.company_id);
        if (gate) return gate;
        const cid = args.p_confirmation as string;
        const prior = replay(w, user, cid, opp.company_id, "jarvis.sales.meeting.record", opp.id, pg.hash);
        if (prior) return prior;
        if (w.createMode === "network") return { data: null, error: { message: "TypeError: fetch failed" } };
        const fail = (code: string, message: string) => ({ data: json(ledgerRow(w, user, cid, opp.company_id, "jarvis.sales.meeting.record", opp.id, pg.hash, { status: "failed", error_code: code, error_message: message }), false), error: null });
        // ATOMIC: every refusal is decided before anything is stored, exactly as the database transaction rolls both back.
        if (opp.stage === "lost") return fail("23514", "A lost opportunity can no longer be updated");
        if (act.occurred_at && Date.parse(act.occurred_at) > Date.now() + 5 * 60_000) return fail("22023", "An activity cannot be dated in the future");
        if (fu && (opp.stage === "won" || opp.stage === "lost")) return fail("23514", "A closed opportunity has no follow-ups");
        if (w.meetingFailAfterActivity) return fail("XX000", "simulated failure of the second write");
        const activityId = randomUUID();
        w.activities.push({ id: activityId, opportunity_id: opp.id, kind: act.kind, body: act.body, occurred_at: act.occurred_at, internal: !!act.internal, created_by: user });
        let followUpId: string | null = null;
        if (fu) { followUpId = randomUUID(); w.followUps.push({ id: followUpId, opportunity_id: opp.id, title: fu.title, due_at: fu.due_at, kind: fu.kind, assigned_to: user }); }
        const row = ledgerRow(w, user, cid, opp.company_id, "jarvis.sales.meeting.record", opp.id, pg.hash, { status: "done", result_id: opp.id, result_ref: opp.reference, result_extra: { company_id: opp.company_id, activity_id: activityId, follow_up_id: followUpId } });
        if (w.createMode === "lost") return { data: null, error: { message: "TypeError: fetch failed" } };
        return { data: json(row, false), error: null };
      }
      case "jarvis_change_stage": {
        const pg = proofGate(w, user, "jarvis.sales.enquiry.change_stage", args);
        if ("refusal" in pg) return pg.refusal;
        const opp = w.opps.find((o) => o.id === args.p_target);
        const has = grantedCompanies(w, user);
        if (!opp || !has.has(opp.company_id)) return { data: null, error: { message: "Opportunity not found", code: "P0002" } };
        const ORDER = ["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation"];
        const to = pg.payload.to as string;
        const i = ORDER.indexOf(opp.stage); const j = ORDER.indexOf(to);
        if (args.p_version == null) return { data: null, error: { message: "This confirmation is not valid. Review the details again.", code: "JV002" } };
        const gate = gateWrite(w, user, opp.company_id);
        if (gate) return gate;
        const cid = args.p_confirmation as string;
        const prior = replay(w, user, cid, opp.company_id, "jarvis.sales.enquiry.change_stage", opp.id, pg.hash);
        if (prior) return prior;
        // The signed version must still be current: raised before anything is written (no ledger row).
        if ((opp.version ?? 1) !== args.p_version) return { data: null, error: { message: "This enquiry was changed by someone else after you reviewed it. Review the details again.", code: "40001" } };
        if (j < 0) return { data: null, error: { message: "JARVIS cannot move an enquiry to that stage", code: "22023" } };
        if (i >= 0 && Math.abs(j - i) !== 1) return { data: null, error: { message: "JARVIS moves an enquiry one step at a time", code: "22023" } };
        if (w.createMode === "network") return { data: null, error: { message: "TypeError: fetch failed" } };
        const fail = (code: string, message: string) => ({ data: json(ledgerRow(w, user, cid, opp.company_id, "jarvis.sales.enquiry.change_stage", opp.id, pg.hash, { status: "failed", error_code: code, error_message: message }), false), error: null });
        const founder = w.grants.some((g) => g.user_id === user && g.company_id === opp.company_id && !g.revoked_at && g.capabilities.includes("founder"));
        if ((opp.version ?? 1) !== args.p_version) return fail("40001", "This opportunity was changed by someone else. Reload and try again.");
        if (opp.owner_id !== user && !founder) return fail("42501", "Only the owner of this opportunity or a founder can do this");
        if (i < 0) return fail("23514", "A closed opportunity cannot change stage");
        if (to === "proposal_sent" && !w.proposals.some((p) => p.opportunity_id === opp.id && ["sent", "accepted"].includes(p.status))) return fail("23514", "Record a proposal as sent before moving to Proposal sent");
        if (to === "quote_sent" && !w.zoho.some((p) => p.opportunity_id === opp.id && (p.quote_ref ?? "").trim())) return fail("23514", "Record the Zoho Books quote reference before moving to Quote sent");
        w.moves.push({ id: opp.id, from: opp.stage, to, version: args.p_version as number });
        const from = opp.stage; opp.stage = to; opp.version = (opp.version ?? 1) + 1;
        const row = ledgerRow(w, user, cid, opp.company_id, "jarvis.sales.enquiry.change_stage", opp.id, pg.hash, { status: "done", result_id: opp.id, result_ref: opp.reference, result_extra: { company_id: opp.company_id, version: opp.version, from, to } });
        if (w.createMode === "lost") return { data: null, error: { message: "TypeError: fetch failed" } };
        return { data: json(row, false), error: null };
      }
      case "jarvis_update_enquiry": {
        const pg = proofGate(w, user, "jarvis.sales.enquiry.update", args);
        if ("refusal" in pg) return pg.refusal;
        const patch = pg.payload;
        const opp = w.opps.find((o) => o.id === args.p_target);
        const has = grantedCompanies(w, user);
        if (!opp || !has.has(opp.company_id)) return { data: null, error: { message: "Opportunity not found", code: "P0002" } };
        const keys = Object.keys(patch ?? {}).sort();
        const ALLOWED = ["title", "brief", "event_start", "event_end", "install_start", "location", "technologies", "scope", "waiting_on", "budget_note"];
        if (keys.length === 0 || args.p_version == null) return { data: null, error: { message: "The confirmation is incomplete", code: "22023" } };
        for (const k of keys) if (!ALLOWED.includes(k)) return { data: null, error: { message: `Field ${k} cannot be changed through JARVIS`, code: "22023" } };
        const gate = gateWrite(w, user, opp.company_id);
        if (gate) return gate;
        const cid = args.p_confirmation as string;
        const prior = replay(w, user, cid, opp.company_id, "jarvis.sales.enquiry.update", opp.id, pg.hash);
        if (prior) return prior;
        if ((opp.version ?? 1) !== args.p_version) return { data: null, error: { message: "This enquiry was changed by someone else after you reviewed it. Review the details again.", code: "40001" } };
        if (w.createMode === "network") return { data: null, error: { message: "TypeError: fetch failed" } };
        const fail = (code: string, message: string) => ({ data: json(ledgerRow(w, user, cid, opp.company_id, "jarvis.sales.enquiry.update", opp.id, pg.hash, { status: "failed", error_code: code, error_message: message }), false), error: null });
        const founder = w.grants.some((g) => g.user_id === user && g.company_id === opp.company_id && !g.revoked_at && g.capabilities.includes("founder"));
        if (opp.stage === "lost") return fail("23514", "A lost opportunity can no longer be edited");
        if ((opp.version ?? 1) !== args.p_version) return fail("40001", "This opportunity was changed by someone else. Reload and try again.");
        if (opp.owner_id !== user && !founder) return fail("42501", "Only the owner of this opportunity or a founder can do this");
        w.updates.push({ id: opp.id, patch, version: args.p_version as number });
        Object.assign(opp, patch);
        opp.version = (opp.version ?? 1) + 1;
        const row = ledgerRow(w, user, cid, opp.company_id, "jarvis.sales.enquiry.update", opp.id, pg.hash, { status: "done", result_id: opp.id, result_ref: opp.reference, result_extra: { company_id: opp.company_id, version: opp.version, fields: keys } });
        if (w.createMode === "lost") return { data: null, error: { message: "TypeError: fetch failed" } };
        return { data: json(row, false), error: null };
      }
      case "jarvis_register_organisation": {
        const pg = proofGate(w, user, "jarvis.sales.organisation.register", args);
        if ("refusal" in pg) return pg.refusal;
        // The acknowledgement is read ONLY from the verified payload (the wrapper has no other parameter).
        const p = pg.payload as { company_id: string; name: string; roles: string[]; country_code: string | null; website: string | null; place: string | null; note: string | null; acknowledged_org_ids?: string[] };
        if (!Array.isArray(p.acknowledged_org_ids)) return { data: null, error: { message: "The confirmation is incomplete", code: "22023" } };
        const gate = gateWrite(w, user, p.company_id);
        if (gate) return gate;
        const cid = args.p_confirmation as string;
        const prior = replay(w, user, cid, p.company_id, "jarvis.sales.organisation.register", "new", pg.hash);
        if (prior) return prior;
        if (!p.roles || p.roles.length === 0) return { data: null, error: { message: "Choose what kind of organisation it is", code: "22023" } };
        if (w.createMode === "network") return { data: null, error: { message: "TypeError: fetch failed" } };
        if (w.createMode === "refuse") return { data: null, error: { message: "No CRM access", code: "42501" } };
        const hit = w.orgs.filter((o) => !o.archived_at && (o.name_key === key(p.name) || (domainOf(p.website) && o.website_domain === domainOf(p.website))));
        // The database requires the signed acknowledgement to be EXACTLY the matching set; a refusal writes nothing (not even a ledger row).
        const ids = new Set(p.acknowledged_org_ids);
        if (hit.length !== ids.size || hit.some((o) => !ids.has(o.id))) return { data: null, error: { message: "A similar organisation (same name or website) exists, and the acknowledgement does not match it. Review the details again.", code: "JV001" } };
        const org = mkOrg(p.name, p.roles, p.place, p.website);
        org.country_code = p.country_code;
        w.orgs.push(org);
        const { acknowledged_org_ids: _ack, ...registeredValues } = p; void _ack;
        w.registered.push({ ...registeredValues });
        const row = ledgerRow(w, user, cid, p.company_id, "jarvis.sales.organisation.register", "new", pg.hash, { status: "done", result_id: org.id, result_ref: p.name, result_extra: { company_id: p.company_id } });
        if (w.createMode === "lost") return { data: null, error: { message: "TypeError: fetch failed" } };
        return { data: json(row, false), error: null };
      }
      default: return { data: null, error: { message: `unexpected rpc ${name}` } };
    }
  };
  const p = run();
  return Object.assign(p, { abortSignal() { return p; } });
}

export function fakeSupabase(w: World, user: string): SupabaseClient {
  return { from: (t: string) => builder(w, user, t), rpc: (n: string, a: Record<string, unknown> = {}) => rpc(w, user, n, a) } as unknown as SupabaseClient;
}

export const SECRET = "x".repeat(40);
export const testConfig = (over: Partial<JarvisConfig> = {}): JarvisConfig => ({
  disabled: false, providerKind: "simulated", providerNote: null, apiKey: null, model: "test-model", maxInputChars: 6000, maxOutputTokens: 1200, timeoutMs: 20000, dailyLimit: 30,
  confirmationTtlMs: 15 * 60_000, proofTtlMs: 120_000, confirmationSecret: SECRET, productionLike: false, paused: [], ...over,
});

export function fakeDeps(w: World, over: { config?: Partial<JarvisConfig>; provider?: JarvisProvider | null; now?: () => Date } = {}): JarvisDeps {
  const provider = over.provider === undefined ? createSimulatedProvider() : over.provider;
  return {
    config: () => testConfig(over.config),
    provider: () => provider,
    identity: async () => (w.signedIn ? { userId: w.signedIn } : null),
    supabase: async () => fakeSupabase(w, w.signedIn ?? ID.u1),
    moduleGrant: async ({ module, userId, companyId }) => module === "sales" && grantedCompanies(w, userId).has(companyId),
    protectedAccess: async ({ userId, companyId }) => (w.protectedAccessFails ? "error" : { roles: w.roles.filter((r) => r.user_id === userId).map((r) => r.role), budget: w.budgetGrants.some((g) => g.user_id === userId && g.company_id === companyId) }),
    companies: async ({ userId }) => w.companies.filter((c) => grantedCompanies(w, userId).has(c.id)).map((c) => ({ id: c.id, name: c.legal_name })),
    now: over.now ?? (() => new Date()),
    newId: () => randomUUID(),
  };
}

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Wrapper arguments carrying a REAL proof (HMAC over the documented text, plain Node crypto, independent of the app's signer), for tests that call the fake database directly as
 * "the person with the API key". `key` is the SECRET the proof key is derived from (default: the one the fake database was given); pass another to build a proof the database cannot accept.
 */
export function proofArgs(user: string, o: { action: string; company: string; target: string; version?: number | null; payload: unknown; jti?: string; exp?: number; key?: string }) {
  const text = typeof o.payload === "string" ? o.payload : JSON.stringify(o.payload);
  const jti = o.jti ?? randomUUID();
  const exp = o.exp ?? Math.floor(Date.now() / 1000) + 900;
  const canonical = ["JARVIS-PROOF-V1", jti, user, o.company, o.action, o.target, o.version == null ? "-" : String(o.version), String(exp), createHash("sha256").update(text, "utf8").digest("hex")].join("\n");
  const proofKey = createHmac("sha256", o.key ?? SECRET).update("JARVIS-PROOF-KEY-V1", "utf8").digest();
  return { p_confirmation: jti, p_company: o.company, p_target: o.target, p_version: o.version ?? null, p_expires: exp, p_mac: createHmac("sha256", proofKey).update(canonical, "utf8").digest("hex"), p_payload: text };
}
