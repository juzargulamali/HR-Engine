import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Covers the 20260930000000_link_employee_to_user.sql migration: the
// partial unique index on employees.user_id, and that HR Admin (not a
// plain employee) is the one who can set it — mirroring what
// linkEmployeeToUser() in apps/web actually does.

const COMPANY = "00000000-0000-0000-0000-000000000ea1";

const USER_HR = "00000000-0000-0000-0000-000000000eb1";
const USER_UNLINKED_LOGIN = "00000000-0000-0000-0000-000000000eb2";
const USER_PEER = "00000000-0000-0000-0000-000000000eb3";

const EMPLOYEE_NO_LOGIN = "00000000-0000-0000-0000-000000000ec1";
const EMPLOYEE_PEER = "00000000-0000-0000-0000-000000000ec2";

describe("employees.user_id linking", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();

    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_HR}', 'link-hr@enginious.ae'),
        ('${USER_UNLINKED_LOGIN}', 'link-newhire@enginious.ae'),
        ('${USER_PEER}', 'link-peer@enginious.ae');

      insert into countries (code, name, default_currency) values ('ZZ', 'Zedland', 'ZZD');
      insert into companies (id, legal_name, country_code, default_currency)
        values ('${COMPANY}', 'Link Co', 'ZZ', 'ZZD');

      -- Created with no login yet, exactly like a real onboarding: HR
      -- creates the personnel record first, invites the login separately.
      insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_NO_LOGIN}', 'LNK-01', '${COMPANY}', 'ZZ', 'New', 'Hire', '2024-01-01');
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_PEER}', '${USER_PEER}', 'LNK-02', '${COMPANY}', 'ZZ', 'Peer', 'Person', '2024-01-01');

      insert into user_roles (user_id, role, company_id) values ('${USER_HR}', 'hr_admin', '${COMPANY}');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  it("lets HR Admin link a not-yet-connected employee to an invited login", async () => {
    const { rowCount } = await db.asUser(USER_HR, (query) =>
      query("update employees set user_id = $1 where id = $2", [USER_UNLINKED_LOGIN, EMPLOYEE_NO_LOGIN]),
    );
    expect(rowCount).toBe(1);
  });

  it("blocks linking a login that's already attached to a different employee (unique index)", async () => {
    await expect(
      db.asUser(USER_HR, (query) =>
        // USER_PEER is already linked to EMPLOYEE_PEER — attaching them to
        // a second employee row would make current_employee_id() ambiguous.
        query("update employees set user_id = $1 where id = $2", [USER_PEER, EMPLOYEE_NO_LOGIN]),
      ),
    ).rejects.toThrow(/employees_user_id_unique|duplicate key/);
  });

  it("lets HR Admin unlink an employee (set user_id back to null)", async () => {
    const linkThenUnlink = await db.asUser(USER_HR, async (query) => {
      await query("update employees set user_id = $1 where id = $2", [USER_UNLINKED_LOGIN, EMPLOYEE_NO_LOGIN]);
      return query("update employees set user_id = null where id = $1 returning user_id", [EMPLOYEE_NO_LOGIN]);
    });
    expect(linkThenUnlink.rows[0].user_id).toBeNull();
  });

  it("blocks a plain employee (no hr_admin grant) from linking anyone's account", async () => {
    const { rowCount } = await db.asUser(USER_PEER, (query) =>
      query("update employees set user_id = $1 where id = $2", [USER_UNLINKED_LOGIN, EMPLOYEE_NO_LOGIN]),
    );
    expect(rowCount).toBe(0);
  });
});
