import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JarvisConfig } from "../config";
import type { JarvisDeps } from "../dispatcher";
import { createSimulatedProvider } from "../provider/simulated";
import type { JarvisProvider } from "../provider/types";

/**
 * A small in-memory stand-in for the database, for the JARVIS unit tests ONLY (fictional data). It mimics what the app layer relies on: the person's own session (what they can
 * see depends on their grants), the pilot switches, the ledger with its idempotency, and a lost-response failure mode. The real SQL is proved in packages/rls-tests/test/jarvis.rls.test.ts.
 */
export interface Org { id: string; name: string; kind: string; roles: string[]; place: string | null; name_key: string; archived_at: string | null }
export interface Opp { id: string; company_id: string; reference: string; title: string; stage: string; agency_org_id: string | null; client_org_id: string | null; event_start: string | null; install_start: string | null; location: string | null; technologies: { name: string; qty: number }[]; created_at: string }

export const ID = { co1: "11111111-1111-4111-8111-111111111111", co2: "22222222-2222-4222-8222-222222222222", u1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", u2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", u3: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3" };
export const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "");
export const mkOrg = (name: string, roles: string[], place: string | null = null): Org => ({ id: randomUUID(), name, kind: roles[0] ?? "client", roles, place, name_key: key(name), archived_at: null });

export interface World {
  signedIn: string | null;
  settings: { enabled: boolean; writes: boolean };
  pilot: Set<string>;
  pilotCompanies: Set<string>;
  grants: { user_id: string; company_id: string; capabilities: string[]; revoked_at: string | null }[];
  companies: { id: string; legal_name: string }[];
  orgs: Org[];
  opps: Opp[];
  ledger: Map<string, { confirmation_id: string; user_id: string; company_id: string; values_hash: string; status: "done" | "failed"; result_id: string | null; result_ref: string | null; error_message: string | null }>;
  usage: Map<string, number>;
  /** ok | refuse (the database refuses, nothing created) | network (no answer, nothing created) | lost (created, but the answer is lost) */
  createMode: "ok" | "refuse" | "network" | "lost";
  dupFails: boolean;
  orgReadFails: boolean;
  rpcLog: { name: string; args: Record<string, unknown> }[];
  createdArgs: Record<string, unknown>[];
  counter: number;
}

export function newWorld(): World {
  const orgs = [mkOrg("Fictional Wave Agency", ["agency"], "Dubai"), mkOrg("Fictional Harbour Brands", ["client"], "Dubai")];
  return {
    signedIn: ID.u1, settings: { enabled: true, writes: true }, pilot: new Set([ID.u1, ID.u2, ID.u3]), pilotCompanies: new Set(),
    grants: [{ user_id: ID.u1, company_id: ID.co1, capabilities: [], revoked_at: null }, { user_id: ID.u1, company_id: ID.co2, capabilities: [], revoked_at: null }, { user_id: ID.u2, company_id: ID.co2, capabilities: [], revoked_at: null }],
    companies: [{ id: ID.co1, legal_name: "Fictional Enginious UAE LLC" }, { id: ID.co2, legal_name: "Fictional Enginious KSA LLC" }],
    orgs, opps: [], ledger: new Map(), usage: new Map(), createMode: "ok", dupFails: false, orgReadFails: false, rpcLog: [], createdArgs: [], counter: 0,
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
    case "jarvis_action_ledger": return [...w.ledger.values()].filter((l) => l.user_id === user) as unknown as Row[];
    default: return [];
  }
}

function builder(w: World, user: string, name: string) {
  let rows = table(w, user, name).slice();
  let error: { message: string; code?: string } | null = name === "crm_organisations" && w.orgReadFails ? { message: "organisations unreadable" } : null;
  const api = {
    select() { return api; },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return api; },
    is(c: string, v: unknown) { rows = rows.filter((r) => (r[c] ?? null) === v); return api; },
    in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return api; },
    ilike(c: string, p: string) { const needle = p.replace(/%/g, "").toLowerCase(); rows = rows.filter((r) => String(r[c] ?? "").toLowerCase().includes(needle)); return api; },
    order() { return api; },
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

function rpc(w: World, user: string, name: string, args: Record<string, unknown>) {
  w.rpcLog.push({ name, args });
  const run = async (): Promise<{ data: unknown; error: { message: string; code?: string } | null }> => {
    switch (name) {
      case "jarvis_my_access": return { data: [access(w, user, (args.p_company_id as string | null) ?? null)], error: null };
      case "jarvis_usage_take": {
        const limit = args.p_limit as number; const used = w.usage.get(user) ?? 0;
        if (used >= limit) return { data: [{ allowed: false, used, remaining: 0 }], error: null };
        w.usage.set(user, used + 1);
        return { data: [{ allowed: true, used: used + 1, remaining: limit - used - 1 }], error: null };
      }
      case "crm_find_duplicate_candidates": {
        if (w.dupFails) return { data: null, error: { message: "boom", code: "XX000" } };
        const has = grantedCompanies(w, user);
        return { data: w.opps.filter((o) => has.has(o.company_id)).map((o) => ({ opportunity_id: o.id, company_id: o.company_id, reference: o.reference, title: o.title, stage: o.stage, owner_id: user, agency_org_id: o.agency_org_id, client_org_id: o.client_org_id, event_start: o.event_start, event_end: null, install_start: o.install_start, location: o.location, technologies: o.technologies, created_at: o.created_at })), error: null };
      }
      case "jarvis_create_enquiry": {
        const a = access(w, user, (args.p_args as { company_id: string }).company_id);
        const p = args.p_args as { company_id: string; title: string; agency_org_id: string | null; client_org_id: string | null; event_start: string | null; location: string | null; technologies: { name: string; qty: number }[] };
        if (!a.writes_allowed || !a.company_allowed) return { data: null, error: { message: "JARVIS writes are not available to you for this company", code: "42501" } };
        if (!grantedCompanies(w, user).has(p.company_id)) return { data: null, error: { message: "You do not have Sales access for this company", code: "42501" } };
        const cid = args.p_confirmation_id as string;
        const prior = w.ledger.get(cid);
        if (prior) {
          if (prior.user_id !== user || prior.company_id !== p.company_id || prior.values_hash !== args.p_values_hash) return { data: null, error: { message: "This confirmation cannot be used for these details", code: "42501" } };
          return { data: { status: prior.status, confirmation_id: cid, opportunity_id: prior.result_id, reference: prior.result_ref, replayed: true, error_message: prior.error_message }, error: null };
        }
        if (w.createMode === "network") return { data: null, error: { message: "TypeError: fetch failed" } };
        if (w.createMode === "refuse") return { data: null, error: { message: "Only a founder (or someone they delegated) can assign another owner", code: "42501" } };
        w.createdArgs.push(args.p_args as Record<string, unknown>);
        const id = randomUUID(); w.counter += 1; const reference = `OPP-UAE-2026-${String(w.counter).padStart(4, "0")}`;
        w.opps.push({ id, company_id: p.company_id, reference, title: p.title, stage: "new", agency_org_id: p.agency_org_id, client_org_id: p.client_org_id, event_start: p.event_start, install_start: null, location: p.location, technologies: p.technologies, created_at: new Date().toISOString() });
        w.ledger.set(cid, { confirmation_id: cid, user_id: user, company_id: p.company_id, values_hash: args.p_values_hash as string, status: "done", result_id: id, result_ref: reference, error_message: null });
        if (w.createMode === "lost") return { data: null, error: { message: "TypeError: fetch failed" } };
        return { data: { status: "done", confirmation_id: cid, opportunity_id: id, reference, replayed: false, error_message: null }, error: null };
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
  confirmationTtlMs: 15 * 60_000, confirmationSecret: SECRET, productionLike: false, ...over,
});

export function fakeDeps(w: World, over: { config?: Partial<JarvisConfig>; provider?: JarvisProvider | null; now?: () => Date } = {}): JarvisDeps {
  const provider = over.provider === undefined ? createSimulatedProvider() : over.provider;
  return {
    config: () => testConfig(over.config),
    provider: () => provider,
    identity: async () => (w.signedIn ? { userId: w.signedIn } : null),
    supabase: async () => fakeSupabase(w, w.signedIn ?? ID.u1),
    moduleGrant: async ({ module, userId, companyId }) => module === "sales" && grantedCompanies(w, userId).has(companyId),
    companies: async ({ userId }) => w.companies.filter((c) => grantedCompanies(w, userId).has(c.id)).map((c) => ({ id: c.id, name: c.legal_name })),
    now: over.now ?? (() => new Date()),
    newId: () => randomUUID(),
  };
}

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
