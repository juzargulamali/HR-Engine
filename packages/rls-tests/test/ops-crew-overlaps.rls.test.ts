import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Operations: who is committed twice (migration 20270113000200_ops_crew_overlaps.sql), against a real Postgres. Fictional data throughout.
//   * for an Operations Manager (or founder) of the company: the person and BOTH confirmed commitments, each with its exact window in the site's own time zone and the ids to link with;
//   * only confirmed, unfinished commitments of live projects that are not wholly past; a tentative activity, a finished one and a past one are not listed;
//   * COMPANY BOUNDARY: a side in a company the caller holds no Operations right for carries its window and "hidden" and nothing else (no name, reference, title or id);
//   * nobody else can call it (a Project Manager, a member, another company's manager, a display identity), and the office board read carries none of it.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { ops: id(), founder: id(), opsB: id(), opsBoth: id(), pm: id(), pmB: id(), member: id(), tech: id(), tech2: id(), disp: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@overlap.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const manual = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const SECRET_B = { name: "SECRET-OTHER-COMPANY-PROJECT", ref: "OTH-P-2099-0777", title: "SECRET-OTHER-COMPANY-ACTIVITY", venue: "SECRET-OTHER-VENUE" };

describe("Operations: per-person overlaps of confirmed site commitments, inside the company boundary", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const overlaps = (user: string, company = CO.a) => call<Row>(user, `ops_crew_overlaps('${company}')`);
  const proj = async (ref: string, name: string, company = CO.a, pm = U.pm, tz = "Asia/Dubai") => {
    const p = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${company}', '${ref}', '${name}', 'internal', 'in_progress', '${pm}', '${pm}') returning id`))[0]!.id;
    await admin(`insert into proj_project_details (project_id, location, site_timezone, scope, technologies) values ('${p}', 'Fictional Hall', '${tz}', null, '[]'::jsonb)`);
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${p}', '${pm}', 'pm')`);
    return p;
  };
  /** A confirmed site activity, timed (local clock times in its zone) or whole days, with crew put on it directly. */
  const act = async (p: string, title: string, o: { from?: string; to?: string; d1?: string; d2?: string; tz?: string; state?: string; status?: string; crew?: string[]; location?: string }) => {
    const tz = o.tz ?? "Asia/Dubai";
    const a = (await admin<{ id: string }>(`insert into proj_plan_items (project_id, plan, title, activity_kind, activity_state, confirmed_at, status, tz, location, start_date, end_date, starts_at, ends_at, created_by)
      values ('${p}', 'site', '${title}', 'setup', '${o.state ?? "confirmed"}', ${(o.state ?? "confirmed") === "confirmed" ? "now()" : "null"}, '${o.status ?? "planned"}', ${o.from ? `'${tz}'` : "null"}, ${o.location ? `'${o.location}'` : "null"},
              ${o.d1 ? `'${o.d1}'` : "null"}, ${o.d1 ? `'${o.d2 ?? o.d1}'` : "null"},
              ${o.from ? `('${o.from}'::timestamp at time zone '${tz}')` : "null"}, ${o.to ? `('${o.to}'::timestamp at time zone '${tz}')` : "null"}, '${U.pm}') returning id`))[0]!.id;
    for (const u of o.crew ?? []) await admin(`insert into proj_site_crew (project_id, plan_item_id, user_id, crew_role, created_by) values ('${p}', '${a}', '${u}', 'installation', '${U.pm}')`);
    return a;
  };
  let PA1 = "", PA2 = "", PB = "", A1 = "", A2 = "", B1 = "", booking = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional Enginious LLC FZ', 'AE', 'AED'), ('${CO.b}', 'Fictional Other Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      update profiles set full_name = 'Tariq Technician' where id = '${U.tech}'; update profiles set full_name = 'Uma Second' where id = '${U.tech2}';
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'OTH');
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.ops}', '${CO.a}', '{operations}'), ('${U.founder}', '${CO.a}', '{founder}'), ('${U.opsB}', '${CO.b}', '{operations}'),
        ('${U.opsBoth}', '${CO.a}', '{operations}'), ('${U.opsBoth}', '${CO.b}', '{operations}'),
        ('${U.pm}', '${CO.a}', '{}'), ('${U.member}', '${CO.a}', '{}'), ('${U.pmB}', '${CO.b}', '{}');
    `);
    PA1 = await proj("UAE-P-2099-0701", "Fictional Airshow Pavilion");
    PA2 = await proj("UAE-P-2099-0702", "Fictional Motor Show Stand", CO.a, U.pm, "Europe/London");
    PB = await proj(SECRET_B.ref, SECRET_B.name, CO.b, U.pmB);
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${PA1}', '${U.member}', 'member')`);
    // Tariq: 09:00 to 17:00 Dubai on one project, 11:00 to 15:00 London (15:00 to 19:00 Dubai) on another, and an all-day activity in ANOTHER company
    A1 = await act(PA1, "Installation day", { from: `${day(3)}T09:00`, to: `${day(3)}T17:00`, crew: [U.tech, U.tech2] });
    A2 = await act(PA2, "Stand build", { from: `${day(3)}T11:00`, to: `${day(3)}T15:00`, tz: "Europe/London", crew: [U.tech] });
    B1 = await act(PB, SECRET_B.title, { d1: day(3), d2: day(4), crew: [U.tech], location: SECRET_B.venue });
    // not overlaps: a tentative activity, a finished one, one wholly in the past, and a second role on the same activity
    await act(PA2, "Tentative clash", { from: `${day(3)}T10:00`, to: `${day(3)}T12:00`, state: "tentative", crew: [U.tech] });
    await act(PA2, "Finished clash", { from: `${day(3)}T10:00`, to: `${day(3)}T12:00`, status: "done", crew: [U.tech] });
    await act(PA1, "Past one", { from: `${day(-5)}T09:00`, to: `${day(-5)}T17:00`, crew: [U.tech2] });
    await act(PA2, "Past two", { from: `${day(-5)}T09:00`, to: `${day(-5)}T17:00`, crew: [U.tech2] });
    await admin(`insert into proj_site_crew (project_id, plan_item_id, user_id, crew_role, created_by) values ('${PA1}', '${A1}', '${U.tech}', 'standby', '${U.pm}')`);
    // a confirmed booking for the activity Tariq is already crewed on is the same commitment
    booking = (await admin<{ id: string }>(`insert into proj_site_bookings (project_id, user_id, plan_item_id, location, starts_at, ends_at, tz, lead_minutes, trail_minutes, state, confirmed_by, confirmed_at, created_by)
      values ('${PA1}', '${U.tech}', '${A1}', 'Fictional Hall', ('${day(3)}T09:00'::timestamp at time zone 'Asia/Dubai'), ('${day(3)}T17:00'::timestamp at time zone 'Asia/Dubai'), 'Asia/Dubai', 60, 60, 'confirmed', '${U.pm}', now(), '${U.pm}') returning id`))[0]!.id;
  }, 240_000);
  afterAll(async () => db.teardown());

  it("names the person and both commitments, with each window in its own site's time zone and the ids to link with", async () => {
    const r = await overlaps(U.ops);
    expect(Object.keys(r).sort()).toEqual(["company_id", "overlaps", "taken_at", "total", "truncated"]);
    expect(r.total).toBe(3);
    expect(r.truncated).toBe(false);
    const both = (r.overlaps as Row[]).find((x) => !x.b.hidden)!;
    expect(both.person).toBe("Tariq Technician");
    expect(both.user_id).toBe(U.tech);
    const [first, second] = [both.a, both.b].sort((x: Row, y: Row) => String(x.title).localeCompare(String(y.title)));
    expect(first).toMatchObject({ hidden: false, kind: "crew", id: A1, project_id: PA1, reference: "UAE-P-2099-0701", project_name: "Fictional Airshow Pavilion", title: "Installation day", tz: "Asia/Dubai", all_day: false,
      starts_local: `${day(3)}T09:00`, ends_local: `${day(3)}T17:00` });
    expect(second).toMatchObject({ hidden: false, kind: "crew", id: A2, project_id: PA2, reference: "UAE-P-2099-0702", title: "Stand build", tz: "Europe/London", all_day: false,
      starts_local: `${day(3)}T11:00`, ends_local: `${day(3)}T15:00` });
    // the instants are exact: the overlap is where both windows meet
    expect(new Date(both.overlap_from).toISOString()).toBe(new Date(second.starts_at).toISOString());
    expect(new Date(both.overlap_to).getTime()).toBe(Math.min(new Date(first.ends_at).getTime(), new Date(second.ends_at).getTime()));
    expect(new Date(first.ends_at).getTime() - new Date(first.starts_at).getTime()).toBe(8 * 3600_000);
    // Uma is on one upcoming activity only (her two others are past): she is not listed; the tentative and the finished activity are not listed
    expect(JSON.stringify(r)).not.toMatch(/Uma Second|Tentative clash|Finished clash|Past one|Past two/);
    // the booking for the same activity adds nothing; the second role adds nothing
    expect(JSON.stringify(r)).not.toContain(booking);
  });

  it("a side in a company the caller holds no Operations right for carries only its window: no project, title, venue or id", async () => {
    const r = await overlaps(U.ops);
    const hidden = (r.overlaps as Row[]).filter((x) => x.b.hidden);
    expect(hidden).toHaveLength(2);
    for (const h of hidden) {
      expect(Object.keys(h.b).sort()).toEqual(["all_day", "ends_at", "ends_local", "hidden", "starts_at", "starts_local", "tz"]);
      expect(h.b).toMatchObject({ hidden: true, all_day: true, starts_local: `${day(3)}T00:00`, ends_local: `${day(4)}T23:59`, tz: "Asia/Dubai" });
      expect(h.a.hidden).toBe(false);
      expect(h.person).toBe("Tariq Technician");
    }
    const text = JSON.stringify(r);
    for (const s of [...Object.values(SECRET_B), PB, B1]) expect(text.includes(s), s).toBe(false);
    // a founder of company A only: the same boundary
    const f = JSON.stringify(await overlaps(U.founder));
    for (const s of [...Object.values(SECRET_B), PB, B1]) expect(f.includes(s), s).toBe(false);
  });

  it("someone who holds the Operations right in both companies sees both sides in full; the other company's manager sees its own side and not ours", async () => {
    const r = await overlaps(U.opsBoth);
    expect(r.total).toBe(3);
    const cross = (r.overlaps as Row[]).filter((x) => x.b.project_id === PB);
    expect(cross).toHaveLength(2);
    expect(cross[0]!.b).toMatchObject({ hidden: false, id: B1, reference: SECRET_B.ref, project_name: SECRET_B.name, title: SECRET_B.title, all_day: true });
    const b = await overlaps(U.opsB, CO.b);
    expect(b.total).toBe(2);
    for (const x of b.overlaps as Row[]) {
      expect(x.a).toMatchObject({ hidden: false, id: B1, project_id: PB });
      expect(x.b.hidden).toBe(true);
      expect(Object.keys(x.b)).not.toContain("title");
    }
    expect(JSON.stringify(b)).not.toMatch(/Airshow|Motor Show|Installation day|Stand build|UAE-P-2099/);
  });

  it("is refused for everyone but an Operations Manager or founder of that company", async () => {
    for (const who of [U.pm, U.member, U.tech, U.opsB, U.pmB]) expect(await code(overlaps(who)), who).toBe("42501");
    expect(await code(overlaps(U.ops, CO.b))).toBe("42501");
    await expect(db.asUser(null, async (query) => query(`select ops_crew_overlaps('${CO.a}')`))).rejects.toThrow();
    // a revoked Operations Manager is refused on the very next read
    await admin(`update proj_company_grants set revoked_at = now() where user_id = '${U.opsBoth}' and company_id = '${CO.a}'`);
    expect(await code(overlaps(U.opsBoth))).toBe("42501");
  });

  it("the office board does not carry the per-person overlaps: a display identity is refused here, and the board read has no overlap, link or other-company detail", async () => {
    await call<string>(U.ops, `ops_tv_register_display('${U.disp}', '${CO.a}', 'Fictional Office TV', 'Asia/Dubai')`);
    expect(await code(overlaps(U.disp))).toBe("42501");
    const board = await call<Row>(U.disp, `ops_tv_board('${CO.a}')`);
    expect(Object.keys(board).sort()).toEqual(["access", "activities", "company", "display", "generated_at", "handovers", "notes", "office_tz", "projects", "shipments", "truncated"]);
    const text = JSON.stringify(board);
    expect(text).not.toMatch(/overlap|"href"|\/projects\//i);
    for (const s of [...Object.values(SECRET_B), PB, B1, U.tech]) expect(text.includes(s), s).toBe(false);
    for (const a of board.activities as Row[]) expect(Object.keys(a)).not.toContain("overlaps");
  });

  it("the owner pack: verify is all OK; the rollback drops only the two functions and is safe to run twice", async () => {
    const verify = await admin<{ item: string; result: string }>(manual("ops_crew_overlaps_20_verify_readonly.sql"));
    expect(verify.map((r) => r.result)).toEqual(["OK", "OK", "OK", "OK"]);
    const pre = await admin<{ item: string; result: string }>(manual("ops_crew_overlaps_00_preflight_readonly.sql").split("-- Cross-company pairs")[0]!);
    expect(pre.slice(0, 2).map((r) => r.result)).toEqual(["OK", "already installed"]);
    expect(Number(pre[3]!.result)).toBe(3);
    expect(Number(pre[4]!.result)).toBe(2);
    await db.seed(manual("ops_crew_overlaps_90_rollback.sql"));
    await db.seed(manual("ops_crew_overlaps_90_rollback.sql"));
    expect((await admin<Row>(`select to_regprocedure('public.ops_crew_overlaps(uuid)') as f`))[0]!.f).toBeNull();
    expect((await admin<Row>(`select count(*)::int as n from proj_site_crew`))[0]!.n).toBeGreaterThan(0);
    void j;
  });
});
