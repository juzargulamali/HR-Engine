import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// A17 / D-23. A letter that still needs CEO / CTO sign-off is stored before approval (the app renders the PDF, stores it, then routes the approval), and the
// storage read policy for the owning employee had no status condition, so the employee could fetch it while it was "pending approval", or after it was
// rejected or voided. The employee branch of letters_select now needs the letter to be ISSUED. HR Admin and CEO / CTO reads are unchanged (HR reviews drafts;
// the executive needs the file to decide), and so are uploads and deletes.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { emp: id(), peer: id(), hr: id(), ceo: id(), cto: id(), hrB: id() };
const E = { emp: id(), peer: id(), hr: id(), ceo: id() };
const TPL = id();

describe("Letters: the employee reads the file only once it is issued (A17)", () => {
  const db = new RlsTestDatabase();
  const seen = (user: string, name: string) => db.asUser(user, async (q) => (await q("select name from storage.objects where bucket_id = 'letters' and name = $1", [name])).rows.length);
  const newLetter = async (status: string) => {
    const name = `${CO.a}/${E.emp}/letters/${id()}-salary_certificate.pdf`;
    await db.seed(`
      insert into storage.objects (bucket_id, name) values ('letters', '${name}');
      insert into generated_letters (employee_id, template_id, generated_by, file_path, status) values ('${E.emp}', '${TPL}', '${U.hr}', '${name}', '${status}');`);
    return name;
  };

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into storage.buckets (id, name, public) values ('letters', 'letters', false) on conflict (id) do nothing;
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Enginious UAE', 'AE', 'AED'), ('${CO.b}', 'Other Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@letters.ae')`).join(", ")};
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${E.emp}', '${U.emp}', 'L-1', '${CO.a}', 'AE', 'Erin', 'Employee', '2024-01-01'),
        ('${E.peer}', '${U.peer}', 'L-2', '${CO.a}', 'AE', 'Pia', 'Peer', '2024-01-01'),
        ('${E.hr}', '${U.hr}', 'L-3', '${CO.a}', 'AE', 'Hana', 'Hr', '2024-01-01'),
        ('${E.ceo}', '${U.ceo}', 'L-4', '${CO.a}', 'AE', 'Cara', 'Ceo', '2024-01-01');
      insert into user_roles (user_id, role, company_id) values ('${U.hr}', 'hr_admin', '${CO.a}'), ('${U.ceo}', 'ceo', '${CO.a}'), ('${U.cto}', 'cto', '${CO.a}'), ('${U.hrB}', 'hr_admin', '${CO.b}');
      insert into letter_templates (id, company_id, template_type, name, body_template) values ('${TPL}', '${CO.a}', 'salary_certificate', 'Salary certificate', 'To whom it may concern: {{employee.full_name}}');
    `);
  }, 60_000);
  afterAll(async () => db.teardown());

  it.each(["draft", "pending_approval", "void"])("the owning employee cannot read the stored file while the letter is %s", async (status) => {
    const name = await newLetter(status);
    expect(await seen(U.emp, name)).toBe(0);
  });

  it("the owning employee reads it once the letter is issued", async () => {
    const name = await newLetter("pending_approval");
    expect(await seen(U.emp, name)).toBe(0);
    await db.seed(`update generated_letters set status = 'issued' where file_path = '${name}'`);
    expect(await seen(U.emp, name)).toBe(1);
  });

  it("a file with no letter row (an orphan) is not readable by the employee", async () => {
    const name = `${CO.a}/${E.emp}/letters/${id()}-orphan.pdf`;
    await db.seed(`insert into storage.objects (bucket_id, name) values ('letters', '${name}')`);
    expect(await seen(U.emp, name)).toBe(0);
  });

  it("HR Admin of the company still reads it in every status (review), and so do the CEO and CTO who decide it", async () => {
    for (const status of ["draft", "pending_approval", "issued", "void"]) {
      const name = await newLetter(status);
      for (const who of [U.hr, U.ceo, U.cto]) expect(await seen(who, name), `${status} / ${who}`).toBe(1);
    }
  });

  it("everyone else is still refused: a peer, HR Admin of another company, and (even issued) another employee's letter", async () => {
    const issued = await newLetter("issued");
    const pending = await newLetter("pending_approval");
    for (const name of [issued, pending]) for (const who of [U.peer, U.hrB]) expect(await seen(who, name), `${name} / ${who}`).toBe(0);
  });

  it("the employee's own letter row (status) is still readable, so the page can say 'pending approval'", async () => {
    const name = await newLetter("pending_approval");
    const rows = await db.asUser(U.emp, async (q) => (await q("select status from generated_letters where file_path = $1", [name])).rows);
    expect(rows).toEqual([{ status: "pending_approval" }]);
  });

  it("HR still stores and deletes letter files (unchanged)", async () => {
    const name = `${CO.a}/${E.emp}/letters/${id()}-new.pdf`;
    await db.asUserCommit(U.hr, async (q) => q("insert into storage.objects (bucket_id, name) values ('letters', $1)", [name]));
    expect(await db.asUserCommit(U.hr, async (q) => (await q("delete from storage.objects where bucket_id = 'letters' and name = $1", [name])).rowCount)).toBe(1);
  });
});
