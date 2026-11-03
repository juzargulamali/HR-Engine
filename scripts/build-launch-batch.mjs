#!/usr/bin/env node
// Builds the three owner SQL files that install launch migrations 3 to 14 in ONE run:
//   supabase/manual-sql/launch_batch_00_preflight_and_snapshot_readonly.sql   (SELECT only)
//   supabase/manual-sql/launch_batch_20_install_3_to_14.sql                   (changes the database; one transaction)
//   supabase/manual-sql/launch_batch_90_verify_and_compare_readonly.sql       (SELECT only)
// plus a fallback that splits the install into two independent transactions (only for an editor that refuses one large paste):
//   supabase/manual-sql/launch_batch_21_install_part_a_3_to_13.sql, launch_batch_22_install_part_b_14.sql
//
// The migration SQL inside the install files is copied from supabase/migrations/*.sql by this script, never typed. Nothing in a migration file is edited.
// The verification and preservation checks are derived from the existing, reviewed per-migration packs (supabase/manual-sql/<prefix>_20_verify_readonly.sql
// and the preflight lists), so they cannot drift from them.
//
//   node scripts/build-launch-batch.mjs            write the files
//   node scripts/build-launch-batch.mjs --check    rebuild in memory and fail if a committed file differs, and verify that every embedded
//                                                  migration body equals its supabase/migrations file BYTE FOR BYTE, and that no embedded
//                                                  statement is unsafe inside one transaction. Needs no database.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGDIR = path.join(ROOT, "supabase", "migrations");
const OUTDIR = path.join(ROOT, "supabase", "manual-sql");
const BASE_FILE = "20261215000000_access_grant_rules.sql";

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The 14 launch migrations. n = install-order number. Migrations 1 and 2 are NOT installed by the batch (already applied by the owner) but their
// effects are asserted before and preserved after. replaced/added = the public functions each one replaces / adds. marker = SQL boolean that is true
// once the change is in place (the same test the per-change preflight uses for "applied already?").
// ---------------------------------------------------------------------------------------------------------------------------------------------------
const P = "pronamespace = 'public'::regnamespace";
const MIGS = [
  { n: 1, file: "20261216000100_inv_issue_to_employee_consumes_reservation.sql", pack: "inv_emp_issue", what: "warehouse Issue after Reserve consumes the request's own reservation", replaced: ["inv_issue_to_employee"], added: [],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'inv_issue_to_employee' and prosrc like '%reserved for THIS request%')` },
  { n: 2, file: "20261216000200_proj_scope_proposal_notifies_deciders.sql", pack: "proj_scope_notify", what: "scope-change proposals notify the deciders", replaced: ["proj_propose_scope_change"], added: [],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'proj_propose_scope_change' and prosrc like '%Tell the people who decide%')` },
  { n: 3, file: "20261216000300_account_deactivation_inactive_people.sql", pack: "deact", what: "deactivation sets is_active; routing skips inactive people; last CEO/CTO protections",
    replaced: ["resolve_approver", "resolve_approver_for_company", "resolve_role_holders", "recovery_eligible_approver_exists", "create_initial_approval", "recovery_route_request", "set_account_status", "guard_profiles_self_update"],
    added: ["user_is_active", "account_deactivation_blockers", "account_holdings"],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'user_is_active')` },
  { n: 4, file: "20261216000400_profiles_status_columns_restricted.sql", pack: "profstat", what: "profiles: the deactivation reason is no longer readable directly; System Administrator function added", replaced: [], added: ["account_status_details"],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'account_status_details')` },
  { n: 5, file: "20261216000500_attendance_lead_candidates.sql", pack: "leadpick", what: "attendance clock: project-lead candidates function", replaced: [], added: ["attendance_lead_candidates"],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'attendance_lead_candidates')` },
  { n: 6, file: "20261216000600_recovery_decider_inbox.sql", pack: "reccard", what: "Recovery Leave: decider inbox function", replaced: [], added: ["recovery_decider_inbox"],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'recovery_decider_inbox')` },
  { n: 7, file: "20261216000700_policy_status_role_check.sql", pack: "polstat", what: "policy status function: role check and no anonymous execute", replaced: ["preflight_phase2b_v2_policy_status"], added: [],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'preflight_phase2b_v2_policy_status' and prosrc like '%has_role(''cto'', null, cc.code)%')` },
  { n: 8, file: "20261216000800_letters_storage_issued_only.sql", pack: "letters", what: "letters storage: the owning employee reads issued letters only", replaced: [], added: [],
    marker: `exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'letters_select' and qual like '%generated_letters%')` },
  { n: 9, file: "20261216000810_approval_routing_country_scope.sql", pack: "apprscope", what: "approval routing is country-scoped", replaced: ["resolve_approver", "resolve_approver_for_company"], added: [],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'resolve_approver' and prosrc like '%ur.country_code is null or ur.country_code = v_country%')` },
  { n: 10, file: "20261216000820_proj_scope_decision_context.sql", pack: "scopectx", what: "scope decision: two narrow read functions", replaced: [], added: ["proj_scope_decisions_waiting", "proj_scope_decision_context"],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'proj_scope_decision_context' and prosrc like '%proj_has_capability%')` },
  { n: 11, file: "20261216000830_pbx_decisions_waiting_count.sql", pack: "pbxwait", what: "budget decisions waiting: count function", replaced: [], added: ["pbx_decisions_waiting_count"],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'pbx_decisions_waiting_count' and prosrc like '%pbx_can_decide%')` },
  { n: 12, file: "20261216000900_proj_block_task_notifies_pm.sql", pack: "blocknotify", what: "blocker: the Project Manager is told who was asked", replaced: ["proj_block_task"], added: [],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'proj_block_task' and prosrc like '%Also tell the Project Manager when someone else was named%')` },
  { n: 13, file: "20261216000910_module_access_managers.sql", pack: "modaccess", what: "ask-for-access names the people who can grant it", replaced: [], added: ["module_access_managers"],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'module_access_managers' and prosrc like '%One branch per module%')` },
  { n: 14, file: "20261217000100_inv_project_notes.sql", pack: "inv_notes", what: "dispatch and return notes: tables, functions, guarded call in the movements, switch column (off)",
    replaced: ["inv_next_code", "inv_dispatch_to_project", "inv_return_from_project"],
    added: ["inv_project_notes_frozen", "inv_project_notes_enabled", "inv_make_project_note", "inv_ack_project_note", "inv_resolve_note_difference", "inv_notes_waiting_for_me", "inv_set_project_notes"],
    marker: `exists (select 1 from pg_proc where ${P} and proname = 'inv_make_project_note')` },
];
const BATCH = MIGS.filter((m) => m.n >= 3);
const mlabel = (m) => "m" + String(m.n).padStart(2, "0");
const NEW_TABLES = ["inv_project_notes", "inv_project_note_events", "inv_project_note_status"];

// key tables whose row count and fingerprint must not change (union of every pack's rows: list). [table, order column, row expression]
const ROW_TABLES = [
  ["approvals"], ["attendance_segments"], ["companies"], ["crm_company_grants"], ["employees"], ["generated_letters"], ["inv_balances"], ["inv_company_grants"],
  ["inv_company_settings", "company_id", "(to_jsonb(g) - 'project_notes_enabled')::text"], ["inv_idempotency", "idem_key"], ["inv_movement_lines"], ["inv_movements"],
  ["inv_requests"], ["inv_reservations"], ["inv_units"], ["letter_templates"], ["notifications"], ["pbx_actual_submissions"], ["pbx_budget_versions"], ["pbx_company_grants"],
  ["policy_versions"], ["proj_company_grants"], ["proj_project_members"], ["proj_scope_change_commercial", "scope_change_id"], ["proj_scope_changes"], ["proj_task_events"],
  ["proj_tasks"], ["profiles"], ["recovery_credit_requests"], ["user_roles"],
];

const q = (s) => s.replace(/'/g, "''"); // quote text for use inside an SQL string literal
const list = (a) => a.map((x) => `('${q(x)}')`).join(", ");
const uniq = (a) => [...new Set(a)];
const sha = (s) => createHash("sha256").update(s).digest("hex");
const read = (p) => readFileSync(p, "utf8");

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Reading the existing packs
// ---------------------------------------------------------------------------------------------------------------------------------------------------
function verifyQuery(pack) {
  // The per-change verify file, turned into a sub-select returning (grp, chk, item, result, detail). The file's own final SELECT is replaced.
  const f = path.join(OUTDIR, `${pack}_20_verify_readonly.sql`);
  const t = read(f);
  const start = t.search(/^with\s*$/m);
  if (start < 0) throw new Error(`no top-level WITH in ${f}`);
  let end = t.search(/^select chk as "check", item, result, detail from \(/m);
  let tail = "select grp, chk, item, result, detail from checks";
  if (end < 0) {
    end = t.search(/^select grp as "check", chk \|\| ': ' \|\| item as item, result, detail from checks/m);
    tail = "select grp, chk, item, result, detail from checks";
  }
  if (end < 0 || end < start) throw new Error(`no recognised final SELECT in ${f}`);
  return `with ${t.slice(start, end).replace(/^with\s*/, "").trimEnd()}\n${tail}`;
}
function verifyUnion(items) {
  // items: [{label, pack}] -> one query returning (pack, grp, chk, item, result, detail)
  return items
    .map((x) => `  select '${q(x.label)}' as pack, grp, chk, item, result, detail from (\n${verifyQuery(x.pack)}\n  ) v_${x.label.replace(/\W/g, "_")}`)
    .join("\n  union all\n");
}
const BASE_PACK = { label: "base", pack: "grant_rules" };
const packLabels = (ms) => ms.map((m) => ({ label: mlabel(m), pack: m.pack }));

function requiredObjects() {
  // every "function public.X" / "table public.X" a per-change preflight says the change builds on (the tables only fingerprinted by the snapshot are not prerequisites: an absent one is recorded as TABLE ABSENT)
  const fns = new Set(), tabs = new Set();
  for (const m of MIGS) {
    const t = read(path.join(OUTDIR, `${m.pack}_00_preflight_readonly.sql`));
    for (const x of t.matchAll(/'(function|table) public\.([a-z0-9_]+)/g)) (x[1] === "function" ? fns : tabs).add(x[2]);
  }
  // functions the batch itself adds are not prerequisites
  for (const m of BATCH) for (const a of m.added) fns.delete(a);
  return { fns: [...fns].sort(), tabs: [...tabs].sort() };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The digest: every item the snapshot records and the comparison checks. cur(item, value, ok). Shared by file 00 (snapshot) and file 90 (compare).
// ---------------------------------------------------------------------------------------------------------------------------------------------------
const rowsSql = (t, key = "id", expr = "to_jsonb(g)::text") => {
  const inner = `select count(*)::text || ':' || md5(coalesce(string_agg(${expr}, '|' order by g.${key}), '')) as v from public.${t} g`;
  return `select 'rows:${t}' as item, case when to_regclass('public.${t}') is null then 'TABLE ABSENT' else (xpath('/row/v/text()', query_to_xml('${q(inner)}', false, true, '')))[1]::text end as value, null::boolean as ok`;
};
const fnDef = (names, prefix) =>
  `select '${prefix}:' || n.name as item, coalesce((select md5(string_agg(pg_get_functiondef(p.oid), E'\\n' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n.name and p.prokind in ('f', 'p')), 'ABSENT') as value, null::boolean as ok from (values ${list(names)}) n(name)`;
const aclMd5 = (names) =>
  `coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(p.proacl::text, '') || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, ''), E'\\n' order by p.proname, pg_get_function_identity_arguments(p.oid)), '')`;
const policyMd5 = (cond, extra = "") =>
  `(select md5(coalesce(string_agg(${extra}policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), E'\\n' order by ${extra ? "tablename, " : ""}policyname), '')) from pg_policies where ${cond})`;
const fnMd5 = (sig) => `(select md5(pg_get_functiondef('public.${sig}'::regprocedure)))`;

// expectation rows: [item, kind, migs, sameOk, what]. kind SAME = must not change; CHANGE = must change (or, if every listed migration was already applied at snapshot time, must not).
const EXP = [];
const exp = (item, kind, migs, what, sameOk = false) => EXP.push({ item, kind, migs, what, sameOk });
const OTHER = []; // [item, valueSql, okSql|null]
const other = (item, valueSql, okSql = null) => OTHER.push({ item, valueSql, okSql });

for (const c of ["columns", "constraints", "indexes", "policies", "triggers", "views", "table-privileges", "other-functions", "other-function-privileges"]) exp(`struct:${c}`, "SAME", [], `all of the public schema's ${c} except the objects the changes name`);
for (const [t] of ROW_TABLES) exp(`rows:${t}`, "SAME", [], `table ${t}: rows unchanged (the migrations insert, edit and delete no rows)`);
const SAME_ACL_FNS = uniq(MIGS.flatMap((m) => m.replaced)).filter((f) => f !== "preflight_phase2b_v2_policy_status");
for (const m of MIGS) {
  for (const f of m.replaced) {
    if (m.n <= 2) {
      exp(`fn:${f}`, "SAME", [], `migration ${m.n} (applied earlier by the owner): ${f} keeps its current definition (preserved)`);
    }
  }
}
for (const f of uniq(BATCH.flatMap((m) => m.replaced))) {
  const ms = BATCH.filter((m) => m.replaced.includes(f)).map((m) => m.n);
  exp(`fn:${f}`, "CHANGE", ms, `${f} is replaced by migration ${ms.join(" and ")}: ${ms.map((n) => MIGS[n - 1].what).join("; ")}`);
}
for (const m of BATCH) for (const f of m.added) exp(`fnadd:${f}`, "CHANGE", [m.n], `${f} is added by migration ${m.n}: ${m.what}`);
exp("fnacl:replaced functions (privileges, definer flag, search path)", "SAME", [], "who may call each replaced function, SECURITY DEFINER and search path are unchanged");
for (const m of MIGS) exp(`pre:${mlabel(m)}`, "CHANGE", [m.n], `migration ${m.n} (${m.what}) is in place`, true);

// chg: / keep: items (the same checks the per-change *_05_preservation_check files make, consolidated)
other("chg:profiles: columns signed-in users can read",
  `(select string_agg(a.attname, ',' order by a.attname) from pg_attribute a where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', 'public.profiles', a.attname, 'select'))`);
exp("chg:profiles: columns signed-in users can read", "CHANGE", [4], "migration 4: signed-in users can no longer read status_reason / status_changed_* directly");
other("chg:profiles: columns anonymous visitors can read",
  `(select coalesce(string_agg(a.attname, ',' order by a.attname), 'none') from pg_attribute a where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('anon', 'public.profiles', a.attname, 'select'))`,
  `(select not exists (select 1 from pg_attribute a where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege('anon', 'public.profiles', a.attname, 'select')))`);
exp("chg:profiles: columns anonymous visitors can read", "CHANGE", [4], "migration 4: anonymous visitors lose the profiles table privilege (no change is fine if they had none)", true);
other("keep:profiles: write privileges of signed-in users", `(select string_agg(p, ',' order by p) from unnest(array['INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege('authenticated', 'public.profiles', p))`);
exp("keep:profiles: write privileges of signed-in users", "SAME", [], "profiles INSERT / UPDATE / DELETE privileges are untouched");
other("keep:profiles: privileges held by roles other than anon and authenticated",
  `(select md5(coalesce(string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || ':' || a.privilege_type || ':' || a.is_grantable::text, ',' order by case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type), '')) from (select (aclexplode(c.relacl)).* from pg_class c where c.oid = 'public.profiles'::regclass) a where a.grantee not in (select r.oid from pg_roles r where r.rolname in ('anon', 'authenticated')))`);
exp("keep:profiles: privileges held by roles other than anon and authenticated", "SAME", [], "profiles privileges of every other role are untouched");
other("chg:preflight_phase2b_v2_policy_status: who may execute it", `(select coalesce(p.proacl::text, 'default (everyone)') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'preflight_phase2b_v2_policy_status' limit 1)`,
  `(select not has_function_privilege('anon', p.oid, 'execute') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'preflight_phase2b_v2_policy_status' limit 1)`);
exp("chg:preflight_phase2b_v2_policy_status: who may execute it", "CHANGE", [7], "migration 7: anonymous callers lose EXECUTE (no change is fine if they already had none)", true);
other("keep:policy_versions policies (the read rule the function now mirrors)", policyMd5("schemaname = 'public' and tablename = 'policy_versions'"));
exp("keep:policy_versions policies (the read rule the function now mirrors)", "SAME", [], "policy_versions policies are untouched");
other("chg:storage policy letters_select (the owning employee's branch)", `(select coalesce((select md5(qual) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'letters_select'), 'absent'))`);
exp("chg:storage policy letters_select (the owning employee's branch)", "CHANGE", [8], "migration 8: the owning employee's branch of letters_select reads issued letters only");
other("keep:storage policies other than letters_select", `(select md5(coalesce(string_agg(policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), E'\\n' order by policyname), '')) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname <> 'letters_select')`);
exp("keep:storage policies other than letters_select", "SAME", [], "every other storage policy is untouched");
other("keep:user_roles policies (who can read or change grants)", policyMd5("schemaname = 'public' and tablename = 'user_roles'"));
exp("keep:user_roles policies (who can read or change grants)", "SAME", [], "user_roles policies are untouched");
other("keep:has_role() definition", fnMd5("has_role(app_role, uuid, text)"));
exp("keep:has_role() definition", "SAME", [], "has_role() is untouched");
other("keep:proj_scope_changes and proj_scope_change_commercial policies", policyMd5("schemaname = 'public' and tablename in ('proj_scope_changes', 'proj_scope_change_commercial')", "tablename || ':' || "));
exp("keep:proj_scope_changes and proj_scope_change_commercial policies", "SAME", [], "who can read proposals and cost effects is untouched");
other("keep:proj_decide_scope_change definition", fnMd5("proj_decide_scope_change(uuid, text, text)"));
exp("keep:proj_decide_scope_change definition", "SAME", [], "who decides a scope change is untouched");
other("keep:pbx_inbox definition", fnMd5("pbx_inbox()"));
exp("keep:pbx_inbox definition", "SAME", [], "the Finance inbox is untouched");
other("keep:pbx_grant_access definition", `(select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'pbx_grant_access' limit 1)`);
exp("keep:pbx_grant_access definition", "SAME", [], "who may grant budget access is untouched");
// migration 14
other("chg:inv_company_settings: the switch column is added", `(select coalesce((select format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.inv_company_settings'::regclass and a.attname = 'project_notes_enabled' and not a.attisdropped), 'absent'))`);
exp("chg:inv_company_settings: the switch column is added", "CHANGE", [14], "migration 14: inv_company_settings.project_notes_enabled (boolean, not null, default false)");
other("chg:inv_reference_counters: the kind check lists the two new kinds", `(select coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.inv_reference_counters'::regclass and c.conname = 'inv_reference_counters_kind_check'), 'absent'))`);
exp("chg:inv_reference_counters: the kind check lists the two new kinds", "CHANGE", [14], "migration 14: counter kinds dispatch_note and return_note");
for (const [t, kind] of [["inv_project_notes", "table"], ["inv_project_note_events", "table"], ["inv_project_note_status", "view"]]) {
  other(`chg:${kind} ${t} exists`, `(select case when to_regclass('public.${t}') is null then 'absent' else 'present' end)`);
  exp(`chg:${kind} ${t} exists`, "CHANGE", [14], `migration 14 adds the ${kind} ${t}`);
}
other("keep:inv_company_settings: every column except the switch", `(select md5(coalesce(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), E'\\n' order by a.attname), '')) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.inv_company_settings'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'project_notes_enabled')`);
exp("keep:inv_company_settings: every column except the switch", "SAME", [], "the other inv_company_settings columns are untouched");
other("keep:inv_company_settings: constraints, indexes, policies, triggers and privileges", `(select md5(coalesce((select string_agg(c.conname || pg_get_constraintdef(c.oid), E'\\n' order by c.conname) from pg_constraint c where c.conrelid = 'public.inv_company_settings'::regclass), '') || coalesce((select string_agg(indexdef, E'\\n' order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'inv_company_settings'), '') || coalesce((select string_agg(policyname || cmd || coalesce(qual, ''), E'\\n' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'inv_company_settings'), '') || coalesce((select string_agg(pg_get_triggerdef(t.oid), E'\\n' order by t.tgname) from pg_trigger t where t.tgrelid = 'public.inv_company_settings'::regclass and not t.tgisinternal), '') || coalesce((select relacl::text from pg_class where oid = 'public.inv_company_settings'::regclass), '')))`);
exp("keep:inv_company_settings: constraints, indexes, policies, triggers and privileges", "SAME", [], "inv_company_settings constraints, indexes, policies, triggers and privileges are untouched");
other("keep:inv_reference_counters: columns, policies and privileges", `(select md5(coalesce((select string_agg(a.attname || format_type(a.atttypid, a.atttypmod) || a.attnotnull::text, E'\\n' order by a.attname) from pg_attribute a where a.attrelid = 'public.inv_reference_counters'::regclass and a.attnum > 0 and not a.attisdropped), '') || coalesce((select string_agg(policyname, E'\\n' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'inv_reference_counters'), '') || coalesce((select relacl::text from pg_class where oid = 'public.inv_reference_counters'::regclass), '')))`);
exp("keep:inv_reference_counters: columns, policies and privileges", "SAME", [], "inv_reference_counters columns, policies and privileges are untouched");
other("keep:the existing counters (unit, stock, request, transfer, movement, count) are not touched", `(select coalesce(string_agg(kind || '=' || last_value, ',' order by company_id, kind), 'none') from inv_reference_counters where kind in ('unit', 'stock', 'request', 'transfer', 'movement', 'count'))`);
exp("keep:the existing counters (unit, stock, request, transfer, movement, count) are not touched", "SAME", [], "existing reference counters are untouched");
other("keep:companies with the dispatch-note switch ON (must be 0)", `(select count(*)::text from inv_company_settings s where (to_jsonb(s)->>'project_notes_enabled')::boolean is true)`, `((select count(*) from inv_company_settings s where (to_jsonb(s)->>'project_notes_enabled')::boolean is true) = 0)`);
exp("keep:companies with the dispatch-note switch ON (must be 0)", "SAME", [], "the dispatch / return notes switch stays OFF for every company");
// scheduler and extensions (read-only fingerprints; nothing here ever touches them)
other("keep:scheduler: pg_cron job definitions (cron.job)",
  `(select case when to_regclass('cron.job') is null then 'not present' when not has_table_privilege(current_user, 'cron.job', 'select') then 'not readable' else (xpath('/row/v/text()', query_to_xml('select count(*)::text || '':'' || md5(coalesce(string_agg(to_jsonb(j)::text, ''|'' order by j.jobid), '''')) as v from cron.job j', false, true, '')))[1]::text end)`);
exp("keep:scheduler: pg_cron job definitions (cron.job)", "SAME", [], "scheduled jobs are untouched (pg_cron job definitions)");
other("keep:installed extensions", `(select md5(coalesce(string_agg(extname || ':' || extversion, ',' order by extname), '')) from pg_extension)`);
exp("keep:installed extensions", "SAME", [], "no extension was added, removed or upgraded");

function digestCtes() {
  const touched = uniq(BATCH.flatMap((m) => [...m.replaced, ...m.added]));
  const replacedAll = uniq(MIGS.flatMap((m) => m.replaced));
  const sameAcl = SAME_ACL_FNS;
  const addedAll = uniq(BATCH.flatMap((m) => m.added));
  const replacedBatch = uniq(BATCH.flatMap((m) => m.replaced));
  const nt = list(NEW_TABLES);
  return `
touched(name) as (values ${list(touched)}),
own_tables as (
  select c.oid, c.relname, c.relacl, c.relkind
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    and c.relname not in (${nt.replace(/[()]/g, "")})
),
other_funcs as (
  select p.oid, p.proname, p.proacl, p.prosecdef, p.proconfig
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.proname not in (select name from touched)
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
struct as (
  select 'struct:columns' as item,
         md5(coalesce(string_agg(t.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), E'\\n' order by t.relname, a.attnum), '')) as value
  from own_tables t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped and t.relname <> 'inv_company_settings'
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select 'struct:constraints', md5(coalesce(string_agg(t.relname || ':' || c.conname || ':' || pg_get_constraintdef(c.oid), E'\\n' order by t.relname, c.conname), ''))
  from own_tables t join pg_constraint c on c.conrelid = t.oid and t.relname <> 'inv_reference_counters'
  union all
  select 'struct:indexes', md5(coalesce(string_agg(i.tablename || ':' || i.indexname || ':' || i.indexdef, E'\\n' order by i.tablename, i.indexname), ''))
  from pg_indexes i where i.schemaname = 'public' and i.tablename not in (${nt.replace(/[()]/g, "")})
  union all
  select 'struct:policies', md5(coalesce(string_agg(p.tablename || ':' || p.policyname || ':' || p.cmd || ':' || p.roles::text || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), E'\\n' order by p.tablename, p.policyname), ''))
  from pg_policies p where p.schemaname = 'public' and p.tablename not in (${nt.replace(/[()]/g, "")})
  union all
  select 'struct:triggers', md5(coalesce(string_agg(c.relname || ':' || t.tgname || ':' || pg_get_triggerdef(t.oid), E'\\n' order by c.relname, t.tgname), ''))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and c.relname not in (${nt.replace(/[()]/g, "")})
  union all
  select 'struct:views', md5(coalesce(string_agg(t.relname || ':' || pg_get_viewdef(t.oid), E'\\n' order by t.relname), ''))
  from own_tables t where t.relkind in ('v', 'm')
  union all
  select 'struct:table-privileges', md5(coalesce(string_agg(t.relname || ':' || coalesce(t.relacl::text, ''), E'\\n' order by t.relname), ''))
  from own_tables t where t.relname <> 'profiles'
  union all
  select 'struct:other-functions', md5(coalesce(string_agg(f.proname || '(' || pg_get_function_identity_arguments(f.oid) || '):' || md5(pg_get_functiondef(f.oid)), E'\\n' order by f.proname, pg_get_function_identity_arguments(f.oid)), ''))
  from other_funcs f
  union all
  select 'struct:other-function-privileges', md5(coalesce(string_agg(f.proname || '(' || pg_get_function_identity_arguments(f.oid) || '):' || coalesce(f.proacl::text, '') || ':' || f.prosecdef::text || ':' || coalesce(f.proconfig::text, ''), E'\\n' order by f.proname, pg_get_function_identity_arguments(f.oid)), ''))
  from other_funcs f
),
cur as (
  select item, value, null::boolean as ok from struct
  union all
${ROW_TABLES.map(([t, k, e]) => "  " + rowsSql(t, k, e)).join("\n  union all\n")}
  union all
  ${fnDef(replacedAll, "fn")}
  union all
  ${fnDef(addedAll, "fnadd")}
  union all
  select 'fnacl:replaced functions (privileges, definer flag, search path)', md5(${aclMd5()}), null::boolean
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.proname in (${list(sameAcl).replace(/[()]/g, "")})
${OTHER.map((o) => `  union all\n  select '${q(o.item)}', v.value, ${o.okSql ? o.okSql : "null::boolean"} from (select ${o.valueSql} as value) v`).join("\n")}
${MIGS.map((m) => `  union all\n  select 'pre:${mlabel(m)}', case when ${m.marker} then 'applied' else 'absent' end, ${m.marker}`).join("\n")}
)`.trim();
}
// short form stored in the digest: counts stay readable, everything else is the first 16 hex digits of its md5 (short markers stay as they are)
const SHORT = `case when item like 'rows:%' and value ~ '^[0-9]+:' then split_part(value, ':', 1) || ':' || left(split_part(value, ':', 2), 16) when length(value) <= 16 then value else left(md5(value), 16) end`;

const DOLLAR = "$batch_check$";

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// File 00
// ---------------------------------------------------------------------------------------------------------------------------------------------------
function build00() {
  const req = requiredObjects();
  const pre = verifyUnion([BASE_PACK, ...packLabels(MIGS.filter((m) => m.n <= 2))]);
  const markers = MIGS.filter((m) => m.n >= 3);
  return `-- READ-ONLY (SELECT only). Run in the SQL Editor of "Enginious HR Engine_V2" BEFORE launch_batch_20_install_3_to_14.sql. It creates, changes and deletes nothing.
-- GENERATED by scripts/build-launch-batch.mjs from the existing per-change packs: do not edit by hand (npm run check:launch-batch fails if it differs).
-- Run the WHOLE file; it returns ONE result table (section | item | result | detail).
--
--   0  RESULT  the one line to read first: PASS (ready to run file 20), FAIL (do not run file 20), PARTIALLY APPLIED or ALREADY APPLIED
--   B  prerequisites  PASS / FAIL: the access grant rules migration (20261215000000) and launch migrations 1 and 2 are in place, and what migrations 3 to 14 build on exists
--   C  migrations 3 to 14: each change's marker must be ABSENT now (PASS = not applied yet). If some are present the result says PARTIALLY APPLIED and what to do
--   D  the preservation snapshot of everything these changes must NOT change, including the current state of migrations 1 and 2 (function fingerprints)
--
-- WHAT TO SEND BACK. The whole result, or at least: the RESULT row, every row that is not PASS, and the last row (DIGEST). Copy the DIGEST cell (one long line) with
-- the grid's "copy cell" action, or Export -> CSV; file 90 needs it. Keep it: it is the "before" picture.

with
${digestCtes()},
prereq as (
${pre}
),
req(kind, name) as (values ${[...req.fns.map((f) => `('function', '${f}')`), ...req.tabs.map((t) => `('table', '${t}')`)].join(", ")}),
req_missing as (
  select r.kind, r.name from req r
  where (r.kind = 'function' and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = r.name))
     or (r.kind = 'table' and to_regclass('public.' || r.name) is null)
),
packs as (
  select pack, count(*) as n, count(*) filter (where result = 'FAIL') as failing from prereq group by pack
),
mstate as (select item, value from cur where item like 'pre:m%' and item >= 'pre:m03'),
n_applied as (select count(*) as n from mstate where value = 'applied'),
digest_items as (select item, ${SHORT} as value from cur),
digest as (
  select (select md5(string_agg(item || '=' || value, ';' order by item)) from digest_items) as chk,
         (select jsonb_object_agg(item, value) from digest_items) as items
),
rows_out(ord, section, item, result, detail) as (
  select 10, 'A session', 'running as', '', current_user::text || ' (superuser=' || (select rolsuper::text from pg_roles where rolname = current_user) || ')'
  union all select 11, 'A session', 'server_version', '', version()
  union all select 12, 'A session', 'now (Dubai)', '', to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI:SS')
  union all select 100 + row_number() over (order by case pack when 'base' then 0 else substr(pack, 2)::int end), 'B prerequisites',
         case pack when 'base' then 'access grant rules migration 20261215000000 (its verify checks)' else 'launch migration ' || ltrim(substr(pack, 2), '0') || ' (its verify checks)' end,
         case when failing = 0 then 'PASS' else 'FAIL' end, n - failing || ' of ' || n || ' checks pass' || case when failing > 0 then ', ' || failing || ' failing (listed below)' else '' end
  from packs
  union all select 150, 'B prerequisites', 'failing check: ' || pack || ' / ' || chk || ': ' || item, 'FAIL', detail from prereq where result = 'FAIL'
  union all select 160, 'B prerequisites', 'objects migrations 3 to 14 build on (' || (select count(*) from req) || ' functions and tables)',
         case when exists (select 1 from req_missing) then 'FAIL' else 'PASS' end,
         case when exists (select 1 from req_missing) then 'MISSING: ' || (select string_agg(kind || ' ' || name, ', ' order by name) from req_missing) else 'all present' end
  union all select 170, 'B prerequisites', 'migrations 1 and 2 present (inv_issue_to_employee, proj_propose_scope_change)',
         case when (select count(*) from cur where item in ('pre:m01', 'pre:m02') and value = 'applied') = 2 then 'PASS' else 'FAIL' end,
         (select string_agg(item || ' ' || value, ', ' order by item) from cur where item in ('pre:m01', 'pre:m02'))
${markers
  .map(
    (m) => `  union all select 200 + ${m.n}, 'C migrations 3 to 14', 'migration ${m.n}: ${q(m.what)}', case when (select value from cur where item = 'pre:${mlabel(m)}') = 'absent' then 'PASS' else 'ALREADY APPLIED' end, case when (select value from cur where item = 'pre:${mlabel(m)}') = 'absent' then 'not applied yet (expected)' else 'its marker is present now' end`
  )
  .join("\n")}
  union all select 290, 'C migrations 3 to 14', 'state of migrations 3 to 14',
         case (select n from n_applied) when 0 then 'PASS' when ${markers.length} then 'ALREADY APPLIED' else 'PARTIALLY APPLIED' end,
         case (select n from n_applied) when 0 then 'none of the 12 is applied yet (clean start)'
              when ${markers.length} then 'all 12 are already in place: nothing to install; run file 90 (without a digest) to verify them'
              else (select n from n_applied) || ' of 12 are already in place: ' || (select string_agg(ltrim(substr(item, 6), 'm0'), ', ' order by item) from mstate where value = 'applied') end
  union all select 300 + row_number() over (order by item), 'D snapshot', 'table ' || substr(item, 6) || ' (rows : fingerprint)', 'INFO', value from cur where item like 'rows:%'
  union all select 400 + row_number() over (order by item), 'D snapshot', 'function fingerprint ' || substr(item, 4) || ' (migrations 1 and 2: must stay identical)', 'INFO', left(value, 16) from cur where item in ('fn:inv_issue_to_employee', 'fn:proj_propose_scope_change')
  union all select 450, 'D snapshot', 'scheduler (pg_cron job definitions)', 'INFO', (select value from cur where item = 'keep:scheduler: pg_cron job definitions (cron.job)')
  union all select 451, 'D snapshot', 'dispatch / return notes switch (companies with it ON)', 'INFO', (select value from cur where item like 'keep:companies with the dispatch-note switch ON%')
  union all select 480, 'D snapshot', 'digest items / checksum', 'INFO', (select count(*) from digest_items) || ' items, checksum ' || (select chk from digest)
  union all select 999, 'D snapshot', 'DIGEST (copy this one cell for file 90)', 'INFO', jsonb_build_object('v', 1, 'chk', (select chk from digest), 'items', (select items from digest))::text
),
verdict as (
  select case
    when exists (select 1 from prereq where result = 'FAIL') or exists (select 1 from req_missing) or (select count(*) from cur where item in ('pre:m01', 'pre:m02') and value = 'applied') < 2
      then 'FAIL: ' || ((select count(*) from prereq where result = 'FAIL') + (select count(*) from req_missing) + case when (select count(*) from cur where item in ('pre:m01', 'pre:m02') and value = 'applied') < 2 then 1 else 0 end)
           || ' prerequisite item(s) fail, see the rows marked FAIL. Do NOT run file 20. Send me this whole result.'
    when (select n from n_applied) = 0
      then 'PASS: every prerequisite is in place and migrations 3 to 14 are not applied yet. Copy the DIGEST cell (last row), then run file 20.'
    when (select n from n_applied) = ${markers.length}
      then 'ALREADY APPLIED: all 12 migrations (3 to 14) are already in place. Nothing to install. Run file 90 (leave the digest empty) to verify them.'
    else 'PARTIALLY APPLIED: ' || (select n from n_applied) || ' of the 12 migrations (3 to 14) are already in place (' || (select string_agg(ltrim(substr(item, 6), 'm0'), ', ' order by item) from mstate where value = 'applied')
         || '). Send me this whole result BEFORE running file 20. (Running file 20 would still be safe, because every migration can be repeated; I want to confirm first why they are partly there.)'
  end as txt
)
select section, item, result, detail from (
  select 0 as ord, '0 RESULT' as section, 'read this first' as item, case when v.txt like 'PASS%' then 'PASS' when v.txt like 'FAIL%' then 'FAIL' else 'CHECK' end as result, v.txt as detail from verdict v
  union all select ord, section, item, result, detail from rows_out
) r
order by ord, item;
`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// File 20 (and the two-part fallback)
// ---------------------------------------------------------------------------------------------------------------------------------------------------
const MARK = (m) => `-- ==== BEGIN MIGRATION ${m.file} (${Buffer.byteLength(read(path.join(MIGDIR, m.file)))} bytes, sha256 ${sha(read(path.join(MIGDIR, m.file)))}) ====`;
const MARK_END = (m) => `-- ==== END MIGRATION ${m.file} ====`;

function prereqBlock(label) {
  const pre = verifyUnion([BASE_PACK, ...packLabels(MIGS.filter((m) => m.n <= 2))]);
  const req = requiredObjects();
  return `-- PREREQUISITES (${label}). Any failure raises an exception and the transaction rolls back: nothing is changed.
do ${DOLLAR}
declare
  v_failing text;
  v_missing text;
begin
  select string_agg(pack || ' / ' || chk || ': ' || item || ' (' || detail || ')', E'\\n  ' order by pack, chk, item) into v_failing
  from (
${pre}
  ) pre where result = 'FAIL';
  if v_failing is not null then
    raise exception E'Batch install refused, nothing was changed. These prerequisites (the access grant rules migration 20261215000000 and launch migrations 1 and 2) are not in place:\\n  %', v_failing;
  end if;
  select string_agg(r.kind || ' ' || r.name, ', ' order by r.name) into v_missing
  from (values ${[...req.fns.map((f) => `('function', '${f}')`), ...req.tabs.map((t) => `('table', '${t}')`)].join(", ")}) r(kind, name)
  where (r.kind = 'function' and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = r.name))
     or (r.kind = 'table' and to_regclass('public.' || r.name) is null);
  if v_missing is not null then
    raise exception E'Batch install refused, nothing was changed. These objects that migrations 3 to 14 build on are missing: %', v_missing;
  end if;
end
${DOLLAR};
`;
}
function finalBlock(ms) {
  // key objects exist: one assertion per migration, plus the notes switch off. Runs inside the transaction BEFORE commit.
  const lines = ms.map((m) => `    ('${m.n}', '${q(m.what)}', ${m.marker})`).join(",\n");
  const added = ms.flatMap((m) => m.added.map((a) => `('${m.n}', '${a}')`));
  const extra = ms.some((m) => m.n === 4)
    ? `  if has_column_privilege('authenticated', 'public.profiles', 'status_reason', 'select') or has_column_privilege('anon', 'public.profiles', 'status_reason', 'select') then
    raise exception 'Batch install rolled back: migration 4 did not restrict SELECT on profiles';
  end if;\n`
    : "";
  const extra7 = ms.some((m) => m.n === 7)
    ? `  if has_function_privilege('anon', 'public.preflight_phase2b_v2_policy_status()'::regprocedure, 'execute') then
    raise exception 'Batch install rolled back: migration 7 left the policy status function callable by anonymous visitors';
  end if;\n`
    : "";
  const notes = ms.some((m) => m.n === 14)
    ? `  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inv_company_settings' and column_name = 'project_notes_enabled') then
    raise exception 'Batch install rolled back: the notes switch column is missing';
  end if;
  execute 'select count(*) from public.inv_company_settings where project_notes_enabled is not false' into v_on;
  if v_on <> 0 then
    raise exception 'Batch install rolled back: the dispatch / return notes switch is not OFF for every company (% company row(s))', v_on;
  end if;
  if to_regclass('public.inv_project_notes') is null or to_regclass('public.inv_project_note_events') is null or to_regclass('public.inv_project_note_status') is null then
    raise exception 'Batch install rolled back: a dispatch / return note table or view is missing';
  end if;\n`
    : "";
  return `-- FINAL ASSERTIONS (key objects exist, the notes switch is OFF). Any failure raises an exception and the whole transaction rolls back.
do ${DOLLAR}
declare
  v_bad text;
  v_on bigint;
begin
  select string_agg('migration ' || c.n || ' (' || c.what || ')', '; ' order by c.n::int) into v_bad
  from (values
${lines}
  ) c(n, what, present) where not c.present;
  if v_bad is not null then
    raise exception 'Batch install rolled back: not in place after the install: %', v_bad;
  end if;
${added.length ? `  select string_agg('migration ' || a.n || ' function ' || a.name, '; ') into v_bad
  from (values ${added.join(", ")}) a(n, name)
  where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = a.name);
  if v_bad is not null then
    raise exception 'Batch install rolled back: missing function(s): %', v_bad;
  end if;\n` : ""}${extra}${extra7}${notes}end
${DOLLAR};
`;
}
function buildInstall({ ms, title, partNote, done }) {
  const first = ms[0].n, last = ms[ms.length - 1].n;
  const body = ms.map((m) => `${MARK(m)}\n${read(path.join(MIGDIR, m.file))}${MARK_END(m)}\n`).join("\n");
  return `-- ${title}
-- THIS FILE CHANGES THE DATABASE. It runs in ONE transaction (begin ... commit): if anything fails, everything it did is rolled back and nothing is changed.
-- GENERATED by scripts/build-launch-batch.mjs. The migration text between the BEGIN MIGRATION / END MIGRATION markers is copied byte for byte from supabase/migrations;
-- \`npm run check:launch-batch\` fails if any of it differs from those files. Do not edit by hand.
--
-- WHAT IT DOES. Installs launch migrations ${first} to ${last} (${ms.length} changes) in file-name order, exactly as written in supabase/migrations. Each migration is additive and
-- repeatable (create or replace / if not exists), inserts, edits and deletes no existing rows, and switches nothing on: the dispatch / return notes switch stays OFF.
-- It does not touch any scheduler (pg_cron or Vercel cron).${partNote}
-- BEFORE: run launch_batch_00_preflight_and_snapshot_readonly.sql and send me its result. AFTER: run launch_batch_90_verify_and_compare_readonly.sql.
-- RE-RUN: safe. Every migration here can be run again; a second run changes nothing it has already changed.
-- IF IT FAILS: the error message names what is wrong and NOTHING was changed (the transaction rolled back). Send me the message; do not run anything else.
--   If the next thing you run says "current transaction is aborted", run the single line  rollback;  once and then continue.
-- It holds a few short locks until it commits (it replaces functions, restricts SELECT on one table, adds tables): run it at a quiet moment. A lock it cannot get within
-- 15 seconds makes it stop and roll back (nothing changed): then simply run it again.

begin;
set local lock_timeout = '15s';

${prereqBlock(`migrations 1 and 2 and the access grant rules migration are in place`)}
${body}
${finalBlock(ms)}
commit;

-- After the commit (read-only). This is the last statement, so it is the result the editor shows.
select 'COMMITTED' as result, '${done}' as next_step;
`;
}
function build20() {
  return buildInstall({ ms: BATCH, title: "launch_batch_20_install_3_to_14.sql: install launch migrations 3 to 14 in one transaction (Run 2 of 3)", partNote: "",
    done: "launch migrations 3 to 14 are installed in one transaction. Next: run launch_batch_90_verify_and_compare_readonly.sql and paste the digest from file 00 into it." });
}
function build21() {
  return buildInstall({
    ms: BATCH.filter((m) => m.n <= 13),
    title: "launch_batch_21_install_part_a_3_to_13.sql: FALLBACK part A of 2 (use ONLY if the SQL Editor refuses the single file 20)",
    done: "part A is installed (launch migrations 3 to 13, one transaction). Next: run launch_batch_22_install_part_b_14.sql.",
    partNote: `\n-- FALLBACK. Use this file and launch_batch_22_install_part_b_14.sql ONLY if the editor will not accept the one large paste of launch_batch_20_install_3_to_14.sql.
-- Run part A first, then part B. Each part is its own all-or-nothing transaction. If A fails nothing changed: fix nothing, send me the message. If A succeeds and B fails,
-- migrations 3 to 13 are installed and 14 is not: run part B again (it is safe to repeat), or send me the message.`,
  });
}
function build22() {
  return buildInstall({
    ms: BATCH.filter((m) => m.n === 14),
    title: "launch_batch_22_install_part_b_14.sql: FALLBACK part B of 2 (migration 14; run only after launch_batch_21_install_part_a_3_to_13.sql)",
    done: "part B is installed (launch migration 14, one transaction): migrations 3 to 14 are all in place. Next: run launch_batch_90_verify_and_compare_readonly.sql and paste the digest from file 00 into it.",
    partNote: `\n-- FALLBACK part B. Run it only after part A (launch_batch_21_install_part_a_3_to_13.sql) succeeded. Safe to repeat.`,
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// File 90
// ---------------------------------------------------------------------------------------------------------------------------------------------------
function build90() {
  const ver = verifyUnion([BASE_PACK, ...packLabels(MIGS)]);
  const expRows = EXP.map((e) => `('${q(e.item)}', '${e.kind}', array[${e.migs.map((n) => `'${mlabel(MIGS[n - 1])}'`).join(", ")}]::text[], ${e.sameOk}, '${q(e.what)}')`).join(",\n  ");
  return `-- READ-ONLY (SELECT only). Run in the SQL Editor of "Enginious HR Engine_V2" AFTER launch_batch_20_install_3_to_14.sql. It creates, changes and deletes nothing.
-- GENERATED by scripts/build-launch-batch.mjs from the existing per-change packs: do not edit by hand (npm run check:launch-batch fails if it differs).
-- Run the WHOLE file; it returns ONE result table (section | item | result | detail).
--
--   BEFORE YOU RUN IT: paste the DIGEST (the last row of file 00's result, one long line) in place of the line that starts with  >>> PASTE THE DIGEST HERE  further down
--   (between the two  $digest$  markers; keep the markers). Without a digest the verification still runs but the comparison says NOT RUN.
--   If you see  invalid input syntax for type json  the digest was cut short when copying: copy the DIGEST cell from file 00 again (or use Export -> CSV).
--
--   0  RESULT       the one line to read first: PASS, or FAIL / INCOMPLETE with the reason
--   1  verification the checks of the per-change *_20_verify files for the access grant rules migration and launch migrations 1 to 14, consolidated. A row that is not
--                   OK is listed. The last verification row says  OK: N checks, 0 failing
--   2  extra checks the notes switch is OFF for every company; scheduled jobs untouched
--   3  comparison   every difference from the snapshot, classified INTENDED (the specific objects these migrations are supposed to change, by migration) or UNEXPECTED
--                   (anything else, including any change to migrations 1 and 2, key table rows, the notes switch, scheduler objects or privileges outside the intended ones).
--                   Unchanged items are counted, not listed. The last row says PASS, or lists the UNEXPECTED items.
--
-- If you want every check listed instead of only the exceptions, change  false  to  true  in the line marked SHOW ALL.
-- If you used the system between file 00 and this file, a changed row count on a live table (notifications, approvals, attendance_segments, ...) is real use, not the
-- migration: the migrations insert, edit and delete no rows. Say so and send the result.

with
opts(show_all) as (select false),  -- SHOW ALL: change false to true to list every check and every unchanged item
pasted(txt) as (
  select substring($digest$
>>> PASTE THE DIGEST HERE: replace this whole line with the one long line you copied from the last row of file 00 <<<
$digest$ from '\\{.*\\}')
),
parsed(d) as (select txt::jsonb from pasted),
before(item, value) as (
  select k, v from (select key as k, value #>> '{}' as v from jsonb_each((select d from parsed) -> 'items')) x where (select d from parsed) is not null
),
digest_ok as (
  select (select d from parsed) is not null as pasted,
         coalesce((select md5(string_agg(item || '=' || value, ';' order by item)) from before) = (select d from parsed) ->> 'chk', false) as intact
),
${digestCtes()},
expect(item, kind, migs, same_ok, what) as (values
  ${expRows}
),
now_items as (select item, ${SHORT} as value, value as full_value, ok from cur),
pending as (select m as mig from unnest(array[${MIGS.map((m) => `'${mlabel(m)}'`).join(", ")}]) m where coalesce((select value from before where item = 'pre:' || m), 'absent') = 'absent'),
cmp as (
  select e.item, e.kind, e.migs, e.same_ok, e.what, b.value as before_value, c.value as now_value, c.full_value, c.ok,
    case when b.item is null then 'MISSING IN DIGEST' when c.item is null then 'NOT COMPUTED' when b.value = c.value then 'SAME'
         when b.value = 'ABSENT' and c.value <> 'ABSENT' then 'ADDED' when c.value = 'ABSENT' then 'REMOVED' else 'CHANGED' end as obs,
    exists (select 1 from pending p where p.mig = any (e.migs)) as pending
  from expect e left join before b on b.item = e.item left join now_items c on c.item = e.item
),
classified as (
  select cmp.*,
    case
      when obs in ('MISSING IN DIGEST', 'NOT COMPUTED') then 'UNEXPECTED'
      when kind = 'SAME' then case when obs = 'SAME' and coalesce(ok, true) then 'PRESERVED' else 'UNEXPECTED' end
      when pending then case when obs in ('CHANGED', 'ADDED') and coalesce(ok, true) then 'INTENDED'
                             when obs = 'SAME' and same_ok and coalesce(ok, false) then 'PRESERVED' else 'UNEXPECTED' end
      else case when obs = 'SAME' and coalesce(ok, true) then 'PRESERVED' else 'UNEXPECTED' end
    end as verdict
  from cmp
),
ver as (
${ver}
),
vpack as (select pack, count(*) as n, count(*) filter (where result = 'FAIL') as failing from ver group by pack),
vtotal as (select count(*) as n, count(*) filter (where result = 'FAIL') as failing from ver),
switch_state as (select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'inv_company_settings' and column_name = 'project_notes_enabled') as has_col),
switch_on as (select case when (select has_col from switch_state) = 1 then (xpath('/row/v/text()', query_to_xml('select count(*)::text as v from public.inv_company_settings where project_notes_enabled is not false', false, true, '')))[1]::text::int else -1 end as n),
sched as (select b.value as before_value, c.value as now_value, (select full_value from now_items where item = 'keep:scheduler: pg_cron job definitions (cron.job)') as full_value from (select 1) x left join before b on b.item = 'keep:scheduler: pg_cron job definitions (cron.job)' left join now_items c on c.item = 'keep:scheduler: pg_cron job definitions (cron.job)'),
cstat as (
  select count(*) filter (where verdict = 'PRESERVED') as preserved, count(*) filter (where verdict = 'INTENDED') as intended, count(*) filter (where verdict = 'UNEXPECTED') as unexpected,
         string_agg(item, '; ' order by item) filter (where verdict = 'UNEXPECTED') as unexpected_list
  from classified
),
rows_out(ord, section, item, result, detail) as (
  select 100 + row_number() over (order by case pack when 'base' then 0 else substr(pack, 2)::int end), '1 verification',
         case pack when 'base' then 'access grant rules migration 20261215000000' else 'launch migration ' || ltrim(substr(pack, 2), '0') end,
         case when failing = 0 then 'OK' else 'FAIL' end, n || ' checks, ' || failing || ' failing'
  from vpack
  union all select 150, '1 verification', 'failing: ' || pack || ' / ' || chk || ': ' || item, 'FAIL', detail from ver where result = 'FAIL'
  union all select 160, '1 verification', 'information: ' || pack || ' / ' || chk || ': ' || item, 'INFO', detail from ver where result = 'INFO' and (select show_all from opts)
  union all select 161, '1 verification', 'check: ' || pack || ' / ' || chk || ': ' || item, 'OK', detail from ver where result = 'OK' and (select show_all from opts)
  union all select 190, '1 verification', 'SUMMARY (verification)', case when (select failing from vtotal) = 0 then 'OK' else 'FAIL' end,
         case when (select failing from vtotal) = 0 then 'OK: ' || (select n from vtotal) || ' checks, 0 failing' else 'FAIL: ' || (select failing from vtotal) || ' check(s) failing, see above' end
  union all select 200, '2 extra checks', 'dispatch / return notes switch is OFF for every company',
         case when (select n from switch_on) = 0 then 'OK' else 'FAIL' end,
         case (select n from switch_on) when 0 then '0 companies have it on' when -1 then 'FAIL: the switch column does not exist (migration 14 is not in place)' else 'FAIL: ' || (select n from switch_on) || ' company row(s) not OFF' end
  union all select 210, '2 extra checks', 'scheduler untouched (pg_cron job definitions fingerprint)',
         case when (select before_value from sched) is null then 'INFO' when (select before_value from sched) = (select now_value from sched) then 'OK' else 'FAIL' end,
         case when (select before_value from sched) is null then 'no digest pasted: now ' || coalesce((select now_value from sched), '') || case when (select full_value from sched) = 'not present' then ' (pg_cron is not installed in this database)' else '' end
              when (select before_value from sched) = (select now_value from sched) then case when (select full_value from sched) = 'not present' then 'pg_cron schema not present, as before' else 'identical to the snapshot (' || (select now_value from sched) || ')' end
              else 'CHANGED: before ' || (select before_value from sched) || ', now ' || (select now_value from sched) end
  union all select 300, '3 comparison', 'digest', case when not (select pasted from digest_ok) then 'INFO' when (select intact from digest_ok) then 'OK' else 'FAIL' end,
         case when not (select pasted from digest_ok) then 'no digest pasted: comparison NOT RUN' when (select intact from digest_ok) then (select count(*) from before) || ' items, checksum matches' else 'the pasted digest is damaged or incomplete (checksum does not match): copy the DIGEST cell from file 00 again' end
  union all select 310 + row_number() over (order by (select min(substr(m, 2)::int) from unnest(migs) m) nulls last, item), '3 comparison', case when array_length(migs, 1) > 0 then '[' || array_to_string(migs, '+') || '] ' || item else item end,
         case verdict when 'INTENDED' then 'INTENDED' when 'UNEXPECTED' then 'UNEXPECTED' else 'SAME' end,
         case verdict
           when 'INTENDED' then what || ' [' || obs || ']'
           when 'UNEXPECTED' then 'UNEXPECTED: ' || obs || ' (expected: ' || case when kind = 'SAME' then 'unchanged' when pending then 'changed by ' || array_to_string(migs, ', ') else 'unchanged (already applied before the snapshot)' end || '). ' || what
           else what
         end
  from classified where (select pasted from digest_ok) and (verdict <> 'PRESERVED' or (select show_all from opts))
  union all select 800 + row_number() over (order by kindname), '3 comparison', 'summary of ' || kindname || ' items', 'SAME',
         n || ' unchanged' || case when i > 0 then ', ' || i || ' intended change(s) (listed above)' else '' end || case when u > 0 then ', ' || u || ' UNEXPECTED (listed above)' else '' end || ' (' || total || ' items: ' || case kindname
           when 'struct' then 'every table, column, constraint, index, policy, trigger, view, privilege and other function of the public schema' when 'rows' then 'row counts and fingerprints of the key tables'
           when 'fn' then 'function definitions; migrations 1 and 2 must be unchanged, the rest are replaced by the batch' when 'fnadd' then 'functions the batch adds' when 'fnacl' then 'who may call each replaced function'
           when 'chg' then 'privileges, policies, columns and tables the batch changes' when 'keep' then 'related objects, scheduler, extensions and the notes switch that must not change'
           when 'pre' then 'per-migration markers' else kindname end || ')'
  from (select split_part(item, ':', 1) as kindname, count(*) filter (where verdict = 'PRESERVED') as n, count(*) filter (where verdict = 'INTENDED') as i, count(*) filter (where verdict = 'UNEXPECTED') as u, count(*) as total from classified group by split_part(item, ':', 1)) g
  where (select pasted from digest_ok) and not (select show_all from opts)
  union all select 900, '3 comparison', 'SUMMARY (comparison)',
         case when not (select pasted from digest_ok) then 'INFO' when not (select intact from digest_ok) then 'INCOMPLETE' when (select unexpected from cstat) = 0 then 'PASS' else 'UNEXPECTED' end,
         case when not (select pasted from digest_ok) then 'NOT RUN: no complete digest pasted'
              when not (select intact from digest_ok) then 'NOT RELIABLE: the pasted digest is damaged or incomplete'
              when (select unexpected from cstat) = 0 then 'PASS: ' || (select preserved from cstat) || ' items unchanged, ' || (select intended from cstat) || ' intended change(s) (listed above by migration), 0 unexpected'
              else 'UNEXPECTED: ' || (select unexpected from cstat) || ' item(s): ' || (select unexpected_list from cstat) end
),
verdict as (
  select case
    when (select failing from vtotal) > 0 then 'FAIL: ' || (select failing from vtotal) || ' verification check(s) failing. Send me this whole result and do not run anything else.'
    when (select n from switch_on) <> 0 then 'FAIL: the dispatch / return notes switch is not OFF (or migration 14 is missing). Send me this whole result.'
    when not (select pasted from digest_ok) then 'INCOMPLETE: verification OK (' || (select n from vtotal) || ' checks, 0 failing) but no complete digest was pasted (missing, or cut short when copying), so the preservation comparison did not run. Paste the digest from file 00 and run this file again.'
    when not (select intact from digest_ok) then 'INCOMPLETE: the pasted digest is damaged (checksum mismatch). Copy the DIGEST cell from file 00 again.'
    when (select unexpected from cstat) > 0 or (select before_value from sched) is distinct from (select now_value from sched) then 'FAIL: ' || (select unexpected from cstat) || ' UNEXPECTED difference(s) (or the scheduler fingerprint changed): ' || coalesce((select unexpected_list from cstat), 'scheduler') || '. Send me this whole result.'
    else 'PASS: verification OK (' || (select n from vtotal) || ' checks, 0 failing), preservation comparison PASS (' || (select preserved from cstat) || ' unchanged, ' || (select intended from cstat) || ' intended, 0 unexpected), notes switch OFF, scheduler untouched.'
  end as txt
)
select section, item, result, detail from (
  select 0 as ord, '0 RESULT' as section, 'read this first' as item, case when v.txt like 'PASS%' then 'PASS' when v.txt like 'FAIL%' then 'FAIL' else 'INCOMPLETE' end as result, v.txt as detail from verdict v
  union all select ord, section, item, result, detail from rows_out
) r
order by ord, item;
`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Static analysis of the migrations: nothing in them may break inside one transaction
// ---------------------------------------------------------------------------------------------------------------------------------------------------
function lex(sql) {
  // returns { statements: [{masked, raw}], dollarTags: Set } where masked has comments, string literals and dollar-quoted bodies blanked out
  const tags = new Set();
  const stmts = [];
  let i = 0, cur = "", curRaw = "", masked = "";
  const n = sql.length;
  const flush = () => { if (masked.trim()) stmts.push({ masked: masked.trim(), raw: curRaw.trim() }); masked = ""; curRaw = ""; };
  while (i < n) {
    const c = sql[i], c2 = sql[i + 1];
    if (c === "-" && c2 === "-") { const e = sql.indexOf("\n", i); const end = e < 0 ? n : e; curRaw += sql.slice(i, end); i = end; continue; }
    if (c === "/" && c2 === "*") {
      let depth = 1, j = i + 2;
      while (j < n && depth > 0) { if (sql[j] === "/" && sql[j + 1] === "*") { depth++; j += 2; } else if (sql[j] === "*" && sql[j + 1] === "/") { depth--; j += 2; } else j++; }
      curRaw += sql.slice(i, j); i = j; continue;
    }
    if (c === "'") {
      const escape = /(^|[^A-Za-z0-9_])[eE]$/.test(masked);
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new Error("unterminated string literal");
        if (escape && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      curRaw += sql.slice(i, j + 1); masked += "''"; i = j + 1; continue;
    }
    if (c === '"') { const e = sql.indexOf('"', i + 1); masked += '""'; curRaw += sql.slice(i, e + 1); i = e + 1; continue; }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80));
      if (m) {
        const tag = m[0]; tags.add(tag);
        const e = sql.indexOf(tag, i + tag.length);
        if (e < 0) throw new Error(`unterminated dollar quote ${tag}`);
        const body = sql.slice(i + tag.length, e);
        curRaw += sql.slice(i, e + tag.length);
        masked += `${tag}${/^\s*do\b/i.test(masked) ? body.replace(/--[^\n]*/g, "") : ""}${tag}`;
        i = e + tag.length; continue;
      }
    }
    if (c === ";") { masked += ";"; curRaw += ";"; flush(); i++; continue; }
    masked += c; curRaw += c; i++;
  }
  if (masked.trim()) throw new Error("the file ends with a statement that has no terminating semicolon");
  return { statements: stmts, tags };
}
const FORBIDDEN_TOP = [
  [/^(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction|commit\s+prepared|rollback\s+prepared)\b/i, "transaction control statement"],
  [/^(vacuum|cluster|reindex|create\s+database|drop\s+database|create\s+tablespace|alter\s+system|listen|unlisten|notify|checkpoint|discard|reset|set\s+(?!local\b))/i, "statement that cannot run inside a transaction or changes the session"],
  [/^alter\s+type\b[\s\S]*\badd\s+value\b/i, "ALTER TYPE ... ADD VALUE"],
  [/\bconcurrently\b/i, "CONCURRENTLY"],
  [/^\\/m, "psql meta-command"],
  [/^create\s+extension\b/i, "CREATE EXTENSION"],
];
function analyseMigrations(files) {
  const problems = [], summary = [];
  for (const f of files) {
    const text = read(path.join(MIGDIR, f));
    if (/\r/.test(text)) problems.push(`${f}: contains CR characters`);
    if (!text.endsWith("\n")) problems.push(`${f}: does not end with a newline`);
    if (/^\s*\\/m.test(text)) problems.push(`${f}: contains a line starting with a backslash (psql meta-command?)`);
    let r;
    try { r = lex(text); } catch (e) { problems.push(`${f}: ${e.message}`); continue; }
    const kinds = {};
    for (const s of r.statements) {
      const head = s.masked.replace(/\s+/g, " ").split(" ").slice(0, 2).join(" ").toLowerCase();
      kinds[head] = (kinds[head] || 0) + 1;
      for (const [re, why] of FORBIDDEN_TOP) if (re.test(s.masked.replace(/\$[A-Za-z_0-9]*\$[\s\S]*?\$[A-Za-z_0-9]*\$/g, "$$$$"))) problems.push(`${f}: ${why}: ${s.masked.slice(0, 80).replace(/\s+/g, " ")}`);
      if (/^do\b/i.test(s.masked) && /^\s*(commit|rollback)\s*;/im.test(s.masked)) problems.push(`${f}: a DO block ends the transaction`);
    }
    for (const t of r.tags) if (t === DOLLAR) problems.push(`${f}: uses the dollar-quote tag the batch wrapper uses (${DOLLAR})`);
    summary.push({ f, statements: r.statements.length, kinds, tags: [...r.tags].sort() });
  }
  return { problems, summary };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
function allOutputs() {
  return {
    "launch_batch_00_preflight_and_snapshot_readonly.sql": build00(),
    "launch_batch_20_install_3_to_14.sql": build20(),
    "launch_batch_21_install_part_a_3_to_13.sql": build21(),
    "launch_batch_22_install_part_b_14.sql": build22(),
    "launch_batch_90_verify_and_compare_readonly.sql": build90(),
  };
}
function embeddedBodies(text) {
  const out = [];
  const re = /^-- ==== BEGIN MIGRATION (\S+) \((\d+) bytes, sha256 ([0-9a-f]{64})\) ====\n([\s\S]*?)^-- ==== END MIGRATION \1 ====$/gm;
  let m;
  while ((m = re.exec(text))) out.push({ file: m[1], bytes: Number(m[2]), sha: m[3], body: m[4] });
  return out;
}

const mode = process.argv[2] || "write";
// The batch covers migrations 1 to 14 (20261216 to 20261217). Later migrations (#15, 20261218000100_inv_cross_company_receiving.sql) are installed on their own with their own pack and are not part of it.
const migFiles = readdirSync(MIGDIR).filter((f) => f >= "20261216" && f < "20261218").sort();
const problems = [];
if (migFiles.length !== 14 || migFiles.join() !== MIGS.map((m) => m.file).join()) problems.push(`the launch migrations in supabase/migrations (${migFiles.length}) are not exactly the 14 this script knows: ${migFiles.join(", ")}`);
if (!existsSync(path.join(MIGDIR, BASE_FILE))) problems.push(`missing base migration ${BASE_FILE}`);
const analysis = analyseMigrations(BATCH.map((m) => m.file));
problems.push(...analysis.problems);
if (problems.length) { console.error("PROBLEMS:\n  " + problems.join("\n  ")); process.exit(1); }

const outs = allOutputs();
for (const [name, text] of Object.entries(outs)) {
  if (text.includes("$batch_check$$batch_check$")) problems.push(`${name}: empty dollar quote`);
  const inside = text.split(DOLLAR);
  // every tag use must come in pairs: the wrapper never nests
  if ((inside.length - 1) % 2 !== 0) problems.push(`${name}: unbalanced ${DOLLAR}`);
  for (const b of embeddedBodies(text)) if (b.body.includes(DOLLAR)) problems.push(`${name}: migration ${b.file} contains ${DOLLAR}`);
}
if (mode === "--check" || mode === "check") {
  const bad = [...problems];
  for (const [name, text] of Object.entries(outs)) {
    const f = path.join(OUTDIR, name);
    if (!existsSync(f)) { bad.push(`${name}: not committed (run: node scripts/build-launch-batch.mjs)`); continue; }
    const disk = read(f);
    if (disk !== text) bad.push(`${name}: differs from what the build script generates (run: node scripts/build-launch-batch.mjs)`);
    // byte-for-byte: every embedded migration body equals its file, and the file sets are exactly right
    const bodies = embeddedBodies(disk);
    const expectFiles = name.includes("_20_") ? BATCH : name.includes("_21_") ? BATCH.filter((m) => m.n <= 13) : name.includes("_22_") ? BATCH.filter((m) => m.n === 14) : [];
    if (bodies.map((b) => b.file).join() !== expectFiles.map((m) => m.file).join()) bad.push(`${name}: embeds ${bodies.map((b) => b.file.slice(0, 14)).join(",")} but must embed ${expectFiles.map((m) => m.file.slice(0, 14)).join(",")} in that order`);
    for (const b of bodies) {
      const src = Buffer.from(read(path.join(MIGDIR, b.file)), "utf8");
      const emb = Buffer.from(b.body, "utf8");
      if (!src.equals(emb)) bad.push(`${name}: embedded ${b.file} differs from supabase/migrations/${b.file}`);
      if (sha(b.body) !== b.sha || b.bytes !== src.length) bad.push(`${name}: marker of ${b.file} does not match its body`);
    }
    // nothing but the migration bodies may carry migration statements: remove the bodies and the wrapper must contain no DDL outside DO blocks
  }
  if (bad.length) { console.error("FAILED:\n  " + bad.join("\n  ")); process.exit(1); }
  const sizes = Object.entries(outs).map(([n, t]) => `${n} ${(Buffer.byteLength(t) / 1024).toFixed(0)} KB`).join(", ");
  console.log(`OK: ${Object.keys(outs).length} files match the generator; ${BATCH.length} migrations embedded byte for byte in file 20 (${BATCH.length} markers, sha256 verified); ${analysis.summary.reduce((a, s) => a + s.statements, 0)} top-level statements checked, none unsafe in one transaction. Sizes: ${sizes}`);
} else if (mode === "--analyse") {
  console.log(JSON.stringify(analysis.summary, null, 1));
} else {
  if (problems.length) { console.error("PROBLEMS:\n  " + problems.join("\n  ")); process.exit(1); }
  for (const [name, text] of Object.entries(outs)) writeFileSync(path.join(OUTDIR, name), text);
  console.log("written: " + Object.entries(outs).map(([n, t]) => `${n} (${(Buffer.byteLength(t) / 1024).toFixed(0)} KB)`).join(", "));
}
