import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { addNumberedClaimLine, type ClaimLineStore } from "../../domain/src/claimLines";

// Claim line numbering (A5 / D-05). The application adds a line as "highest line_no + 1, retry on a unique conflict".
// Here that exact algorithm (the same function the server action calls) runs against a real Postgres with real,
// separate connections, each attempt its own committed transaction as the employee, the way PostgREST runs a request.

const CO = randomUUID();
const U = { owner: randomUUID(), other: randomUUID() };
const E = { owner: randomUUID(), other: randomUUID() };

describe("Reimbursement claim line numbering under concurrent adds", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into auth.users (id, email) values ('${U.owner}', 'owner@claim-lines.test'), ('${U.other}', 'other@claim-lines.test');
      insert into countries (code, name, default_currency) values ('ZZ', 'Zedland', 'ZZD');
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO}', 'Claim Lines Co', 'ZZ', 'ZZD');
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${E.owner}', '${U.owner}', 'CL-01', '${CO}', 'ZZ', 'Olga', 'Owner', '2024-01-01'),
        ('${E.other}', '${U.other}', 'CL-02', '${CO}', 'ZZ', 'Omar', 'Other', '2024-01-01');
    `);
  });
  afterAll(async () => db.teardown());

  async function newClaim(): Promise<string> {
    const rows = await db.asUserCommit(U.owner, async (q) =>
      (await q("insert into reimbursement_claims (employee_id, currency) values ($1, 'ZZD') returning id", [E.owner])).rows);
    return rows[0].id as string;
  }
  const lineInsert = "insert into reimbursement_claim_lines (claim_id, line_no, expense_date, category, amount) values ($1, $2, '2026-11-01', 'travel', 10)";

  const storeFor = (user: string, claim: string): ClaimLineStore & { attempts: { count: number } } => {
    const attempts = { count: 0 };
    return {
      attempts,
      async highestLineNo() {
        const rows = await db.asUser(user, async (q) => (await q("select max(line_no) m from reimbursement_claim_lines where claim_id = $1", [claim])).rows);
        return { value: rows[0].m === null ? null : Number(rows[0].m), error: null };
      },
      async insertLine(lineNo) {
        attempts.count++;
        try {
          await db.asUserCommit(user, (q) => q(lineInsert, [claim, lineNo]));
          return { error: null };
        } catch (e) {
          const err = e as { code?: string; message: string };
          return { error: { code: err.code, message: err.message } };
        }
      },
    };
  };
  const numbers = async (claim: string) =>
    (await db.seed(`select line_no from reimbursement_claim_lines where claim_id = '${claim}' order by line_no`)).rows.map((r) => Number(r.line_no));

  it("reproduces the defect: head-count numbering collides after a delete (the old behaviour)", async () => {
    const claim = await newClaim();
    for (const n of [1, 2, 3]) await db.asUserCommit(U.owner, (q) => q(lineInsert, [claim, n]));
    await db.asUserCommit(U.owner, (q) => q("delete from reimbursement_claim_lines where claim_id = $1 and line_no = 1", [claim]));
    const headCount = Number((await db.seed(`select count(*) c from reimbursement_claim_lines where claim_id = '${claim}'`)).rows[0].c) + 1;
    await expect(db.asUserCommit(U.owner, (q) => q(lineInsert, [claim, headCount]))).rejects.toThrow(/duplicate key|unique/i);
  });

  it("delete line 1 of 3, then add: saved as line 4", async () => {
    const claim = await newClaim();
    for (const n of [1, 2, 3]) await db.asUserCommit(U.owner, (q) => q(lineInsert, [claim, n]));
    await db.asUserCommit(U.owner, (q) => q("delete from reimbursement_claim_lines where claim_id = $1 and line_no = 1", [claim]));
    expect(await addNumberedClaimLine(storeFor(U.owner, claim))).toMatchObject({ ok: true, lineNo: 4 });
    expect(await numbers(claim)).toEqual([2, 3, 4]);
  });

  it("two simultaneous adds both succeed with distinct numbers and no database error", async () => {
    for (let round = 0; round < 5; round++) {
      const claim = await newClaim();
      for (const n of [1, 2, 3]) await db.asUserCommit(U.owner, (q) => q(lineInsert, [claim, n]));
      await db.asUserCommit(U.owner, (q) => q("delete from reimbursement_claim_lines where claim_id = $1 and line_no = 1", [claim]));
      const results = await Promise.all([addNumberedClaimLine(storeFor(U.owner, claim)), addNumberedClaimLine(storeFor(U.owner, claim))]);
      expect(results.every((r) => r.ok)).toBe(true);
      const got = results.map((r) => (r.ok ? r.lineNo : -1)).sort();
      expect(new Set(got).size).toBe(2);
      expect(await numbers(claim)).toEqual([2, 3, 4, 5]);
    }
  });

  it("six simultaneous adds on an empty claim all succeed with numbers 1..6", async () => {
    const claim = await newClaim();
    const results = await Promise.all(Array.from({ length: 6 }, () => addNumberedClaimLine(storeFor(U.owner, claim))));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await numbers(claim)).toEqual([1, 2, 3, 4, 5, 6]);
    // the claim total follows the lines (trigger unchanged)
    expect(Number((await db.seed(`select total_amount t from reimbursement_claims where id = '${claim}'`)).rows[0].t)).toBe(60);
  });

  it("a real error is returned at once and unchanged in meaning: another employee cannot add to my claim", async () => {
    const claim = await newClaim();
    const store = storeFor(U.other, claim);
    const r = await addNumberedClaimLine(store);
    expect(r).toMatchObject({ ok: false, reason: "error" });
    expect(store.attempts.count).toBe(1);
    expect(await numbers(claim)).toEqual([]);
  });

  it("lines can still be added only while the claim is a draft (RLS unchanged)", async () => {
    const claim = await newClaim();
    await db.seed(`update reimbursement_claims set status = 'cancelled' where id = '${claim}'`);
    const r = await addNumberedClaimLine(storeFor(U.owner, claim));
    expect(r).toMatchObject({ ok: false, reason: "error" });
  });
});
