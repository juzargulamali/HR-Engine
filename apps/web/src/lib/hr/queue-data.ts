import "server-only";
import { canReviewAiDrafts, hasRole, resolveCountryTimeZone, type RoleGrant } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { ALERT_TYPE_LABELS } from "@/lib/recovery/labels";
import { ruleFor } from "./document-types";
import {
  CONTRACT_LOOKAHEAD_DAYS, ackKey, aiSuggestionItems, attendanceItems, contractItems, documentItems, makeViewer, recoveryAlertItems, sortItems,
  type QueueItem, type QueueKind,
} from "./queue";

/** Which part of the queue could not be read (named, never shown as "nothing needs attention"). */
export type QueueSource = "employees" | "contracts" | "documents" | "identity documents" | "attendance exceptions" | "recovery alerts" | "AI suggestions" | "acknowledgements";

export interface QueueData { items: QueueItem[]; failed: QueueSource[]; companies: { id: string; name: string }[]; today: string }

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** How far back an attendance exception is looked for: the same two months the profile lists. */
const ATTENDANCE_LOOKBACK_DAYS = 60;

/**
 * Reads every source of the HR queue through row-level security (no company filter is added here: RLS decides what each viewer sees, exactly as the Alerts page always did) and
 * turns it into queue items with the shared builders. `employeeId` narrows every source to one person (the profile); `companyId` narrows to one company (the Alerts filter, applied
 * after the read so the counts for other companies are still available). Each source fails on its own: the others still show, and the failed one is named.
 */
export async function loadHrQueue(opts: { grants: readonly RoleGrant[]; today: string; employeeId?: string }): Promise<QueueData> {
  const supabase = await createClient();
  const { today, employeeId } = opts;
  const horizon = addDays(today, CONTRACT_LOOKAHEAD_DAYS);
  const lookback = addDays(today, -ATTENDANCE_LOOKBACK_DAYS);
  const failed: QueueSource[] = [];
  const scope = <T extends { eq: (c: string, v: string) => T }>(q: T, column = "employee_id"): T => (employeeId ? q.eq(column, employeeId) : q);

  const employeesQuery = supabase.from("employees").select("id, first_name, last_name, company_id, country_code").is("deleted_at", null);
  const [employeesRes, companiesRes, contractsRes, docsRes, identityRes, conflictsRes, windowsRes, alertsRes, acksRes, draftsRes] = await Promise.all([
    employeeId ? employeesQuery.eq("id", employeeId) : employeesQuery,
    supabase.from("companies").select("id, legal_name"),
    scope(supabase.from("employment_contracts").select("id, employee_id, contract_type, end_date, probation_end_date").eq("is_current", true).or(`end_date.lte.${horizon},probation_end_date.lte.${horizon}`)),
    // EVERY non-removed version, with or without an expiry date: the current version of each type is picked in code by the profile's own rule (the newest), and only then is its expiry judged.
    scope(supabase.from("employee_documents").select("id, employee_id, document_type, expiry_date, created_at").is("deleted_at", null)),
    // Identity documents are read WITHOUT the number: a queue summary never carries it. RLS still withholds this table from CEO and CTO.
    scope(supabase.from("identity_documents").select("id, employee_id, document_type, expiry_date, created_at")),
    scope(supabase.from("attendance_records").select("id, employee_id, work_date").not("presence_conflict", "is", null).gte("work_date", lookback)),
    scope(supabase.from("recovery_windows").select("id, employee_id, starting_local_date").eq("hr_verification_required", true).is("hr_verified_at", null).gte("starting_local_date", lookback)),
    scope(supabase.from("recovery_alerts").select("id, company_id, employee_id, alert_type, triggered_at, status, acknowledged_at, acknowledgement_note").in("status", ["open", "acknowledged"]).order("triggered_at", { ascending: false }).limit(100)),
    scope(supabase.from("hr_queue_acknowledgements").select("kind, source_id, source_date, acknowledged_at, note")),
    employeeId || !canReviewAiDrafts(opts.grants) ? Promise.resolve({ data: [] as never[], error: null }) : supabase.from("ai_drafts").select("id, entity_type, proposed_action, created_by_agent, created_at").eq("status", "draft").order("created_at", { ascending: true }),
  ]);

  if (employeesRes.error || companiesRes.error) failed.push("employees");
  if (contractsRes.error) failed.push("contracts");
  if (docsRes.error) failed.push("documents");
  if (identityRes.error) failed.push("identity documents");
  if (conflictsRes.error || windowsRes.error) failed.push("attendance exceptions");
  if (alertsRes.error) failed.push("recovery alerts");
  if (acksRes.error) failed.push("acknowledgements");
  if (draftsRes.error) failed.push("AI suggestions");

  const employees = new Map((employeesRes.data ?? []).map((e) => [e.id, { name: `${e.first_name} ${e.last_name}`, companyId: e.company_id }]));
  const countries = new Map((employeesRes.data ?? []).map((e) => [e.id, e.country_code]));
  const companies = new Map((companiesRes.data ?? []).map((c) => [c.id, c.legal_name]));
  const acks = new Map((acksRes.data ?? []).map((a) => [ackKey(a.kind as QueueKind, a.source_id, a.source_date), { at: a.acknowledged_at, note: a.note }]));
  const ctx = { today, viewer: makeViewer((companyId) => hasRole(opts.grants, "hr_admin", { companyId })), employees, companies, acks };

  const localDate = (iso: string, id: string) => new Intl.DateTimeFormat("en-CA", { timeZone: resolveCountryTimeZone(countries.get(id)), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const docLabel = (store: "employee" | "identity") => (type: string) => ruleFor(store, type)?.label ?? (type.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase()));

  const items = sortItems([
    ...contractItems(contractsRes.data ?? [], ctx),
    ...documentItems("employee_document", (docsRes.data ?? []), ctx, docLabel("employee")),
    ...documentItems("identity_document", (identityRes.data ?? []), ctx, docLabel("identity")),
    ...attendanceItems(conflictsRes.data ?? [], windowsRes.data ?? [], ctx),
    ...recoveryAlertItems((alertsRes.data ?? []) as never, ctx, (t) => ALERT_TYPE_LABELS[t as keyof typeof ALERT_TYPE_LABELS] ?? t, localDate),
    ...aiSuggestionItems(draftsRes.data ?? [], ctx),
  ]);

  // The company filter offers only companies the viewer holds an alerts role for (the companies list itself is readable by every signed-in person, and must not leak other companies' names here).
  const offered = [...companies].filter(([id]) => (["hr_admin", "ceo", "cto"] as const).some((role) => hasRole(opts.grants, role, { companyId: id })));
  return { items, failed, companies: offered.map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), today };
}
