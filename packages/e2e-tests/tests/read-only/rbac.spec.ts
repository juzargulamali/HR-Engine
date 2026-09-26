import { test, expect } from "../../src/fixtures";
import { expectRoleAllowed, expectRoleDenied, expectRouteRenders, ROLE_DENIED_ALERT, ROUTES } from "../../src/pages/Nav";
import { hasCredentials, type Role } from "../../src/config";

/**
 * Full RBAC matrix: all 6 roles this suite can authenticate as, against
 * every top-level protected route, via DIRECT URL navigation (not nav-link
 * visibility — a hidden link proves nothing about server-side
 * enforcement). Grounded in a direct reading of every
 * apps/web/src/app/(app)/*\/page.tsx this suite's page objects were built
 * against (see src/pages/Nav.ts's doc comments): this app has exactly six
 * routes with an explicit, denyable role gate (ROLE_DENIED_ALERT) — every
 * other route either has no role gate at all or silently scopes its content
 * by role instead of denying, and for THOSE routes the only thing every
 * role in common can be asserted on is "renders real content, doesn't
 * crash" (which page-specific specs elsewhere assert more precisely for
 * the rows/buttons that differ per role).
 *
 * finance/sysAdmin cases skip cleanly if no dedicated test account is
 * configured for that optional role — never fabricated.
 *
 * Genuine cross-company/cross-tenant isolation (a role that IS permitted a
 * route but scoped to the wrong company) is not re-derived here — see
 * tests/read-only/isolation.spec.ts's reported limitation: all configured
 * test accounts belong to one company.
 */
type GatedRoute = "/policies/new" | "/audit-log" | "/payroll" | "/assets" | "/ai-suggestions" | "/alerts";
const GATED_ROUTES = Object.keys(ROLE_DENIED_ALERT) as GatedRoute[];
const UNGATED_ROUTES = ROUTES.filter((r) => !(r in ROLE_DENIED_ALERT));

/** Expected outcome for each (role, gated route) pair, read directly off
 * ROLE_DENIED_ALERT's own alert text (e.g. "restricted to hr admin and
 * finance") rather than re-guessed here. */
const ALLOWED: Record<GatedRoute, Role[]> = {
  "/policies/new": ["hrAdmin"],
  "/audit-log": ["hrAdmin", "sysAdmin"],
  "/payroll": ["hrAdmin", "finance", "ceo"],
  "/assets": ["hrAdmin", "finance"],
  "/ai-suggestions": ["hrAdmin", "sysAdmin"],
  "/alerts": ["hrAdmin", "ceo"],
};

const ALL_TESTABLE_ROLES: Role[] = ["employee", "manager", "hrAdmin", "ceo", "finance", "sysAdmin"];

test.describe("full RBAC matrix", () => {
  for (const route of GATED_ROUTES) {
    for (const role of ALL_TESTABLE_ROLES) {
      const shouldAllow = ALLOWED[route].includes(role);
      test(`${route}: ${role} is ${shouldAllow ? "allowed" : "denied"}`, async ({ employeePage, managerPage, hrAdminPage, ceoPage, financePage, sysAdminPage }) => {
        test.skip(!hasCredentials(role), `No test account configured for role "${role}".`);
        const pageByRole: Record<Role, typeof employeePage> = {
          employee: employeePage,
          manager: managerPage,
          hrAdmin: hrAdminPage,
          ceo: ceoPage,
          finance: financePage,
          sysAdmin: sysAdminPage,
        };
        const page = pageByRole[role];
        if (shouldAllow) {
          await expectRoleAllowed(page, route);
        } else {
          await expectRoleDenied(page, route);
        }
      });
    }
  }

  for (const route of UNGATED_ROUTES) {
    test(`${route}: renders for every configured role (no role gate — data-scoped, not access-denied)`, async ({ employeePage, managerPage, hrAdminPage, ceoPage, financePage, sysAdminPage }) => {
      const pageByRole: Record<Role, typeof employeePage> = {
        employee: employeePage,
        manager: managerPage,
        hrAdmin: hrAdminPage,
        ceo: ceoPage,
        finance: financePage,
        sysAdmin: sysAdminPage,
      };
      for (const role of ALL_TESTABLE_ROLES) {
        if (!hasCredentials(role)) continue;
        await expectRouteRenders(pageByRole[role], route);
      }
    });
  }

  test("routes with no role gate render for a plain employee (identity-scoped, not role-denied) — quick sanity check", async ({ employeePage }) => {
    for (const route of ["/leave", "/leave/new", "/reimbursements", "/performance", "/timesheets", "/approvals"]) {
      await expectRouteRenders(employeePage, route);
    }
    expect(UNGATED_ROUTES).toEqual(expect.arrayContaining(["/leave", "/leave/new", "/reimbursements", "/performance", "/timesheets", "/approvals"]));
  });
});
