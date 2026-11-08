import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales & CRM: pre-inquiry outreach (section 8 of migration 20261219000100_crm_clients_agencies.sql). Proves, against a real Postgres:
//   * a Sales lead (assign_owner / founder) assigns one or several accounts in one call, each with its own result; a plain salesperson, a person with no
//     grant and a person of another company are refused, and a person with no Sales access for the company cannot be assigned;
//   * one OPEN outreach per account per company: a second assignment reassigns it (history kept), the same person again changes nothing;
//   * the account owner and the outreach are independent in both directions, and an assignment confers no read or edit right beyond Sales access;
//   * the assignee reads only own outreach, a lead reads the company's, everyone else reads none; the history is append-only;
//   * status rules: first activity -> In progress, link inquiry -> Inquiry raised, Closed needs a reason, no outcome is ever inferred as a reply.

const FIRST_CRM_MIGRATION = "20261115000000_crm_access_audit_settings.sql";
const MIGRATIONS = [
  "20261115000000_crm_access_audit_settings.sql",
  "20261115000100_crm_core_tables.sql",
  "20261115000200_crm_workflow_functions.sql",
  "20261115000300_crm_proposals_files_reminders.sql",
  "20261219000100_crm_clients_agencies.sql",
];

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), lead: id(), sara: id(), omar: id(), nogrant: id(), ksaOnly: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@outreach-test.ae')`).join(", ");
const TARGET = "'2027-01-15'";

describe("Pre-inquiry outreach", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Record<string, unknown>>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const org = async (name: string, roles = "{agency}") => (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => '${name}', p_roles => '${roles}', p_company_id => '${CO.uae}') as id`))[0].id;
  const assign = (user: string, orgs: string[], to: string, target = TARGET, objective = "null", company = CO.uae) =>
    commit<{ r: { organisation_id: string; result: string }[] }>(user, `select crm_assign_outreach('${company}', array[${orgs.map((o) => `'${o}'::uuid`).join(",")}], '${to}', ${target}::date, ${objective}) as r`).then((x) => x[0].r);
  type OutreachRow = { id: string; assigned_to: string; status: string; last_outcome: string | null; opportunity_id: string | null; next_action: string | null };
  // undefined when the account has no open outreach (typed as present for brevity; the one test that expects none compares with undefined)
  const outreachOf = async (o: string, company = CO.uae) => (await admin<OutreachRow>(
    `select id, assigned_to, status, last_outcome, opportunity_id, next_action from crm_outreach where organisation_id = '${o}' and company_id = '${company}' and status <> 'closed'`))[0] as OutreachRow;
  const eventKinds = async (oid: string) => (await admin<{ kind: string }>(`select kind from crm_outreach_events where outreach_id = '${oid}' order by created_at, id`)).map((r) => r.kind);
  const today = () => "(now() at time zone 'Asia/Dubai')::date";

  let A: string, B: string, C: string, D: string, E: string;
  let oppA: string, oppB: string, oppKsa: string;

  beforeAll(async () => {
    await db.setupBefore(FIRST_CRM_MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
    `);
    for (const f of MIGRATIONS) await db.applyMigration(f);
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.founder}', '${CO.ksa}', '{founder}'),
        ('${U.lead}', '${CO.uae}', '{assign_owner}'),
        ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'),
        ('${U.ksaOnly}', '${CO.ksa}', '{}');
    `);
    [A, B, C, D, E] = [await org("Fictional Outreach A"), await org("Fictional Outreach B"), await org("Fictional Outreach C"), await org("Fictional Outreach D"), await org("Fictional Outreach E")];
    const soon = "now() + interval '2 days'";
    oppA = (await commit<{ id: string }>(U.sara, `select crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'A gala', p_source => 'agency_call', p_next_title => 'Call', p_next_due => ${soon}, p_agency_org_id => '${A}') as id`))[0].id;
    oppB = (await commit<{ id: string }>(U.sara, `select crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'B gala', p_source => 'agency_call', p_next_title => 'Call', p_next_due => ${soon}, p_agency_org_id => '${B}') as id`))[0].id;
    oppKsa = (await commit<{ id: string }>(U.founder, `select crm_create_opportunity(p_company_id => '${CO.ksa}', p_title => 'KSA gala', p_source => 'agency_call', p_next_title => 'Call', p_next_due => ${soon}, p_agency_org_id => '${A}') as id`))[0].id;
  });
  afterAll(async () => { await db.teardown(); });

  describe("assigning", () => {
    it("assigns several accounts in one call, one result each, with no inquiry and no deal", async () => {
      const before = (await admin<{ n: string }>(`select count(*) n from crm_opportunities`))[0].n;
      const r = await assign(U.lead, [A, B, C], U.sara, TARGET, "'Reconnect and ask about upcoming exhibitions'");
      expect(r.map((x) => x.result)).toEqual(["assigned", "assigned", "assigned"]);
      const [o] = await admin<{ objective: string; target_date: string; status: string; assigned_by: string }>(`select objective, target_date::text, status, assigned_by from crm_outreach where organisation_id = '${A}'`);
      expect(o).toEqual({ objective: "Reconnect and ask about upcoming exhibitions", target_date: "2027-01-15", status: "not_started", assigned_by: U.lead });
      expect((await admin<{ n: string }>(`select count(*) n from crm_opportunities`))[0].n).toBe(before);
    });

    it("a second assignment reassigns the open outreach: one row, history kept; the same person again changes nothing", async () => {
      const first = await outreachOf(A);
      const r = await assign(U.founder, [A], U.omar, "'2027-02-01'");
      expect(r[0]?.result).toBe("reassigned");
      const open = await admin(`select 1 from crm_outreach where organisation_id = '${A}' and company_id = '${CO.uae}' and status <> 'closed'`);
      expect(open).toHaveLength(1);
      const now = await outreachOf(A);
      expect(now.id).toBe(first.id);
      expect(now.assigned_to).toBe(U.omar);
      expect(await eventKinds(first.id)).toEqual(["assigned", "reassigned"]);
      expect((await assign(U.lead, [A], U.omar))[0]?.result).toBe("already");
      expect(await eventKinds(first.id)).toEqual(["assigned", "reassigned"]);
      await assign(U.lead, [A], U.sara); // back to sara for the later tests
    });

    it("refuses a plain salesperson, a person without a grant and a person of another company", async () => {
      await expect(assign(U.sara, [D], U.sara)).rejects.toThrow(/assign owners right/);
      await expect(assign(U.nogrant, [D], U.sara)).rejects.toThrow(/assign owners right/);
      await expect(assign(U.ksaOnly, [D], U.sara)).rejects.toThrow(/assign owners right/);
      await expect(assign(U.lead, [D], U.sara, TARGET, "null", CO.ksa)).rejects.toThrow(/assign owners right/);
      expect(await admin(`select 1 from crm_outreach where organisation_id = '${D}'`)).toHaveLength(0);
    });

    it("cannot assign to someone without Sales access for the company, and needs a target date", async () => {
      await expect(assign(U.lead, [D], U.nogrant)).rejects.toThrow(/no Sales access/);
      await expect(assign(U.lead, [D], U.ksaOnly)).rejects.toThrow(/no Sales access/);
      await expect(commit(U.lead, `select crm_assign_outreach('${CO.uae}', array['${D}'::uuid], '${U.sara}', null)`)).rejects.toThrow(/target date/);
      await expect(commit(U.lead, `select crm_assign_outreach('${CO.uae}', array[]::uuid[], '${U.sara}', ${TARGET}::date)`)).rejects.toThrow(/at least one/);
    });

    it("reports an unknown account per row without failing the others", async () => {
      const r = await assign(U.lead, [D, randomUUID()], U.omar);
      expect(r.map((x) => x.result).sort()).toEqual(["assigned", "not_found"]);
    });
  });

  describe("independence and no widening", () => {
    it("outreach and account owner never change each other, in either direction", async () => {
      await commit(U.founder, `select crm_assign_account_owner('${B}', '${CO.uae}', '${U.omar}')`);
      expect((await outreachOf(B)).assigned_to).toBe(U.sara);
      await assign(U.lead, [B], U.omar);
      await assign(U.lead, [B], U.sara);
      expect((await admin<{ owner_id: string }>(`select owner_id from crm_account_profiles where organisation_id = '${B}' and company_id = '${CO.uae}'`))[0].owner_id).toBe(U.omar);
      await commit(U.founder, `select crm_assign_account_owner('${B}', '${CO.uae}', '${U.sara}')`);
      expect((await outreachOf(B)).assigned_to).toBe(U.sara);
      expect((await admin<{ owner_id: string | null }>(`select owner_id from crm_account_profiles where organisation_id = '${C}' and company_id = '${CO.uae}'`))[0].owner_id).toBeNull(); // outreach alone never sets an owner
    });

    it("an assignee gets exactly the rights of a Sales grantee: no edit, no assigning, no account owner", async () => {
      await expect(commit(U.sara, `select crm_update_organisation('${C}', '{"note":"x"}'::jsonb)`)).rejects.toThrow(/./);   // C has no inquiry of sara's: assignment gives no edit right
      await expect(commit(U.sara, `select crm_assign_account_owner('${A}', '${CO.uae}', '${U.sara}')`)).rejects.toThrow();
      await expect(commit(U.sara, `insert into crm_outreach (organisation_id, company_id, assigned_to, assigned_by, target_date) values ('${E}', '${CO.uae}', '${U.sara}', '${U.sara}', ${TARGET})`)).rejects.toThrow();
      await expect(commit(U.sara, `update crm_outreach set assigned_to = '${U.omar}'`)).resolves.toBeDefined(); // no policy: touches nothing
      expect((await outreachOf(A)).assigned_to).toBe(U.sara);
    });

    it("an assignee reads only own outreach, a lead the company's, nobody else any", async () => {
      await assign(U.lead, [E], U.omar);
      const mine = await q<{ organisation_id: string }>(U.sara, `select organisation_id from crm_outreach`);
      expect(mine.map((r) => r.organisation_id).sort()).toEqual([A, B, C].sort());
      expect((await q(U.omar, `select 1 from crm_outreach where organisation_id = '${E}'`))).toHaveLength(1);
      expect(await q(U.omar, `select 1 from crm_outreach where organisation_id = '${A}'`)).toHaveLength(0);
      expect((await q(U.lead, `select 1 from crm_outreach`)).length).toBeGreaterThanOrEqual(5);
      expect(await q(U.nogrant, `select 1 from crm_outreach`)).toHaveLength(0);
      expect(await q(U.ksaOnly, `select 1 from crm_outreach`)).toHaveLength(0);
      expect(await q(U.omar, `select 1 from crm_outreach_events where organisation_id = '${A}'`)).toHaveLength(0);
      expect((await q(U.sara, `select 1 from crm_outreach_events where organisation_id = '${A}'`)).length).toBeGreaterThan(0);
    });

    it("a person who is neither the assignee nor a lead cannot act on it; another company cannot find it", async () => {
      const o = await outreachOf(A);
      await expect(commit(U.omar, `select crm_outreach_log('${o.id}', 'call', ${today()}, 'spoke')`)).rejects.toThrow(/assigned to/);
      await expect(commit(U.omar, `select crm_outreach_set_status('${o.id}', 'in_progress')`)).rejects.toThrow(/assigned to/);
      await expect(commit(U.ksaOnly, `select crm_outreach_log('${o.id}', 'call', ${today()}, 'spoke')`)).rejects.toThrow(/not found/);
      await expect(commit(U.nogrant, `select crm_outreach_set_next('${o.id}', 'x', ${today()})`)).rejects.toThrow();
    });
  });

  describe("activity, status and history", () => {
    it("the first activity moves Not started to In progress; an e-mail or call never becomes a reply", async () => {
      const o = await outreachOf(A);
      expect(o.status).toBe("not_started");
      await commit(U.sara, `select crm_outreach_log('${o.id}', 'call', ${today()}, 'no_answer', 'Rang twice')`);
      expect((await outreachOf(A)).status).toBe("in_progress");
      await commit(U.sara, `select crm_outreach_log('${o.id}', 'email', ${today()}, 'sent', 'Sent the portfolio')`);
      const after = await outreachOf(A);
      expect(after.status).toBe("in_progress");
      expect(after.last_outcome).toBe("sent");
      expect(await admin(`select 1 from crm_outreach_events where outreach_id = '${o.id}' and outcome = 'replied'`)).toHaveLength(0);
      await commit(U.sara, `select crm_outreach_log('${o.id}', 'email', ${today()}, 'replied')`);   // explicit choice only
      const replied = await outreachOf(A);
      expect(replied.last_outcome).toBe("replied");
      expect(replied.status).toBe("in_progress");   // even an explicit reply moves no status by itself
    });

    it("validates kind, outcome, date and the next action", async () => {
      const o = await outreachOf(A);
      await expect(commit(U.sara, `select crm_outreach_log('${o.id}', 'sms', ${today()}, 'spoke')`)).rejects.toThrow(/call, e-mail or meeting/);
      await expect(commit(U.sara, `select crm_outreach_log('${o.id}', 'call', ${today()}, 'liked')`)).rejects.toThrow(/outcome/);
      await expect(commit(U.sara, `select crm_outreach_log('${o.id}', 'call', ${today()} + 3, 'spoke')`)).rejects.toThrow(/future/);
      await expect(commit(U.sara, `select crm_outreach_log('${o.id}', 'call', ${today()}, 'spoke', null, 'Call back', null)`)).rejects.toThrow(/both/);
      await expect(commit(U.sara, `select crm_outreach_set_next('${o.id}', '  ', ${today()})`)).rejects.toThrow(/both/);
    });

    it("sets the next action with a due date, and logging may set it in the same step", async () => {
      const o = await outreachOf(A);
      await commit(U.sara, `select crm_outreach_set_next('${o.id}', 'Send the case study', '2027-01-20')`);
      expect((await outreachOf(A)).next_action).toBe("Send the case study");
      await commit(U.sara, `select crm_outreach_log('${o.id}', 'meeting', ${today()}, 'meeting_held', 'Met at the stand', 'Prepare quote', '2027-01-25')`);
      const [r] = await admin<{ next_action: string; next_due: string; last_contact_kind: string }>(`select next_action, next_due::text, last_contact_kind from crm_outreach where id = '${o.id}'`);
      expect(r).toEqual({ next_action: "Prepare quote", next_due: "2027-01-25", last_contact_kind: "meeting" });
    });

    it("status is explicit; Inquiry raised only by linking; Closed needs a reason and is final", async () => {
      const o = await outreachOf(B);
      await commit(U.sara, `select crm_outreach_set_status('${o.id}', 'meeting_booked')`);
      expect((await outreachOf(B)).status).toBe("meeting_booked");
      await expect(commit(U.sara, `select crm_outreach_set_status('${o.id}', 'inquiry_raised')`)).rejects.toThrow(/linking an inquiry/);
      await expect(commit(U.sara, `select crm_outreach_set_status('${o.id}', 'closed')`)).rejects.toThrow(/why/);
      await expect(commit(U.sara, `select crm_outreach_set_status('${o.id}', 'waiting_for_reply')`)).resolves.toBeDefined();
      await commit(U.lead, `select crm_outreach_set_status('${o.id}', 'closed', 'Not relevant any more')`);
      expect(await outreachOf(B)).toBeUndefined();
      await expect(commit(U.sara, `select crm_outreach_log('${o.id}', 'call', ${today()}, 'spoke')`)).rejects.toThrow(/closed/);
      // a closed outreach frees the account: a new assignment starts a new row
      expect((await assign(U.lead, [B], U.omar))[0]?.result).toBe("assigned");
      expect(await admin(`select 1 from crm_outreach where organisation_id = '${B}'`)).toHaveLength(2);
    });

    it("links a real inquiry of the account: sets Inquiry raised, creates nothing, keeps history", async () => {
      const o = await outreachOf(A);
      const deals = (await admin<{ n: string }>(`select count(*) n from crm_opportunities`))[0].n;
      await expect(commit(U.sara, `select crm_outreach_link_inquiry('${o.id}', '${oppB}')`)).rejects.toThrow(/not on this account/);
      await expect(commit(U.sara, `select crm_outreach_link_inquiry('${o.id}', '${oppKsa}')`)).rejects.toThrow(/not on this account/);   // the account's inquiry of ANOTHER company
      await commit(U.sara, `select crm_outreach_link_inquiry('${o.id}', '${oppA}')`);
      const after = await outreachOf(A);
      expect(after.status).toBe("inquiry_raised");
      expect(after.opportunity_id).toBe(oppA);
      expect((await admin<{ n: string }>(`select count(*) n from crm_opportunities`))[0].n).toBe(deals);
      const kinds = await eventKinds(o.id);
      expect(kinds).toContain("inquiry_linked");
      expect(kinds.filter((k) => k === "call").length).toBe(1);
      await expect(commit(U.sara, `select crm_outreach_set_status('${o.id}', 'in_progress')`)).rejects.toThrow(/only be closed/);
    });

    it("the history is append-only for everyone", async () => {
      const o = await outreachOf(A);
      await expect(admin(`update crm_outreach_events set note = 'x' where outreach_id = '${o.id}'`)).rejects.toThrow(/cannot be changed/);
      await expect(admin(`delete from crm_outreach_events where outreach_id = '${o.id}'`)).rejects.toThrow(/cannot be changed/);
      await expect(commit(U.lead, `delete from crm_outreach_events`)).resolves.toBeDefined();   // no policy: deletes nothing
      await expect(commit(U.lead, `insert into crm_outreach_events (outreach_id, company_id, organisation_id, kind, occurred_on, created_by)
        select id, company_id, organisation_id, 'call', current_date, '${U.lead}' from crm_outreach limit 1`)).rejects.toThrow();
      expect((await eventKinds(o.id)).length).toBeGreaterThan(5);
    });

    it("overdue and filters read straight from the row: next due before today, not closed", async () => {
      await commit(U.sara, `select crm_outreach_set_next('${(await outreachOf(C)).id}', 'Chase', '2020-01-01')`);
      const rows = await q<{ organisation_id: string }>(U.lead, `select organisation_id from crm_outreach where status not in ('closed', 'inquiry_raised') and coalesce(next_due, target_date) < ${today()}`);
      expect(rows.map((r) => r.organisation_id)).toContain(C);
    });
  });

  describe("outcomes per kind", () => {
    const ok: [string, string][] = [["call", "no_answer"], ["call", "left_message"], ["call", "spoke"], ["call", "call_back_requested"], ["call", "not_interested"],
      ["email", "sent"], ["email", "replied"], ["email", "bounced"], ["email", "not_interested"],
      ["meeting", "meeting_booked"], ["meeting", "meeting_held"], ["meeting", "rescheduled"], ["meeting", "no_show"], ["meeting", "not_interested"]];
    const bad: [string, string][] = [["call", "replied"], ["call", "sent"], ["call", "bounced"], ["call", "meeting_held"], ["call", "no_show"],
      ["email", "spoke"], ["email", "no_answer"], ["email", "meeting_booked"], ["email", "call_back_requested"],
      ["meeting", "replied"], ["meeting", "spoke"], ["meeting", "sent"], ["meeting", "no_answer"]];
    it("accepts every valid kind and outcome pair, and an outcome never moves the status beyond the first-activity rule", async () => {
      const F = await org("Fictional Outcomes F");
      await assign(U.lead, [F], U.sara);
      const o = await outreachOf(F);
      for (const [kind, outcome] of ok) await commit(U.sara, `select crm_outreach_log('${o.id}', '${kind}', ${today()}, '${outcome}')`);
      const stored = await admin<{ n: string }>(`select count(*) n from crm_outreach_events where outreach_id = '${o.id}' and kind in ('call', 'email', 'meeting')`);
      expect(Number(stored[0].n)).toBe(ok.length);
      expect((await outreachOf(F)).status).toBe("in_progress");
    });
    it("rejects an outcome that does not fit its kind, in words, and stores nothing", async () => {
      const o = await outreachOf(await org("Fictional Outcomes G").then(async (g) => { await assign(U.lead, [g], U.sara); return g; }));
      for (const [kind, outcome] of bad) {
        await expect(commit(U.sara, `select crm_outreach_log('${o.id}', '${kind}', ${today()}, '${outcome}')`), `${kind}/${outcome}`).rejects.toThrow(/That outcome does not fit a .*Choose one of/);
      }
      await expect(commit(U.sara, `select crm_outreach_log('${o.id}', 'call', ${today()}, '')`)).rejects.toThrow(/Choose an outcome/);
      await expect(commit(U.sara, `select crm_outreach_log('${o.id}', 'call', ${today()}, null)`)).rejects.toThrow(/Choose an outcome/);
      expect(await admin(`select 1 from crm_outreach_events where outreach_id = '${o.id}' and kind in ('call', 'email', 'meeting')`)).toHaveLength(0);
      expect((await outreachOf((await admin<{ organisation_id: string }>(`select organisation_id from crm_outreach where id = '${o.id}'`))[0].organisation_id)).status).toBe("not_started");
    });
    it("outcomes recorded under the original single list stay valid and readable, unchanged", async () => {
      const H = await org("Fictional Outcomes H");
      await assign(U.lead, [H], U.sara);
      const o = await outreachOf(H);
      // rows as the original single list allowed them, including pairs the per-kind lists no longer offer (a call that "replied", an e-mail that was "spoke")
      const legacy: [string, string][] = [["call", "replied"], ["email", "spoke"], ["call", "meeting_held"], ["email", "left_message"], ["meeting", "sent"], ["call", "sent"], ["meeting", "no_answer"]];
      for (const [kind, outcome] of legacy) {
        await admin(`insert into crm_outreach_events (outreach_id, company_id, organisation_id, kind, occurred_on, outcome, created_by)
          values ('${o.id}', '${CO.uae}', '${H}', '${kind}', ${today()}, '${outcome}', '${U.sara}')`);
      }
      await admin(`update crm_outreach set last_outcome = 'meeting_held', last_contact_kind = 'call', last_contact_on = ${today()} where id = '${o.id}'`);   // old row shape: allowed, not rewritten
      const asAssignee = await q<{ kind: string; outcome: string }>(U.sara, `select kind, outcome from crm_outreach_events where outreach_id = '${o.id}' and outcome is not null order by created_at, id`);
      expect(asAssignee.map((r) => [r.kind, r.outcome])).toEqual(legacy);
      expect((await q<{ last_outcome: string }>(U.lead, `select last_outcome from crm_outreach where id = '${o.id}'`))[0].last_outcome).toBe("meeting_held");
      await expect(commit(U.sara, `select crm_outreach_log('${o.id}', 'call', ${today()}, 'replied')`)).rejects.toThrow(/does not fit a call/);   // NEW entries are checked
      await commit(U.sara, `select crm_outreach_log('${o.id}', 'call', ${today()}, 'spoke')`);   // and logging on after the old rows works
      await expect(admin(`insert into crm_outreach_events (outreach_id, company_id, organisation_id, kind, occurred_on, outcome, created_by)
        values ('${o.id}', '${CO.uae}', '${H}', 'call', ${today()}, 'liked', '${U.sara}')`)).rejects.toThrow();   // the table still refuses unknown values
    });
  });

  describe("reassignment and who can read the history", () => {
    const log = (user: string, oid: string, kind: string, outcome: string, note: string) => commit(user, `select crm_outreach_log('${oid}', '${kind}', ${today()}, '${outcome}', '${note}')`);
    type Ev = { id: string; kind: string; outcome: string | null; note: string | null; created_by: string; created_at: string };
    const events = (user: string, oid: string) => q<Ev>(user, `select id, kind, outcome, note, created_by, created_at::text from crm_outreach_events where outreach_id = '${oid}' order by created_at, id`);
    const allEvents = (oid: string) => admin<Ev>(`select id, kind, outcome, note, created_by, created_at::text from crm_outreach_events where outreach_id = '${oid}' order by created_at, id`);

    it("after a reassignment the new assignee reads the FULL history, the former assignee reads nothing, and the history is unchanged and records the move", async () => {
      const F = await org("Fictional Reassign F");
      await assign(U.lead, [F], U.sara);
      const o = await outreachOf(F);
      await log(U.sara, o.id, "call", "left_message", "Sara rang");
      await log(U.lead, o.id, "email", "sent", "Lead sent the deck");
      await log(U.sara, o.id, "email", "replied", "They answered");
      await commit(U.sara, `select crm_outreach_set_next('${o.id}', 'Book a meeting', '2027-02-01')`);
      const before = await allEvents(o.id);
      expect(await events(U.sara, o.id)).toEqual(before);   // the first assignee reads all of it
      expect((await q(U.omar, `select 1 from crm_outreach where id = '${o.id}'`))).toHaveLength(0);

      expect((await assign(U.founder, [F], U.omar))[0]?.result).toBe("reassigned");

      // history intact and append-only: every earlier event is still there, byte for byte, in order; one event was added and it names the move
      const after = await allEvents(o.id);
      expect(after.slice(0, before.length)).toEqual(before);
      expect(after.slice(before.length).map((e) => e.kind)).toEqual(["reassigned"]);
      const [move] = await admin<{ from_user: string; to_user: string; created_by: string }>(`select from_user, to_user, created_by from crm_outreach_events where outreach_id = '${o.id}' and kind = 'reassigned'`);
      expect(move).toEqual({ from_user: U.sara, to_user: U.omar, created_by: U.founder });

      // the NEW assignee reads everything, including what the former assignee and a lead logged before the move
      const asOmar = await events(U.omar, o.id);
      expect(asOmar).toEqual(after);
      expect(new Set(asOmar.map((e) => e.created_by))).toEqual(new Set([U.lead, U.sara, U.founder]));
      expect(asOmar.map((e) => e.note)).toEqual(expect.arrayContaining(["Sara rang", "Lead sent the deck", "They answered"]));
      expect((await q(U.omar, `select 1 from crm_outreach where id = '${o.id}' and assigned_to = '${U.omar}'`))).toHaveLength(1);   // "My outreach" lists it
      await log(U.omar, o.id, "meeting", "meeting_booked", "Omar booked it");
      expect((await events(U.omar, o.id)).length).toBe(after.length + 1);

      // the FORMER assignee: no row, no events, no "My outreach", cannot act (the database refuses, hiding is not what protects it)
      expect(await q(U.sara, `select 1 from crm_outreach where id = '${o.id}'`)).toHaveLength(0);
      expect(await q(U.sara, `select 1 from crm_outreach where assigned_to = '${U.sara}' and organisation_id = '${F}'`)).toHaveLength(0);
      expect(await q(U.sara, `select 1 from crm_outreach_events where outreach_id = '${o.id}'`)).toHaveLength(0);
      expect(await q(U.sara, `select 1 from crm_outreach_events where organisation_id = '${F}'`)).toHaveLength(0);
      await expect(log(U.sara, o.id, "call", "spoke", "still here?")).rejects.toThrow(/assigned to/);
      await expect(commit(U.sara, `select crm_outreach_set_next('${o.id}', 'x', ${today()})`)).rejects.toThrow(/assigned to/);

      // append-only holds through reassignment for everyone, including the lead and the new assignee
      await expect(admin(`update crm_outreach_events set note = 'edited' where outreach_id = '${o.id}'`)).rejects.toThrow(/cannot be changed/);
      await expect(admin(`delete from crm_outreach_events where outreach_id = '${o.id}'`)).rejects.toThrow(/cannot be changed/);
      expect((await allEvents(o.id)).slice(0, before.length)).toEqual(before);
    });

    it("a former assignee who is separately authorised (assign_owner) still reads the outreach and its whole history", async () => {
      const G = await org("Fictional Reassign G");
      await assign(U.founder, [G], U.lead);   // the lead holds assign_owner and is the first assignee
      const o = await outreachOf(G);
      await log(U.lead, o.id, "call", "spoke", "Lead spoke");
      await assign(U.founder, [G], U.omar);
      const history = await allEvents(o.id);
      expect(history.map((e) => e.kind).sort()).toEqual(["assigned", "call", "reassigned", "status"]);
      expect(await events(U.lead, o.id)).toEqual(history);
      expect(await events(U.omar, o.id)).toEqual(history);
      expect(await q(U.lead, `select 1 from crm_outreach where id = '${o.id}'`)).toHaveLength(1);
      // and a former assignee without that right is out, even on the same outreach, in the same company
      expect(await events(U.sara, o.id)).toHaveLength(0);
    });
  });

  describe("owner pack", () => {
    it("the read-only verify file passes on the migrated schema", async () => {
      const sql = readFileSync(fileURLToPath(new URL("../../../supabase/manual-sql/crm_accounts_20_verify_readonly.sql", import.meta.url)), "utf8");
      // the harness grants every table to the signed-in role for convenience; put the migration's own privileges back before checking them
      await admin(`revoke all on all tables in schema public from authenticated; grant select on crm_account_profiles, crm_outreach, crm_outreach_events to authenticated`);
      const rows = await admin<{ check: string; item: string; result: string }>(sql);
      expect(rows.filter((r) => r.result === "FAIL")).toEqual([]);
      expect(rows.some((r) => r.check.includes("outreach") )).toBe(true);
    });
  });
});
