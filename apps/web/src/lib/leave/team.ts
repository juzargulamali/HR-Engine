/**
 * The team leave table on the Leave page: one row per person the viewer can already read, from the viewer's OWN session (employees, balances and requests
 * are all row-level secured, so a manager sees the people the database lets them see, HR and Finance their company, an ordinary employee nobody). Nothing here
 * widens or narrows that, and nothing is calculated: balances are the database's own sums. A source that could not be read is `failed` and is said so in its
 * cells; a figure the viewer's access does not include is simply absent ("—").
 */
export type Cell<T> = { status: "ok"; value: T } | { status: "failed" };

export interface TeamEmployee { id: string; first_name: string; last_name: string; job_title: string | null; employment_status: string }
export interface BalanceRow { employee_id: string; leave_type_code: string; balance_days: number | string }
export interface CompRow { employee_id: string; balance_days: number | string }
export interface RequestRow { employee_id: string; status: string; start_date: string; end_date: string }

/** `null` = the read failed. */
export interface TeamSources { employees: readonly TeamEmployee[]; balances: readonly BalanceRow[] | null; comp: readonly CompRow[] | null; requests: readonly RequestRow[] | null }

export interface TeamRow {
  id: string;
  name: string;
  jobTitle: string | null;
  balances: Cell<{ code: string; days: number }[]>;
  recovery: Cell<number | null>;
  pending: Cell<number>;
  nextLeave: Cell<string | null>;
}

const PENDING = ["submitted", "pending_approval"];
const ok = <T,>(value: T): Cell<T> => ({ status: "ok", value });
const failed = { status: "failed" } as const;

/** People who are away or out of the company are not part of "my team to plan around": terminated people are left out, everyone else stays. */
export function buildTeamRows(src: TeamSources, today: string): TeamRow[] {
  const people = src.employees.filter((e) => e.employment_status !== "terminated");
  const group = <T extends { employee_id: string }>(rows: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.employee_id, [...(m.get(r.employee_id) ?? []), r]);
    return m;
  };
  const bal = src.balances ? group(src.balances) : null;
  const comp = src.comp ? group(src.comp) : null;
  const req = src.requests ? group(src.requests) : null;
  const rows = people.map((e): TeamRow => {
    const mine = req?.get(e.id) ?? [];
    return {
      id: e.id,
      name: `${e.first_name} ${e.last_name}`.trim(),
      jobTitle: e.job_title,
      balances: bal ? ok((bal.get(e.id) ?? []).map((b) => ({ code: b.leave_type_code, days: Number(b.balance_days) })).sort((a, b) => a.code.localeCompare(b.code))) : failed,
      recovery: comp ? ok(comp.get(e.id)?.[0] ? Number(comp.get(e.id)![0]!.balance_days) : null) : failed,
      pending: req ? ok(mine.filter((r) => PENDING.includes(r.status)).length) : failed,
      nextLeave: req ? ok(mine.filter((r) => r.status === "approved" && r.end_date >= today).map((r) => (r.start_date > today ? r.start_date : today)).sort()[0] ?? null) : failed,
    };
  });
  return rows.sort((a, b) => (b.pending.status === "ok" ? b.pending.value : 0) - (a.pending.status === "ok" ? a.pending.value : 0) || a.name.localeCompare(b.name));
}

/** "Annual 12 · Sick 5" from the balances the viewer can read, "—" when there are none to read. */
export function balancesText(rows: readonly { code: string; days: number }[]): string {
  if (rows.length === 0) return "—";
  return rows.map((b) => `${b.code.charAt(0).toUpperCase()}${b.code.slice(1).replace(/_/g, " ")} ${b.days}`).join(" · ");
}

/**
 * Which people the table asks the database for. The database's own row-level rules decide what can be read, so for almost everyone this is simply "whoever
 * the viewer can read" ("rls"). The one exception is a System Administrator, who can read every employee record but not their leave: showing every colleague
 * with empty leave would read as "nothing pending", so a System Administrator sees only their direct reports and the companies where they also hold HR Admin,
 * Finance, CEO or CTO (whose leave the database does let them read).
 */
export type TeamScope = { mode: "rls" } | { mode: "reports" } | { mode: "companies"; companyIds: string[] };

export function teamScope(grants: readonly { role: string; companyId: string | null }[]): TeamScope {
  if (!grants.some((g) => g.role === "sys_admin")) return { mode: "rls" };
  const readers = grants.filter((g) => ["hr_admin", "finance", "ceo", "cto"].includes(g.role));
  if (readers.length === 0) return { mode: "reports" };
  if (readers.some((g) => g.companyId === null)) return { mode: "rls" };
  return { mode: "companies", companyIds: [...new Set(readers.map((g) => g.companyId!))] };
}
