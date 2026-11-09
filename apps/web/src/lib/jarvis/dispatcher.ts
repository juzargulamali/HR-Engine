import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JarvisConfig } from "./config";
import { configUnavailableReason } from "./config";
import { canonicalJson } from "./canonical";
import { jarvisLog } from "./log";
import type { HelpView, JarvisRefusal, JarvisRefusalCode, LauncherState, StatusResult } from "./protocol";
import type { JarvisProvider } from "./provider/types";
import { listJarvisActions, resolveJarvisAction } from "./registry";
import { issueProof, payloadHash, verifyProof, type ProofCall } from "./token";
import { JarvisRefusalError, type AnyJarvisAction, type JarvisContext, type JarvisModuleId, type JarvisTarget } from "./types";

/** Everything the dispatcher needs from the outside world, so tests can run it with fakes and production wires the signed-in person's session. */
export interface JarvisDeps {
  config: () => JarvisConfig;
  provider: (config: JarvisConfig) => JarvisProvider | null;
  /** Identity from the authenticated session, never from the request body. */
  identity: () => Promise<{ userId: string } | null>;
  /** The signed-in person's OWN Supabase client. There is no service-role client in JARVIS. */
  supabase: () => Promise<SupabaseClient>;
  /** Does this person hold the module grant (and capability) for THIS company? `"error"` = could not be read (never read as "no access"). */
  moduleGrant: (a: { module: JarvisModuleId; supabase: SupabaseClient; userId: string; companyId: string; capability?: string }) => Promise<boolean | "error">;
  /** The companies this person could use JARVIS for (any module grant), for the interface's company picker. */
  companies: (a: { supabase: SupabaseClient; userId: string }) => Promise<{ id: string; name: string }[] | "error">;
  now: () => Date;
  newId: () => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refuse = (code: JarvisRefusalCode, message: string): JarvisRefusal => ({ ok: false, code, message });
const CONFIG_MESSAGE = "JARVIS is not available right now. Sales & CRM is not affected.";

export type ProposeOutcome<TCard = unknown> =
  | { ok: true; card: TCard; confirmation: { id: string; token: string; expiresAt: string } | null; describe: string | null }
  | JarvisRefusal;

export type ExecuteOutcome =
  | { ok: true; confirmationId: string; result: unknown; replayed: boolean }
  | (JarvisRefusal & { confirmationId?: string });

export function createDispatcher(deps: JarvisDeps) {
  /**
   * Authorisation on EVERY request, in this order: (a) global hard-off and configuration; (b) the authenticated identity; (c) the database pilot switch, allowlist,
   * write switch and company list (jarvis_my_access); (d) the module grant for THIS company. (e) the action's own rule and (f) the record/target visibility are checked by
   * the action through the person's own session (RLS). Nothing here trusts a user id, a company or a flag from the browser.
   */
  async function authorize(action: AnyJarvisAction | null, companyId: string | null, mode: "propose" | "execute" | "read"): Promise<{ ok: true; ctx: JarvisContext } | JarvisRefusal> {
    const config = deps.config();
    const provider = deps.provider(config);
    const writes = action ? action.risk === "write" || action.risk === "external" : false;
    const why = configUnavailableReason(config, { needsProvider: mode !== "read" || !!action?.usesProvider, needsSecret: mode !== "read" });
    if (why || (mode !== "read" && !provider && config.providerKind === "none")) {
      jarvisLog({ event: "refused", actionId: action?.id, code: "unavailable" });
      return refuse("unavailable", CONFIG_MESSAGE);
    }
    const id = await deps.identity();
    if (!id) return refuse("signed_out", "Sign in to use JARVIS.");
    if (companyId !== null && !UUID.test(companyId)) return refuse("invalid_input", "Choose a company first.");
    const supabase = await deps.supabase();
    const acc = await supabase.rpc("jarvis_my_access", { p_company_id: companyId });
    const row = (Array.isArray(acc.data) ? acc.data[0] : acc.data) as { is_available?: boolean; writes_allowed?: boolean; company_allowed?: boolean } | null | undefined;
    if (acc.error || !row) { jarvisLog({ event: "refused", actionId: action?.id, code: "access_unreadable" }); return refuse("unavailable", CONFIG_MESSAGE); }
    if (!row.is_available) { jarvisLog({ event: "refused", actionId: action?.id, code: "not_available" }); return refuse("not_available", "JARVIS is not available to you."); }
    if (!row.company_allowed) return refuse("company_not_allowed", "JARVIS is not available for that company yet.");
    if ((mode === "execute" || (mode === "propose" && writes)) && !row.writes_allowed) return refuse("writes_off", "JARVIS cannot create or change records right now. Sales & CRM itself is not affected: you can still add the enquiry yourself.");
    if (action && companyId) {
      const g = await deps.moduleGrant({ module: action.requires.moduleGrant, supabase, userId: id.userId, companyId, capability: action.requires.capability });
      if (g === "error") return refuse("unavailable", "Could not check your access. Try again in a moment.");
      if (!g) { jarvisLog({ event: "refused", actionId: action.id, code: "no_module_access" }); return refuse("no_module_access", "You do not have access to that module for this company."); }
    }
    const ctx: JarvisContext = {
      userId: id.userId, companyId: companyId ?? "", supabase, config, provider, now: deps.now(),
      takeUsage: async () => {
        const r = await supabase.rpc("jarvis_usage_take", { p_limit: config.dailyLimit });
        const u = (Array.isArray(r.data) ? r.data[0] : r.data) as { allowed?: boolean } | null | undefined;
        if (r.error || !u) return { error: true };
        return { allowed: !!u.allowed };
      },
    };
    return { ok: true, ctx };
  }

  async function propose(req: { actionId: unknown; companyId: string; input: unknown }): Promise<ProposeOutcome> {
    const resolved = resolveJarvisAction(req.actionId);
    if (!resolved.ok) return refuse(resolved.code, resolved.reason);
    const action = resolved.action;
    const parsed = action.inputSchema.safeParse(req.input);
    if (!parsed.success) return refuse("invalid_input", "That request is not valid.");
    const auth = await authorize(action, req.companyId, "propose");
    if (!auth.ok) return auth;
    const started = Date.now();
    try {
      const p = await action.propose(auth.ctx, parsed.data);
      let confirmation: { id: string; token: string; expiresAt: string } | null = null;
      if (p.valid && action.execute) {
        // The PROOF: a keyed MAC over the person, company, action, target, version, expiry, proof id and the SHA-256 of the exact payload text the database wrapper will receive.
        // The same MAC is verified inside the database before anything is written, so it cannot be invented or altered by the person holding it.
        const wire = action.wirePayload ? action.wirePayload(p.values, auth.ctx) : null;
        if (wire !== null && wire !== undefined) {
          const secret = auth.ctx.config.confirmationSecret!;
          const exp = Math.floor(auth.ctx.now.getTime() / 1000) + Math.floor(auth.ctx.config.confirmationTtlMs / 1000);
          const cid = deps.newId().toLowerCase();
          const tgt = p.target.kind === "new" ? "new" : p.target.id.toLowerCase();
          const ver = p.target.kind === "record" ? p.target.version : null;
          const token = issueProof({ cid, uid: auth.ctx.userId.toLowerCase(), co: auth.ctx.companyId.toLowerCase(), act: action.id, tgt, ver, exp, ph: payloadHash(canonicalJson(wire)) }, secret);
          confirmation = { id: cid, token, expiresAt: new Date(exp * 1000).toISOString() };
        }
      }
      jarvisLog({ event: "propose", actionId: action.id, outcome: p.valid ? "ready" : "needs_input", ms: Date.now() - started, providerKind: auth.ctx.provider?.kind });
      return { ok: true, card: p.card, confirmation, describe: action.describe(p.values) };
    } catch (e) {
      if (e instanceof JarvisRefusalError) { jarvisLog({ event: "refused", actionId: action.id, code: e.code }); return refuse(e.code, e.message); }
      jarvisLog({ event: "propose", actionId: action.id, outcome: "error" });
      return refuse("provider_error", "JARVIS could not do that just now. Sales & CRM is not affected: you can add the enquiry yourself.");
    }
  }

  async function execute(req: { actionId: unknown; companyId: string; token: string; values: unknown; acknowledgements?: Record<string, unknown> }): Promise<ExecuteOutcome> {
    const resolved = resolveJarvisAction(req.actionId);
    if (!resolved.ok) return refuse(resolved.code, resolved.reason);
    const action = resolved.action;
    if (!action.execute) return refuse("action_disabled", "That action cannot make changes.");
    const auth = await authorize(action, req.companyId, "execute");
    if (!auth.ok) return auth;
    const { ctx } = auth;
    const v = verifyProof(req.token, ctx.config.confirmationSecret!, ctx.now);
    if (!v.ok) {
      jarvisLog({ event: "refused", actionId: action.id, code: `token_${v.reason}` });
      return v.reason === "expired" ? refuse("token_expired", "This review has expired. Review the details again before creating anything.") : refuse("token_invalid", "This confirmation is not valid. Review the details again.");
    }
    const p = v.fields;
    if (p.uid !== ctx.userId.toLowerCase() || p.act !== action.id) { jarvisLog({ event: "refused", actionId: action.id, code: "token_binding" }); return refuse("token_invalid", "This confirmation is not valid. Review the details again."); }
    if (p.co !== req.companyId.toLowerCase()) return refuse("company_changed", "The company changed since you reviewed this. Review the details again.");
    const values = action.valuesSchema.safeParse(req.values);
    if (!values.success) return refuse("invalid_input", "The details are not valid. Review them again.");
    // The payload text is rebuilt from the (possibly edited) values and must be the one the proof was issued for: an edited value needs a NEW review and a NEW proof.
    const wire = action.wirePayload ? action.wirePayload(values.data, ctx) : null;
    if (wire === null || wire === undefined) return refuse("invalid_input", "The details are not valid. Review them again.");
    const payload = canonicalJson(wire);
    if (payloadHash(payload) !== p.ph) { jarvisLog({ event: "refused", actionId: action.id, code: "values_changed" }); return { ...refuse("values_changed", "The details changed after the review. Press Review changes to check them again before creating anything."), confirmationId: p.cid }; }
    if ((values.data as { companyId?: string }).companyId !== undefined && (values.data as { companyId?: string }).companyId!.toLowerCase() !== p.co) return refuse("company_changed", "The company changed since you reviewed this. Review the details again.");
    const target: JarvisTarget = p.tgt === "new" ? { kind: "new" } : { kind: "record", id: p.tgt, version: p.ver };
    const proof: ProofCall = { confirmationId: p.cid, company: p.co, target: p.tgt, version: p.ver, expires: p.exp, mac: v.mac, payload };
    const own = action.authorize ? await action.authorize(ctx, values.data, target, { confirmationId: p.cid }) : ({ ok: true } as const);
    if (!own.ok) { jarvisLog({ event: "refused", actionId: action.id, code: own.code ?? "not_permitted" }); return { ...refuse(own.code ?? "not_permitted", own.message), confirmationId: p.cid }; }
    const started = Date.now();
    try {
      const out = await action.execute(ctx, { confirmationId: p.cid, proof, values: values.data, target, acknowledgements: req.acknowledgements ?? {} });
      if (out.kind === "ambiguous") { jarvisLog({ event: "execute", actionId: action.id, outcome: "ambiguous", ms: Date.now() - started }); return { ...refuse("ambiguous", "We did not get an answer to the save. Checking the original result: nothing will be created twice."), confirmationId: p.cid }; }
      if (out.kind === "refused") { jarvisLog({ event: "execute", actionId: action.id, outcome: out.code, ms: Date.now() - started }); return { ...refuse(out.code, out.message), confirmationId: p.cid }; }
      if (action.verify) {
        let ok = false;
        try { ok = (await action.verify(ctx, out.result)).ok; } catch { ok = false; }
        if (!ok) { jarvisLog({ event: "execute", actionId: action.id, outcome: "unverified", ms: Date.now() - started }); return { ...refuse("ambiguous", "The save was recorded but could not be confirmed yet. Checking the original result."), confirmationId: p.cid }; }
      }
      jarvisLog({ event: "execute", actionId: action.id, outcome: out.replayed ? "replayed" : "done", ms: Date.now() - started });
      return { ok: true, confirmationId: p.cid, result: out.result, replayed: out.replayed };
    } catch (e) {
      if (e instanceof JarvisRefusalError) return { ...refuse(e.code, e.message), confirmationId: p.cid };
      jarvisLog({ event: "execute", actionId: action.id, outcome: "ambiguous" });
      return { ...refuse("ambiguous", "We did not get an answer to the save. Checking the original result: nothing will be created twice."), confirmationId: p.cid };
    }
  }

  /** Read-only: what the ledger recorded for one of the person's own confirmations. Never writes; never offers a second save. */
  async function status(confirmationId: unknown): Promise<StatusResult> {
    if (typeof confirmationId !== "string" || !UUID.test(confirmationId)) return refuse("invalid_input", "That confirmation is not valid.");
    const auth = await authorize(null, null, "read");
    if (!auth.ok) return auth;
    const r = await auth.ctx.supabase.from("jarvis_action_ledger").select("action_id, target, status, result_id, result_ref, result_extra, error_message").eq("confirmation_id", confirmationId).maybeSingle();
    if (r.error) return refuse("unavailable", "Could not check the result right now. Try again in a moment.");
    const row = r.data as { action_id: string; target: string; status: string; result_id: string | null; result_ref: string | null; result_extra?: Record<string, unknown> | null; error_message: string | null } | null;
    if (!row || row.status === "pending") return { ok: true, state: "not_recorded" };
    if (row.status === "done" && row.result_id && row.result_ref) {
      const a = listJarvisActions().find((x) => x.id === row.action_id);
      if (a?.resultView) {
        const v = a.resultView({ resultId: row.result_id, reference: row.result_ref, extra: row.result_extra ?? null, target: row.target });
        return { ok: true, state: "done", reference: v.reference, opportunityId: row.result_id, href: v.href, summary: v.summary, actionId: row.action_id };
      }
      return { ok: true, state: "done", reference: row.result_ref, opportunityId: row.result_id, href: `/sales/opportunities/${row.result_id}`, actionId: row.action_id };
    }
    return { ok: true, state: "failed", message: row.error_message ?? "That was not saved." };
  }

  /** Deterministic: no provider, no model. What JARVIS can and cannot do right now, from the registry. */
  function help(): HelpView {
    const all = listJarvisActions();
    return {
      enabled: all.filter((a) => a.status.enabled).map((a) => ({ id: a.id, title: a.title, description: a.description })),
      disabled: all.filter((a) => !a.status.enabled).map((a) => ({ id: a.id, title: a.title, reason: a.status.reason ?? "Not available yet." })),
    };
  }

  /**
   * The interface asks this to decide whether to show the launcher at all. Hiding the launcher is NOT access control: every call above checks again.
   * `knownUserId` is the layout's own authenticated session (saves a second sign-in round trip on every page); it only decides visibility.
   */
  async function availability(knownUserId?: string): Promise<LauncherState> {
    const none: LauncherState = { available: false, writes: false, companies: [], maxInputChars: 0, enabledActionIds: [] };
    const config = deps.config();
    if (configUnavailableReason(config, { needsProvider: true, needsSecret: true })) return none;
    if (!deps.provider(config)) return none;
    const userId = knownUserId ?? (await deps.identity())?.userId;
    if (!userId) return none;
    const supabase = await deps.supabase();
    const acc = await supabase.rpc("jarvis_my_access", { p_company_id: null });
    // PGRST202 = the function does not exist yet (the migration is not applied): JARVIS is simply unavailable, quietly.
    if (acc.error && (acc.error as { code?: string }).code !== "PGRST202") jarvisLog({ event: "availability", code: "access_unreadable" });
    const row = (Array.isArray(acc.data) ? acc.data[0] : acc.data) as { is_available?: boolean; writes_allowed?: boolean } | null | undefined;
    if (acc.error || !row?.is_available) return none;
    const all = await deps.companies({ supabase, userId });
    if (all === "error") return none;
    // Only companies the pilot covers are offered (the pilot company list, when the owner set one): the picker never offers a company the server would refuse.
    const allowed = await Promise.all(all.map(async (c) => {
      const r = await supabase.rpc("jarvis_my_access", { p_company_id: c.id });
      const a = (Array.isArray(r.data) ? r.data[0] : r.data) as { company_allowed?: boolean } | null | undefined;
      return !r.error && !!a?.company_allowed;
    }));
    const companies = all.filter((_, i) => allowed[i]);
    if (companies.length === 0) return none;
    return { available: true, writes: !!row.writes_allowed, companies, maxInputChars: config.maxInputChars, enabledActionIds: listJarvisActions().filter((a) => a.status.enabled).map((a) => a.id) };
  }

  return { authorize, propose, execute, status, help, availability };
}

export type JarvisDispatcher = ReturnType<typeof createDispatcher>;
export const defaultNewId = () => randomUUID();
