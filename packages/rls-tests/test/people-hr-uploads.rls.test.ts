import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// People & HR signed uploads (no new migration: the three upload paths use the buckets, policies and tables that already exist), against a real Postgres. Fictional data.
// The server steps authorise from the database first and sign with the service role; these tests pin what the DATABASE itself would still refuse, so that a mistake in the
// server step could not widen access:
//   * "Attach file" on an identity document is one conditional update of file_path on that row: only an HR Admin of the employee's company can do it, it never touches the
//     number or dates, and it cannot overwrite a file that is already there;
//   * the identity, employee-document, insurance and receipt buckets accept an object only under the path of a person allowed to write there (HR Admin of the path's company,
//     or the employee themselves for receipts), and only those people can remove it again (what the failure clean-up relies on).

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { hrA: id(), hrB: id(), emp: id(), mgr: id(), fin: id() };
const E = { emp: id(), other: id() };
const DOC = { empty: id(), filled: id(), otherCo: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@hrup.ae')`).join(", ");
const OLD_FILE = `${CO.a}/${E.emp}/passport/old-scan.pdf`;

describe("People & HR signed uploads: what the database still enforces", () => {
  const db = new RlsTestDatabase();
  const attach = (user: string, docId: string, path: string) =>
    db.asUser(user, async (query) => (await query("update identity_documents set file_path = $2 where id = $1 and file_path is null returning id, file_path", [docId, path])).rows);
  const insertObject = (user: string, bucket: string, name: string) => db.asUser(user, (query) => query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, name]));
  const removeObject = (user: string, bucket: string, name: string) => db.asUser(user, async (query) => (await query("delete from storage.objects where bucket_id = $1 and name = $2 returning name", [bucket, name])).rows);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional Aurora LLC', 'AE', 'AED'), ('${CO.b}', 'Fictional Birch LLC', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, job_title) values
        ('${E.emp}', '${U.emp}', 'UP-001', '${CO.a}', 'AE', 'Fictional', 'Technician', '2024-01-01', 'Technician'),
        ('${E.other}', null, 'UP-002', '${CO.b}', 'AE', 'Fictional', 'OtherCo', '2024-01-01', 'Clerk');
      insert into user_roles (user_id, role, company_id) values ('${U.hrA}', 'hr_admin', '${CO.a}'), ('${U.hrB}', 'hr_admin', '${CO.b}'), ('${U.mgr}', 'line_manager', '${CO.a}'), ('${U.fin}', 'finance', '${CO.a}');
      insert into identity_documents (id, employee_id, document_type, document_number, expiry_date, file_path, created_by) values
        ('${DOC.empty}', '${E.emp}', 'emirates_id', '784-0000-0000000-0', '2031-05-01', null, '${U.hrA}'),
        ('${DOC.filled}', '${E.emp}', 'passport', 'FICTIONAL-0001', '2030-01-01', '${OLD_FILE}', '${U.hrA}'),
        ('${DOC.otherCo}', '${E.other}', 'emirates_id', '784-0000-0000000-9', '2031-05-01', null, '${U.hrB}');
      insert into storage.buckets (id, name, public) values ('employee-documents','employee-documents',false), ('identity-documents','identity-documents',false), ('insurance-documents','insurance-documents',false), ('receipts','receipts',false) on conflict (id) do nothing;
    `);
  }, 60_000);

  afterAll(async () => { await db.teardown(); });

  describe("Attach file on an identity document that has none", () => {
    const path = `${CO.a}/${E.emp}/emirates_id/${id()}-eid.pdf`;

    it("lets the HR Admin of the employee's company set file_path on THAT row, leaving the number and dates as they were", async () => {
      const result = await db.asUser(U.hrA, async (query) => {
        const rows = (await query("update identity_documents set file_path = $2 where id = $1 and file_path is null returning id", [DOC.empty, path])).rows;
        const after = (await query("select document_number, expiry_date::text as expiry_date, document_type, employee_id, file_path from identity_documents where id = $1", [DOC.empty])).rows[0];
        return { rows, after };
      });
      expect(result.rows).toEqual([{ id: DOC.empty }]);
      expect(result.after).toEqual({ document_number: "784-0000-0000000-0", expiry_date: "2031-05-01", document_type: "emirates_id", employee_id: E.emp, file_path: path });
    });
    it("is idempotent on retry inside one session: the second conditional update finds nothing to change", async () => {
      const second = await db.asUser(U.hrA, async (query) => {
        await query("update identity_documents set file_path = $2 where id = $1 and file_path is null", [DOC.empty, path]);
        return (await query("update identity_documents set file_path = $2 where id = $1 and file_path is null returning id", [DOC.empty, path])).rows;
      });
      expect(second).toEqual([]);
    });
    it("never overwrites a file that is already there", async () => {
      expect(await attach(U.hrA, DOC.filled, `${CO.a}/${E.emp}/passport/new.pdf`)).toEqual([]);
      const kept = await db.seed(`select file_path from identity_documents where id = '${DOC.filled}'`);
      expect(kept.rows).toEqual([{ file_path: OLD_FILE }]);
    });
    it("changes nothing for an HR Admin of another company, the employee, a line manager or Finance", async () => {
      for (const user of [U.hrB, U.emp, U.mgr, U.fin]) expect(await attach(user, DOC.empty, `${CO.a}/${E.emp}/emirates_id/x.pdf`)).toEqual([]);
      expect(await attach(U.hrA, DOC.otherCo, `${CO.b}/${E.other}/emirates_id/x.pdf`)).toEqual([]);
      expect((await db.seed(`select file_path from identity_documents where id = '${DOC.otherCo}'`)).rows).toEqual([{ file_path: null }]);
    });
    it("cannot move the document to another employee while attaching", async () => {
      await expect(db.asUser(U.hrA, (query) => query("update identity_documents set file_path = 'x', employee_id = $2 where id = $1", [DOC.empty, E.other]))).rejects.toThrow();
    });
  });

  describe("storage buckets: who may put an object under a path, and who may remove it again", () => {
    const hrFile = (bucket: string) => `${CO.a}/${E.emp}/${bucket === "insurance-documents" ? "" : "type/"}${id()}-scan.pdf`;
    it.each(["employee-documents", "identity-documents", "insurance-documents"])("%s: an HR Admin of the path's company can write and remove; another company's HR Admin, the employee, a manager and Finance cannot", async (bucket) => {
      const name = hrFile(bucket);
      await expect(insertObject(U.hrA, bucket, name)).resolves.toBeTruthy();
      for (const user of [U.hrB, U.emp, U.mgr, U.fin]) await expect(insertObject(user, bucket, name)).rejects.toThrow(/row-level security/);
      await expect(insertObject(U.hrA, bucket, name.replace(CO.a, CO.b))).rejects.toThrow(/row-level security/);
      await db.seed(`insert into storage.objects (bucket_id, name) values ('${bucket}', '${name}')`);
      expect(await removeObject(U.hrA, bucket, name)).toEqual([{ name }]);
      for (const user of [U.hrB, U.emp, U.mgr, U.fin]) expect(await removeObject(user, bucket, name)).toEqual([]);
      await db.seed(`delete from storage.objects where bucket_id = '${bucket}' and name = '${name}'`);
    });
    it("receipts: the employee writes and removes only under their own employee path; HR Admin and Finance can read them but not write", async () => {
      const own = `${CO.a}/${E.emp}/receipts/${id()}-taxi.pdf`;
      await expect(insertObject(U.emp, "receipts", own)).resolves.toBeTruthy();
      await expect(insertObject(U.emp, "receipts", `${CO.a}/${E.other}/receipts/${id()}-taxi.pdf`)).rejects.toThrow(/row-level security/);
      for (const user of [U.hrA, U.fin, U.hrB, U.mgr]) await expect(insertObject(user, "receipts", own)).rejects.toThrow(/row-level security/);
      await db.seed(`insert into storage.objects (bucket_id, name) values ('receipts', '${own}')`);
      for (const user of [U.hrA, U.fin]) expect((await db.asUser(user, async (q) => (await q("select name from storage.objects where name = $1", [own])).rows))).toEqual([{ name: own }]);
      expect((await db.asUser(U.mgr, async (q) => (await q("select name from storage.objects where name = $1", [own])).rows))).toEqual([]);
      expect(await removeObject(U.hrA, "receipts", own)).toEqual([]);
      expect(await removeObject(U.emp, "receipts", own)).toEqual([{ name: own }]);
    });
  });
});
