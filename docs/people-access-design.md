# People & Access: design and what changed

One screen, **People → People & Access** (`/people-access`), replaces five scattered ones. It gathers where access is managed. **It adds no power of its own and
changes no permission**: every action calls the same database function, under the same rule, that the old screen called. Anything that would change a security
rule is kept apart in [people-access-security-proposal.md](./people-access-security-proposal.md) and is **not** implemented.

## What it replaces

| Old screen | Now | Who (unchanged) |
|---|---|---|
| Admin → Users & roles (invite, resend, deactivate, delete, give and revoke HR roles) | tabs **Account** and **HR roles** | System Administrator only |
| Sales → Access | tab **Module access** | Sales founder, or holder of Sales `manage_access` |
| Projects → Access | tab **Module access** | Projects founder, or holder of Projects `manage_access` |
| Inventory → Access | tab **Module access** | Inventory founder, or holder of Inventory `manage_access` |
| Budget access (no screen; owner SQL only) | tab **Module access** | holder of Budget `manage_access` |
| Job title, department, reporting line on the employee record | tab **Job & department** | HR Admin of the employee's company |

Company-level settings that lived on two of those screens are **not access for a person**, so they were not dropped: the Projects reference code and the Inventory
equipment sharing between companies moved to **People & Access → Company settings**, shown to the same viewers (access managers read, founders change).

Old addresses (`/admin/users`, `/sales/access`, `/projects/access`, `/inventory/access`) redirect (temporary, 307) to `/people-access`. The four old menu entries are
gone; one **People & Access** entry appears for anyone who can manage something in it (System Administrator, HR Admin, or an access manager of any module).

## Decisions applied

1. **System Administrator power is not expanded (option A).** It manages accounts and HR roles, as today. It cannot grant module access unless it also holds a module's access-management right.
2. **Job and department are edited here, on the existing record.** No second copy of personnel data. `updateJobDetails` writes only `job_title`, `department_id` and `manager_id` of the existing employee row, under `employees_update_hr` (HR Admin of the company) and the audit trigger the table already has. It checks that the department and manager belong to the same company, that nobody is their own manager, and that the change does not create a reporting circle. (`updateEmployee`, the employee-form action, is not reused for this because it rewrites status, date of birth and other fields from one form.) A System Administrator can read the job but not edit it.
3. **Presets are simple and preserve what the person has.** A preset *adds* its capabilities to the current set; taking something away is an explicit untick under *Choose rights one by one*. Before saving, the screen shows what the change adds and removes. Because the database grant functions **replace** the whole capability set, a stale form could silently drop a right given in the meantime, so the save is refused (in words) if the person's access changed since the page was loaded.
4. **Self-grant and approval-bypass findings** are investigated and kept separate (see the proposal). Nothing about them is changed here.
5. **No automatic admin bootstrap and no new delegation hierarchy.** The first access manager of a company is still named by the owner-run SQL.
6. **The last-access-administrator protections are untouched** and the screen explains them before the database refuses.
7. **HR roles stay with the System Administrator; people and information are limited to what the viewer is entitled to see** (section "Who sees what").
8. **Old account/role and Access navigation removed, old URLs redirect.**

## Who sees what

Everything loads through the same row-level security the old screens used. What a viewer is not entitled to simply never loads.

| Viewer | People listed | Addresses | Tabs for a person |
|---|---|---|---|
| System Administrator | every account (the Users list) and employees | yes (as the Users list showed) | Account, Job & department (read-only), HR roles; **Module access only where they also manage that module** |
| HR Admin | employees they look after (names, job titles) | no | Job & department (editable for their company) |
| Module access manager | the module's staff directory (names; addresses only to founders, exactly as the old pickers) and current holders | founders only | Module access, only for the (module, company) pairs they manage |
| Budget access manager | active staff names | no | Module access (Budget) |
| Anyone else | nothing: the page says there is nothing to manage and the menu has no entry | | |

HR roles are never loaded for anyone but a System Administrator (the HR-role query is not even made). Module grants are read only for the companies the viewer manages.

## Capabilities checked against the code

Every capability in every preset was traced to the SQL that enforces it. "Enforced by" names the migration (all under `supabase/migrations/`).

**Sales & CRM** (`20261115*`): `assign_owner` (assign/reassign owners; workflow functions), `confirm_availability` (record availability; proposals file), `manage_settings` (`crm_upsert_settings`), `manage_approval_rules` (changing the approval policy inside `crm_upsert_settings`), `view_audit` (audit-log read policy), `reopen_closed` (reopening a won/lost opportunity), `manage_access` (grant/revoke), `founder` (implies all).

**Projects** (`20261120*`): `assign_pm` (handover PM, internal projects, link/unlink Sales), `approve_scope` (deciding a scope change), `view_commercial` (cost effect of a scope change, read policy), `view_audit` (audit-log read policy), `reopen_project`, `override_site_conflict`, `manage_access`, `founder`.

**Inventory** (`20261201*`): `warehouse` (operate stock **only at assigned locations**, `inv_operator_locations`; also reads stock: `inv_can_view_stock = warehouse or view_stock`), `cross_location` (all locations; meaningful only with `warehouse`), `view_stock` (read-only), `confirm_stock` (confirm counts and opening stock **and correct movements**), `manage_catalogue`, `request_for_employees`, `view_employee_custody`, `view_audit`, `view_costs` (own table, founder-only to grant), `manage_access`, `founder`.

**Budget** (`20261210*`): `finance`, `executive_approver`, `view`, `manage_access` (see the Budget design document).

Two things this check surfaced, both about presentation and not permissions:

* **`warehouse` needs locations.** A Storekeeper with no location cannot operate stock anywhere. The screen keeps the Inventory location checklist (it appears as soon as a warehouse right is chosen without "all locations" or founder) and says so.
* **`confirm_stock` is broader than its old label** ("Confirm stock counts"): it also lets the holder correct a movement. The preset is named *Stock controller* and says so; it is not part of Storekeeper.

Presets are defined once in `packages/domain/src/peopleAccess.ts`; a unit test proves every preset capability is in its module's vocabulary and that every capability is reachable from some preset.

## Last access administrator

The grant functions refuse to remove or demote the last holder (Projects, Inventory and Sales: the last **founder**; Budget: the last **`manage_access`** holder). The screen shows the same warning before the click, and shows the database's own refusal in words if it still happens.

**Recovery when nobody eligible remains** (for example the only access manager's login is deactivated; the guard still counts that grant, and an inactive person cannot act): the project owner runs the module's owner-run script in the Supabase SQL Editor, which acts as the database owner and needs no in-app permission: `crm_30_bootstrap_founders.sql`, `proj_30_bootstrap_founders.sql`, `inv_30_bootstrap_founders.sql` or `pbx_30_bootstrap_access.sql`. Each is idempotent, refuses placeholders and unknown or inactive users, and reports what it did. `people_access_findings.rls.test.ts` runs this recovery against a throwaway database. There is deliberately no in-app way to do this.

## Verification

* Domain: presets, who-may-give-what, diff, preservation, who sees what (`test/peopleAccess.test.ts`).
* Web unit: server actions (`peopleAccess.test.ts`: right function per module, unknown rights refused, stale form stopped, locations, job validation, no false success), loader entitlements (`lib/people-access/data.test.ts`: what each viewer does and does not query), module access card (presets preserve, founder-only options disabled, last-manager warnings, locations, remove asks first), navigation.
* Database: `packages/rls-tests/test/people_access_findings.rls.test.ts` records today's grant authority (no rule changed) including the findings.
* Browser (local stack): `os-shell-checks/people-access-flow.mjs` (46 steps). It covers, among much else: job title, department and reporting manager edited together and separately and cleared (the employee record and its audit row checked in the database); a direct and a longer reporting circle refused; forged requests naming a department or manager of another company, or the person themselves, refused; an over-long title refused; edits refused for the System Administrator, for the person's own reporting manager, for the employee themselves and for an HR Admin of another company, in the page and through the data service; and every old management address (`/admin/users`, `/sales/access`, `/projects/access`, `/inventory/access`, with a trailing slash or a query string) redirecting temporarily to People & Access, signed out and signed in, for each kind of person, with each person still offered exactly the management they had before.
* The local test setup now has fictional departments (Production Studio and Field Operations in the UAE company, Warsaw Workshop in the Poland company): `packages/e2e-tests/local-stack/seed.sql`.

## Wording

The HR role stored as `line_manager` is shown as **Reporting Manager** everywhere in the interface, and the job field is **Reporting manager**. Only the label changed; the stored value, the permissions and the approval routing are unchanged.

## Not tested here (invitation and authentication flows)

The local stack has no authentication admin service, so these were **not exercised**, before or after this change. The Playwright suites that cover most of them were moved to the new screen and typecheck, but need a hosted-style test project and were **not run**:

* Inviting a person (`inviteUser`, the invitation e-mail) and resending an invitation.
* Opening an invitation link and setting a first password.
* Deactivating and reactivating an account (the sign-in ban), and the check that an already signed-in session is cut off.
* An administrator sending a password reset, and the reset link itself.
* Deleting an account.
* The account-status consistency check.
* `e2e-account-security` and `e2e-tests` specs against a real project: `account-deactivation-reactivation`, `existing-session-blocked-on-deactivation`, `admin-password-invite-actions`, `admin-account-controls-visibility`, `deactivate-requires-confirmation-and-reason`, `50-account-status`, and the specs that read names and statuses through `src/identity.ts`.

What the browser flow does confirm for these: the controls appear only for the System Administrator, only under the person's Account tab, and the Invite panel is present.
