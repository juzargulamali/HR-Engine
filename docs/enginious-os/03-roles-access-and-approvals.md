# 03. Roles, access and approvals

Who can do what in ENGINIOUS OS, how that is enforced, and how approvals are routed. Verified at `551f615` by reading code and migrations; nothing was run (no app, no database). Hosted state is owner-reported. Conventions: see `README.md` in this folder (`Unverified`, **Stale**, per-claim sources). Where a source says "the SQL" it means a file under `supabase/migrations/`.

## 1. How access is enforced

Access has five layers. Only the last three protect data; the first two shape what a person is offered.

| Layer | What it does | Source |
|---|---|---|
| Sign-in | Every route except `/login`, `/set-password`, `/forgot-password`, `/reset-password` and one cron route redirects a signed-out visitor to `/login`. `proxy.ts` asks the auth service (`getUser()`) on each request, not just a cookie | `apps/web/src/proxy.ts` |
| Profile and status | `profiles.account_status` and `profiles.is_active`. Deactivate bans the login through the Admin API first, then marks the profile; `is_active` is set in the same step (migration #3) and a person cannot change their own `is_active` | `apps/web/src/lib/actions/account-status.ts`; `20261216000300_account_deactivation_inactive_people.sql` |
| Navigation | Menu entries are built from roles and grants (`buildNavModules`). Hiding is cosmetic: "RLS and the page's own checks remain the real enforcement" | `apps/web/src/components/nav/nav-groups.ts` (header comment) |
| Page guards and server actions | Pages and actions re-check the role or grant and say "no access" or refuse. `getCurrentSession` reads roles and the linked employee; if the read fails it sets `loadFailed` with empty grants (nothing is opened up) and screens must say "could not load", never "no role" | `apps/web/src/lib/auth/session.ts` |
| RLS and `SECURITY DEFINER` functions | Row policies decide which rows load. Sales, Projects, Inventory and Budget tables have SELECT policies only (no insert, update or delete policy in the `crm_`, `proj_`, `inv_`, `pbx_` migrations, checked by grep at `28549dd`), so every write there goes through a function that re-checks the caller (`auth.uid()`). **HR-core tables are different: some writes are direct table operations by the signed-in user, held in by RLS policies, triggers and column privileges, not by a SECURITY DEFINER function.** Examples checked in the migrations: `reimbursement_claims` (policies `reimbursement_insert` only for the owner and status `draft`, `reimbursement_update_draft`, `reimbursement_update_cancel`, `reimbursement_delete_draft`; `20260927000000_phase4_reimbursements_projects_timesheets.sql`, `20261016000000_reimbursement_delete_draft.sql`) and `policy_versions` (insert and update policies plus trigger `guard_policy_version_update()`; `20260925000000_phase2_country_policy_engine.sql`, hardened in `20261014000000_third_audit_pass_authz_fixes.sql`). Functions use a fixed `search_path`; internal helpers are revoked from `public, anon, authenticated` (for example `user_is_active`) | `20261216000300_...sql` (revoke line); `docs/03-permission-matrix.md` sections 3.8, 3.9 |
| JARVIS pilot switch (assistant) | JARVIS is **never broader than the person's own permissions**: on every request the server checks the environment, the signed-in identity, the database pilot controls (global switch `jarvis_settings.enabled`, allowlist `jarvis_pilot_users`, write kill switch `writes_enabled`, optional `jarvis_pilot_companies`) through `jarvis_my_access()`, then the person's own module grant for the selected company (an active Sales grant), then the action's own existing rule and RLS, all through the person's own session (no service-role client). Default OFF; changed only by owner-run SQL. It has no tool for salaries, leave, payroll, other modules, configuration, credentials, permissions or deletion. Part 2 adds six more Sales actions with the same rule: each write runs the existing function under the person's own identity (update and status: owner or founder; Won, Lost, hold, reopen and handover are not offered). **Every write is also gated by a server-issued database proof verified inside the database** (a keyed MAC over person, company, action, target, version, expiry, confirmation id and the exact payload; the proof key is held by the database and unreadable by any API role, and **the proof is issued only inside the explicit confirmation request and never given to the browser**, which holds only a review token the database cannot accept; the register wrapper's duplicate acknowledgement is signed and checked in SQL; no key set = every write fails closed): a pilot person who calls a wrapper directly, with an invented confirmation or with the review token they hold, can only be refused and gets nothing written ([`modules/jarvis.md`](./modules/jarvis.md) section 6.1) | `apps/web/src/lib/jarvis/dispatcher.ts` (`authorize`), `supabase/migrations/20261223000100_jarvis_platform.sql`, [`modules/jarvis.md`](./modules/jarvis.md) section 5 |
| Column privileges | RLS cannot hide columns, so sensitive columns are protected by privilege. `profiles`: signed-in users may select only `id, email, full_name, locale, is_active, account_status, created_at, updated_at`; `status_reason`, `status_changed_by`, `status_changed_at` are readable only through `account_status_details()` (System Administrator). A new `profiles` column starts private; `select *` on `profiles` is refused | `20261216000400_profiles_status_columns_restricted.sql` |
| Service-role key | `SUPABASE_SERVICE_ROLE_KEY` is used in one file, `lib/supabase/admin.ts`, marked `import "server-only"` (a client import is a build error). It bypasses RLS and is for account provisioning, ban and unban, never a shortcut | `apps/web/src/lib/supabase/admin.ts` |
| Anonymous callers | Public `SECURITY DEFINER` functions added in the launch stack are revoked from `anon` (policy status, `inv_xshare_*`, `user_is_active`); `profiles` select is revoked from `anon` | `20261216000700_...sql`; `20261218000100_inv_cross_company_receiving.sql`; `20261216000400_...sql` |

Important behaviours:

* `has_role()` and the checks on the **caller** do not look at `is_active`; a banned person cannot sign in, but a session already open lasts until its token expires (see section 6). The module helpers (`inv_has_capability`, `pbx_has_capability`, `proj_user_eligible` and the others) **do** join `profiles.is_active`, so an inactive person holds no module right even with a live token. Source: `20261216000300_...sql` header; `20261201000000_inv_access_audit_settings.sql`; `20261210000000_pbx_access_audit_settings.sql`.
* Employees see roles only as the app reads them: `user_roles` is readable by its owner and the System Administrator (`user_roles_select_own`), writable by the System Administrator only (`user_roles_write_sysadmin`). Source: `20260922000000_phase0_foundations.sql`.
* A permission mirror exists in TypeScript (`packages/domain/src/permissions/*`) for screens. It states itself to be "a UI-affordance mirror, not the source of truth" (`packages/domain/src/permissions/core.ts`).

## 2. The role and grant model

Access comes from three independent places that never imply each other. Source: pre-release spec section 4.1.1 (`docs/launch-refinement/specification.md` on branch `docs/launch-refinement-spec`), consistent with the code read below.

| Source | Table | Given by | Notes |
|---|---|---|---|
| HR roles | `user_roles` (role, optional company, optional country, `revoked_at`) | System Administrator only | Enum `app_role`: `employee, line_manager, hr_admin, finance, ceo, sys_admin` (`20260922000000_phase0_foundations.sql`) plus `cto` (`20261017000000_add_cto_role.sql`) |
| Module grants | `crm_company_grants` (Sales), `proj_company_grants` (Projects), `inv_company_grants` (Inventory), `pbx_company_grants` (Budget): one active row per person per company, `capabilities text[]` | The module's founder or `manage_access` holder (rules below) | Always one company; module grants have no country or global form (`20261216000910_module_access_managers.sql` header). Empty list is "basic" access (Budget: no access at all) |
| Relationships | `employees.manager_id` chain, `employees.user_id`, project PM, member, team head, opportunity owner, budget preparer or submitter | The data itself | Evaluated at read time; no grant row. Spec section 4.1.4 |

### 2.1 HR roles and scope

| Role (screen label) | What it is | Source |
|---|---|---|
| `sys_admin` System Administrator | Accounts, HR roles, companies. No module access, no HR content. Can read every employee row | `docs/03-permission-matrix.md` 3.1, 3.6; spec 4.1.2 |
| `hr_admin` HR Admin | Employee master data, leave and attendance administration, letters, assets, alerts, HR audit log, People & Access job tab, policy drafts when not company-limited | spec 4.1.2; `docs/people-access-design.md` |
| `finance` (HR sense) | Compensation, loans, payroll export step 1, reimbursement approvals. It is **not** the Budget grant `finance` | spec 4.1.2, 4.1.1 rule 2 |
| `ceo`, `cto` | Complete mirror of each other: read access, `role:ceo` approval steps resolve to either, letter sign-off, payroll final step. Use `isCLevel()` in the app | `docs/03-permission-matrix.md` 3.7; `packages/domain/src/permissions/core.ts`; `20261018000000_cto_role_parity.sql` |
| `line_manager` (shown as Reporting Manager) | A flag, not the relationship. Report visibility comes from `employees.manager_id` (`is_manager_of`), not from this role. It drives the Approvals menu row | spec 4.1.2; `docs/people-access-design.md` (Wording) |
| `employee` | Read by no policy. "Employee" means the login is linked to an employee record (`employees.user_id`) | spec 4.1.1 rule 3 |

**Scopes (HR roles).** A grant has `company_id` and `country_code`, each optional.

| Scope | Stored as | Meaning |
|---|---|---|
| Global | both null | Every company, every country |
| Company | company set, country null | That company only |
| Country | country set, company null | Every company, but only that country's rules or employees |
| Company and country | both set | That company, that country |

`has_role(role, company, country)` matches a grant when its company is null or equals the one asked about, **and** its country is null or equals the one asked about. A caller that passes no company or country matches only grants with that field null. Source: `20260922000000_phase0_foundations.sql` (`has_role`); `packages/domain/src/permissions/core.ts` (`matchesScope`).

**Corrected country semantics (approval routing).** Before `20261216000810` the two routing lookups honoured the company limit but ignored the country limit, so a country-limited CEO was resolved as approver for every country. Now `resolve_approver(type, employee)` applies a country-limited grant only when it equals the **employee's** `country_code`, and `resolve_approver_for_company(type, company)` only when it equals the **company's** `country_code`. Grants without a country limit resolve as before; inactive, terminated and revoked holders are skipped; pending approvals are not re-routed. Source: `20261216000810_approval_routing_country_scope.sql`; `docs/launch-p1d-deployment.md` section 1. The People & Access screen assigns an HR role with a company or "all companies" only (`assignRole` in `apps/web/src/lib/actions/users.ts` sets no country), so a country-limited grant can only come from SQL. Whether any exists on V2 is `Unverified` (the preflight section D lists them).

### 2.2 Module grants: what exists

Capability lists, exactly as defined in the domain package and presets (`packages/domain/src/permissions/crm.ts`, `proj.ts`, `inv.ts`, `peopleAccess.ts`). `founder` implies every capability in Sales, Projects and Inventory (`inv_has_capability` tests `'founder' = any(...) or cap = any(...)`); Budget has no founder.

| Module | Capabilities | Presets (People & Access) |
|---|---|---|
| Sales | `founder, assign_owner, confirm_availability, manage_settings, manage_approval_rules, manage_access, view_audit, reopen_closed` | Basic Sales access, Sales lead, Availability confirmer, Sales administrator, Approval policy owner, Sales access manager, Sales founder |
| Projects | `founder, assign_pm, manage_access, approve_scope, view_commercial, view_audit, reopen_project, override_site_conflict`, and **`operations`** (Phase 2B; branch `claude/projects-phase-2b-operations`, not merged; migration `20270102000100` not applied by Claude; on hosted it is treated as applied from the owner's report of 2026-11-12 that the signed-in Preview checks of PR #86 passed, `Unverified` by Claude) | Directory only, Project coordinator, **Operations Manager** (Phase 2B), Scope approver, Commercial viewer, Audit reader, Projects access manager, Projects founder |
| Inventory | `founder, manage_access, manage_catalogue, warehouse, cross_location, view_stock, view_costs, view_audit, confirm_stock, request_for_employees, view_employee_custody` | Catalogue summary, Storekeeper, Stock lead (all locations), Stock viewer, Stock controller, Catalogue manager, Equipment requester, Custody reader, Audit reader, Cost reader, Inventory access manager, Inventory founder |
| Budget (project budgets and expenses) | `finance, view, executive_approver, manage_access` | Read only, Finance, CEO / CTO approver, Budget access manager |

**`operations` (Operations Manager), Phase 2B.** One Projects capability per company (`packages/domain/src/permissions/proj.ts`; `proj_capability_list` in `supabase/migrations/20270102000100_ops_phase2b.sql`). It opens the Operations screens for that company; it **implies `assign_pm`** (`proj_has_capability`, `hasProjCapability`), so its holder assigns and changes Project Managers on handovers, changes the Project Manager of a live project (a reason is now required of everyone, kept in the project's history, and the outgoing Project Manager is told: `proj_assign_pm(project, person, reason)`), reads the company's handovers, is told of a handover submitted without a Project Manager and reads staff names where an assigner does; **creating an internal project and changing a project's Sales links are not implied** and need `assign_pm` itself or founder (`proj_holds_assign_pm`, `holdsAssignPm`); it lets its holder **read that company's projects in full without being enrolled** (`proj_can_view_details`, `proj_can_view_summary`) while `proj_can_manage` stays founder, Project Manager and temporary leader: they can comment on a task, raise a correction and post in the project's conversation, under their own name; they cannot add a file or a link (that needs a place on the project or founder: triggers `trg_proj_files_contributor`, `trg_proj_upload_intents_contributor`), create, assign, move or review tasks, edit the Delivery Plan, decide corrections or changes, manage or complete the project, or see restricted files or the commercial record; and it is an explicit path into that company's project Chat groups (`chat_is_ops`). It gives no Sales, Finance, HR or Warehouse right, no restricted file and no commercial record of a scope change. **Given and taken away** on People & Access by a Projects founder or a holder of Projects `manage_access` (it is not founder-only), through the unchanged `proj_grant_access` / `proj_revoke_access`, audited by the existing trigger. **Revocation** takes effect on the next read (Operations reads refuse, project chats leave the list). The migration gives it to nobody. Detail: `modules/operations.md` section 2.

Meaning of the less obvious ones: `warehouse` operates stock **only at assigned locations** (`inv_operator_locations`) and reads stock; `cross_location` means all locations and matters only with `warehouse`; `inv_can_view_stock = warehouse or view_stock`; `confirm_stock` also lets the holder correct a movement; `view_costs` is its own table policy and only a founder can give it (`inv_costs_select` uses `view_costs`). Budget `manage_access` alone gives **no read**: reading needs `finance`, `view` or `executive_approver` (`pbx_can_view_company`). Sources: `docs/people-access-design.md` ("Capabilities checked against the code"); `20261201000100_inv_catalogue_stock_ledger.sql`; `20261210000000_pbx_access_audit_settings.sql`.

### 2.2a Working profiles on People & Access (PR #57, merged at `28549dd`; re-verified at `28549dd`, 2026-11-07)

The Module access screen offers named working profiles. A profile only saves capabilities that already exist; the single definition (id, label, description, exclusions, bundle, warehouse-scope rule) is `packages/domain/src/accessProfiles.ts`. Who may grant what (`evaluateGrant`) and the database grant functions are unchanged.

| Module | Profile | Saved capabilities | Notes |
|---|---|---|---|
| Inventory | Warehouse operator | `warehouse` | Scope "chosen warehouses", at least one required (`inv_can_operate`, `inv_operator_locations`) |
| Inventory | Warehouse operator — all locations | `warehouse`, `cross_location` | Scope "all locations", must be chosen explicitly; equals the older "Stock lead (all locations)" preset. No other right is added |
| Inventory | Stock viewer | `view_stock` | Read only |
| Inventory | Employee equipment viewer | `view_employee_custody` | |
| Sales | Sales colleague | none (basic) | Own opportunities and follow-ups; cannot assign owners or reopen |
| Sales | Sales lead | `assign_owner`, `reopen_closed` | |
| Sales (draft PR, not applied) | Events, editions, observations, outreach priority | **Any Sales grant** adds events, editions and observations and sets the shared outreach priority; the person who added an event, edition or observation (or a founder in any company) edits or **archives** it (nothing is deleted); **any Sales grant imports events and editions** into the shared calendar (the same right as adding them); an enquiry is linked to an edition only by its owner or a founder; the figures an edition shows are counted from the enquiries the viewer's own grants can read. See `modules/sales-events-and-exhibitions.md` | |
| Sales (draft PR, not applied) | Chat: Sales — UAE, Sales — KSA, Sales — Europe | **Automatic, no member list:** a person is in a group exactly when they hold an **active Sales & CRM grant for that company** (not revoked, active profile). All three companies means all three groups; company access alone (HR role, employee record, another module) grants nothing; removing the grant removes the group, its history and its unread at once. @mentions only name current members; a shared item shows its title only to readers whose own access allows it, otherwise "Restricted item". See `modules/app-chat.md` | |
| Project budgets | Read-only / Finance / Executive approver | `view` / `finance` / `executive_approver` | Approver right still only given or removed by a CEO / CTO approver (R1) |
| Projects | Project directory viewer | none (basic) | No company-wide PM, scope-approval or founder profile; PM assignment and team membership are managed on the project or handover |
| Projects (Phase 2B; branch `claude/projects-phase-2b-operations`, not merged) | Operations Manager | `operations` (exactly; the database treats it as `assign_pm` too, so the bundle does not repeat it) | Description shown: "Opens the Operations workspace for this company, assigns or changes Project Managers, reads this company's projects, comments on tasks, raises corrections and takes part in its project chats. Gives no Sales, Finance, HR or Warehouse rights, and does not manage tasks or deliveries or add files." The access summary does not list "assign a PM" under what it does not include (`summariseAccess`). It is not a PM profile: it names who the Project Manager is and does not make its holder one. In Advanced access it is the first entry of "Specialist operational rights". Source `packages/domain/src/accessProfiles.ts`, `peopleAccess.ts`; tests `accessProfiles.test.ts`, `peopleAccess.test.ts`, `module-access-panel.test.tsx` |

Rules: current access is recognised from actual capabilities (exact profile, profile plus listed extras, or "Custom access"), never from job title. Choosing a profile changes a draft only (`chooseProfile`, `reviewDraft` in `accessProfiles.ts`); switching replaces only the previous profile bundle, custom rights stay and are listed, removals need an explicit confirmation, one Save sends exactly the reviewed set (the stale-edit check is unchanged). "Advanced access" (collapsed) keeps every capability in four groups: Specialist operational rights; Sensitive visibility; Configuration; Access administration and founder powers. Inventory warehouse scope (all locations vs chosen warehouses) is always an explicit choice: a warehouse profile cannot be saved until the scope is chosen, "chosen warehouses" needs at least one warehouse, and moving to "all locations" clears the person's assigned warehouses (`reviewDraft`: `scopeMissing`, `locationsMissing`, `locationIdsToSave`). The review lists rights added and removed, custom rights kept, and warehouses added and removed; any removal (right or warehouse) needs explicit confirmation (`needsRemovalConfirm`). The editor is guarded: switching the "Access for company" selector or choosing another person with unsaved edits asks "Discard unsaved changes?" (`module-access-panel.tsx`, `unsaved-access-guard.tsx`). Unticking a right that belongs to the chosen profile leaves the standard profile and keeps the rest as custom rights (`toggleExtra`); the older specialist presets (Sales administrator, Stock controller, Catalogue manager and others) are reachable only through Advanced access. No migration.

### 2.3 How grants are given

| Topic | Rule | Source |
|---|---|---|
| Where | One screen, **People & Access** (`/people-access`). It adds no power: each action calls the same grant function as the old screens. Old addresses redirect (307) | `docs/people-access-design.md` |
| Who sees the menu entry | System Administrator, any HR Admin, or a `manage_access` holder in any module (`canUsePeopleAccess`) | `packages/domain/src/peopleAccess.ts`; `nav-groups.ts` |
| System Administrator | Gives HR roles and manages accounts. It cannot give module access unless it also holds that module's access right | `docs/people-access-design.md` decision 1 |
| Presets | A preset **adds** its capabilities; taking one away is an explicit untick. The save is refused if the person's access changed since the page loaded (grant functions replace the whole set) | `peopleAccess.ts` (`applyPreset`); design decision 3 |
| Founder-only rights | Sales and Projects: `founder`, `manage_access`. Inventory: those plus `view_costs`. Budget: none by founder; the approver right is protected by R1 | `peopleAccess.ts` (`founderOnlyCapabilities`) |
| Rule R1 (Budget) | Only a CEO / CTO approver of the company can give or remove `executive_approver`. The last eligible (active) approver cannot be removed. Budget grant changes are serialised per company | `20261215000000_access_grant_rules.sql`; `docs/people-access-grant-rules-deployment.md` |
| Rule R2 (Budget, Sales) | Nobody adds a right to their **own** access; removing their own right stays allowed | same |
| Rule R3 (Sales, Projects, Inventory) | A non-founder cannot withdraw another access manager (Inventory: or a cost reader); stepping down oneself stays allowed. In Sales a non-founder also cannot replace another access manager's rights | same |
| Last-holder guards | Last founder (Sales, Projects, Inventory) or last `manage_access` holder (Budget) cannot be revoked; a live Project Manager's Projects access cannot be withdrawn | design doc "Last access administrator"; `docs/03-permission-matrix.md` 3.8, 3.9 |
| Only eight functions write grant tables | `pbx_`, `crm_`, `proj_`, `inv_` `grant_access` and `revoke_access`; no trigger changes rights; tables are read-only for browsers | `docs/people-access-grant-rules-deployment.md` |
| Recovery (nobody eligible) | Owner-run SQL only: `crm_30_bootstrap_founders.sql`, `proj_30_bootstrap_founders.sql`, `inv_30_bootstrap_founders.sql`, `pbx_30_bootstrap_access.sql`. No in-app route and no automatic System Administrator route, by design | design doc; deployment doc |
| Name your access managers | A person denied a module sees who can grant it (`module_access_managers(module)`: names only, own company, active holders only) | `20261216000910_module_access_managers.sql` |

**Hosted state of R1 to R3.** `docs/people-access-deployment-order.md` records the migration as applied and verified on V2 on 2026-10-27 (owner-reported). **Stale:** `docs/people-access-grant-rules-deployment.md` still opens with "Nothing here has been run on any hosted project". Not re-checked by Claude.

**Inactive people.** Deactivation sets `is_active` false. Effects: no module right (helpers join `is_active`); skipped by `resolve_approver`, `resolve_approver_for_company`, `resolve_role_holders`, Recovery Leave routing and the role-queue check, so a **new** request goes to the next holder; not selectable as PM or approver; the last active System Administrator, the only CEO / CTO budget approver of a company and the only CEO or CTO of a company cannot be deactivated. Reactivation restores everything. The grant guards still count a deactivated person's grant, which is why recovery is owner-run SQL. Source: `20261216000300_...sql`; `docs/people-access-design.md`.

## 3. Capability matrix by role

Legend: **F** full for the scope stated, **R** read, **O** own records only, **A** approve or decide, **-** none. "Co." means the person's company (company scope); a global grant widens it. Rows come from `docs/03-permission-matrix.md` (written early; the CEO/CTO and some approval rows were re-checked, others are **per that doc**) and from the module tables. Hiding a menu entry is never the control; the database is.

### 3.1 People and HR roles

| Area | Me (ordinary employee, no role, no grant) | Reporting manager (by `manager_id`) | HR Admin (company) | Finance (HR role) | CEO / CTO | System Administrator |
|---|---|---|---|---|---|---|
| Own profile, leave, claims, letters, clock, My Day, My equipment | O (view; edit contact only; submit own leave, claims, clock) | O | O + F on all employees | O | O | No employee record needed; pages say none exists if unlinked |
| Employees list | One row: self (`employees_select`; not a directory) | Self and the reporting chain | F (Co.) | R (Co.) | R (Co.) | R (all companies; cannot edit) |
| Attendance and clock register | O | R (team) | F: register, corrections (Co.) | - | - | - |
| Leave requests and balances | O | R/A (team, step 1) | F, adjust ledger with reason (Co.) | R | R; A for executive exceptions | - |
| Recovery Leave credit | O: request, see own | Route depends on applicant (section 4) | Decides on HR queue (Co.) | - | Decides HR Admin applicants (shared CEO/CTO queue); CEO/CTO own credit auto-approved when nothing blocks it | - |
| Payroll export | - | - | R (Co.) | F: run, step 1 | R; A step 2 (mandatory, CEO or CTO) | - |
| Compensation and bank | O (own, read only) | - | F | F | Aggregate only | - |
| Letters | O: request; download **issued** letters only | - | F: templates, generate, issue (Co.) | - | A: sign-off (`role:ceo` step) | - |
| Policies | R active versions of own country | R active | Company-only grant: R active only, no drafts or buttons. Grant not limited to one company: drafts, edit, delete drafts. `canSeedPolicyDrafts`: needs AE, SA and PL unscoped by company | - | Read drafts, activate (not edit) | R active |
| Holidays | R | R | F only with an HR Admin grant not limited to one company (company-only: read) | R | R | R |
| Assets | O | R (team) | F | R | - | - |
| Alerts bell and page | - | - | R | - | R | - |
| HR audit log (`audit_log`, 11 tables with a company, timesheets added by `20261005000000_audit_timesheets.sql`) | - | - | R, own company | - | - | R only `companies` and `user_roles` rows |
| AI Suggestions queue | - | - | F (any scope) | - | - | R |
| Accounts, HR roles, companies | - | - | - | - | - | F (invite, deactivate, reset, roles, companies) |
| Job title, department, reporting manager (People & Access) | - | - | F (Co.), same-company checks, no circles | - | - | Read only |

Sources: `docs/03-permission-matrix.md` 3.1 to 3.6; policies note and `canSeedPolicyDrafts` in `packages/domain/src/permissions/policies.ts`; `20261216000700_policy_status_role_check.sql` (drafts visible only to `has_role('hr_admin'|'ceo'|'cto', null, country)`, that is a grant not limited to one company) and `docs/launch-p1c-deployment.md` section A16; `20260929000000_phase6_letters_payroll_audit_ai_drafts.sql` (audit policies); `20261216000800_letters_storage_issued_only.sql`; `docs/people-access-design.md`; `employees_select` per spec 4.2.2 note 4. CEO/CTO policy-table parity: `20260925000000_phase2_country_policy_engine.sql` names `ceo`, parity migration `20261018000000_cto_role_parity.sql`; the exact policy-table CTO branch is `Unverified`.

**Company-only HR Admin versus all-country HR.** An HR Admin granted for one company reads and administers that company's people, but cannot draft or activate policies, create the seed drafts or edit holidays, because a policy affects every company in a country and the draft rule is `has_role('hr_admin', null, country)`. An HR Admin whose grant is not limited to one company and covers all three countries (UAE, Saudi Arabia, Poland) can; `canSeedPolicyDrafts` requires all three because the draft functions loop over them. The page shows the buttons disabled with one sentence of explanation and the server actions refuse the same people. Sources: `packages/domain/src/permissions/policies.ts`; `docs/launch-p1d-deployment.md` ("Noted, not changed").

### 3.2 Modules with their own grants

An HR role, an employee record or an e-mail domain confers **no** module access, and a module grant confers no HR access. Sales, Projects, Inventory and Budget access are per company. Sources: `docs/03-permission-matrix.md` 3.8 and 3.9; capability descriptions in `peopleAccess.ts`.

| Module | Me (no grant) | Basic grant | Relationship rights | Delegated capability | Founder (per company) |
|---|---|---|---|---|---|
| Sales | - | Reads the company's opportunities, follow-ups, proposals; creates enquiries (becomes owner); edits own | Opportunity owner edits and moves own; assignee handles own follow-ups | `assign_owner`, `confirm_availability`, `manage_settings`, `manage_approval_rules` (policy only), `view_audit`, `reopen_closed`, `manage_access` (not founder or access rights) | Everything, including changing the value of a Won opportunity and commercial approval decisions |
| Projects | - | Directory of ongoing projects (summary); precondition to be named PM, member or team head | Member: details, tasks, discussion. Team head: own team's tasks. PM or acting PM: manage the project, its budget and equipment requests. Sales-linked: summary and handover status | `assign_pm`, `approve_scope`, `view_commercial` (cost effect of scope changes), `view_audit`, `reopen_project`, `override_site_conflict`, `manage_access`; **`operations`** (Phase 2B, branch not merged): the Operations screens, PM assignment, every project of the company read in full without enrolment, with task comments, corrections and the project's conversation (no files or links), the company's project chats; no managing, no internal project, no Sales links | Every project of the company, manage, delegate, decide scope, read commercial and audit |
| Inventory | Own equipment only (`My equipment`) | Catalogue summary (names, categories, usable counts) | PM of a live project: browse and request equipment for it; employee: own custody | `warehouse` (assigned locations), `cross_location`, `view_stock`, `confirm_stock`, `manage_catalogue`, `request_for_employees`, `view_employee_custody`, `view_audit`, `view_costs` (founder gives), `manage_access` | Operate every location of the company, costs, access |
| Budget and expenses | - | None (Budget has no basic read) | PM prepares and submits the project's budget; preparer or submitter never decides it | `finance`: reads all company budgets, decides PM-submitted budgets, funds, receipts, rates, close. `view`: read. `executive_approver`: decides what a Finance holder submitted. `manage_access` | No founder concept |
| People & Access | - | - | - | `manage_access` of any module: sees only those modules and companies | - |
| Audit trails | - | - | - | Sales `crm_audit_log`, Projects, Inventory via `view_audit`. Budget `pbx_audit_log` is readable by anyone who can read the company's budgets (`pbx_can_view_company`) | Founders |

Navigation hint for new readers: `02-screens-and-navigation.md` lists which routes each of these opens. **Stale:** spec section 4.2.2 (written at `76c121b`) shows a matrix without a separate "Me" group and says a deactivated person still counts as an eligible PM or approver; the current build has a "Me" group built only from the person's own pages (`nav-groups.ts`, `meLinks`) and migration #3 fixes the eligibility problem.

## 4. Approvals

### 4.1 Approval types and who decides

All routed through the `approvals` table and `decide_leave_approval()` / `decide_approval()` unless noted. Enum `approvable_entity`: `leave_request, reimbursement_claim, timesheet, generated_letter, onboarding_task, offboarding_task, payroll_export_run`, plus `recovery_credit`. Sources: `20260926000000_phase3_leave_and_approvals.sql`; `20261101000000_leave_policy_configuration.sql`.

| Approval | Default route | Resolved by | Notes and source |
|---|---|---|---|
| Leave request | `direct_manager` (workflow step 1, seeded per company) | `resolve_approver(type, employee)` | HR can add steps or conditions per company. `manager_of_manager` exists. A CEO or CTO's own leave is approved on submission (no approver). `20260926...`; `20261109000000_executive_requests_no_approver.sql` |
| Reimbursement claim | `direct_manager`; amount-conditional steps (`condition.amount_gt`) are configuration, not seeded | `resolve_approver` | A CEO or CTO's own claim goes to `role:finance`. **Stale:** `docs/03-permission-matrix.md` 3.3 states a fixed "manager up to a threshold, Finance above"; the code seeds a single manager step and supports a threshold only if HR configures one (`20260927000000_phase4_reimbursements_projects_timesheets.sql`) |
| Timesheet | `direct_manager` | `resolve_approver` | Same file |
| Generated letter | `role:ceo` step 1 | `resolve_approver`: CEO or CTO, oldest grant first | `20260929000000_phase6_...sql` |
| Payroll export run | Step 1 `role:finance`, step 2 `role:ceo` (mandatory, every export) | `resolve_approver_for_company(type, company)` | CTO satisfies step 2 alone. Same file; `docs/03-permission-matrix.md` 3.7 |
| Onboarding or offboarding task | Enum values exist; no seeded workflow found | | `Unverified` how these are used |
| Recovery Leave credit | Depends on the applicant tier (4.4) | `recovery_route_request`, not `resolve_approver` | `20261216000300_...sql` |
| Project budget (Budget module) | Submitter without Finance: Finance route. Submitter holding Finance: executive route | `pbx_approval_route`, `pbx_route_approvers`, `pbx_require_approver` | Section 4.5. `20261210000200_pbx_budget_functions.sql` |
| Scope change (Projects) | Anyone with `approve_scope` or founder in the project's company | `proj_decide_scope_change` | Section 4.6 |
| Commercial approval (Sales) | Founder, or `manage_approval_rules` for the policy only | Sales functions | `docs/03-permission-matrix.md` 3.8 |
| Policy activation | Not an `approvals` row: role check in the policy functions | `has_role` | HR drafts; activation needs a second HR Admin, CEO or CTO per the matrix doc; exact check `Unverified` here |

### 4.2 Routing functions and queue names

| Function | Input | Rule | Source |
|---|---|---|---|
| `resolve_approver(type, employee)` | employee id | `direct_manager`: the employee's manager if active and not terminated, else (no manager) the oldest active CEO or CTO in the company other than the requester. `manager_of_manager` likewise. `role:X`: oldest active holder of X; `role:ceo` means CEO or CTO. Country limit applied as in 2.1. Skips terminated, deleted, revoked and inactive people | `20261216000810_approval_routing_country_scope.sql` |
| `resolve_approver_for_company(type, company)` | company id | Same `role:*` rule, used for payroll runs | same |
| `create_initial_approval()` | entity | Picks the workflow, resolves the approver, refuses when none exists ("No approver could be resolved ... Contact HR Admin") or when the resolved approver is the requester | `20261216000300_...sql` |

Queue names on the Approvals page (Recovery Leave only; `approver_id` is null and `queue_roles` is set): **HR Admin** queue (route "Project lead, then HR Admin", "HR Admin (the employee leads their own work)", "HR Admin (permanent manager)") and **Shared CEO/CTO queue** (HR Admin applicant). A shared queue means any current holder of the role in the applicant's company may decide. There is no Finance queue in this table: Finance acts as the named `role:finance` approver (reimbursements by CEO or CTO, payroll step 1) or as the Budget Finance route. Sources: `apps/web/src/app/(app)/approvals/page.tsx` (route and queue labels); `apps/web/src/lib/recovery/labels.ts`.

### 4.3 Independence, inactive approvers, pending approvals

* **No self-approval.** `create_initial_approval` refuses when the resolved approver equals the requester; the budget decision refuses `auth.uid() = created_by or submitted_by`; RLS on `approvals` requires `approver_id = auth.uid()`; the queue check never offers an applicant their own request (`isQueueDecisionEligible`). Sources: `20261216000300_...sql`; `20261210000200_pbx_budget_functions.sql`; `apps/web/src/lib/approvals/pending.ts`; `docs/03-permission-matrix.md` 3.7.
* **Deactivated approvers.** New requests skip them and go to the next holder; a request with nobody left says so. **Approvals already pending on a deactivated person stay exactly as they are: nothing is re-routed automatically and there is no re-route action** (owner decision). Someone must act on it outside the screen; `Unverified` whether an HR or owner procedure for stuck items is written down. Source: `20261216000300_...sql` header; `docs/launch-p1c-deployment.md` section A12.
* **Last executives.** A company's only CEO / CTO, or only CEO / CTO budget approver, cannot be deactivated. Source: same.
* **Menu count.** The Approvals row appears for `line_manager, hr_admin, finance, ceo, cto` in any scope, or for anyone with something waiting on them (a project lead on a Recovery Leave step). Source: `nav-groups.ts`.

### 4.4 Recovery Leave routing and the decider inbox

`recovery_route_request(request)` (in `20261216000300_...sql`):

| Applicant | Route | Decider |
|---|---|---|
| CEO or CTO (own credit) | Auto-approved when `recovery_request_blocker` is null | Nobody; otherwise HR queue |
| Employee with a named project lead | `employee_lead_then_hr` | Step 1 the lead (must be active, not terminated, not the applicant), then HR Admin; if no HR Admin is available the request gets a routing issue |
| Self-led | `self_led_hr_direct` | HR Admin queue (independent review) |
| Has a permanent manager | `manager_hr_direct` | HR Admin queue |
| HR Admin | `hr_admin_ceo_cto_queue` | Shared CEO / CTO queue |

`recovery_decider_inbox()` returns every pending approval the **caller may decide right now** (a step assigned to them, or a pending queue step whose role they hold in the applicant's company), with only the card minimum: applicant name, company and country, work date, event type, amount, route, work mode, project name, named lead, routing note, window link. Never the applicant's own request, never a decided one, nothing for another company's holder. It exists so a project lead can see the applicant's name and a CEO / CTO can see an HR Admin's request, which the tables hide. The menu and Home count use the same function. If it is not installed the page says part could not be loaded. Sources: `20261216000600_recovery_decider_inbox.sql`; `apps/web/src/lib/approvals/pending.ts`.

### 4.5 Budget route (separate from the Approvals page)

Budget decisions do **not** use the `approvals` table or the `/approvals` page. They go through `pbx_inbox` and the `pbx_*` functions (`pbx_decide_budget`, `pbx_decide_actuals` and siblings) and are decided in the Finance inbox at `/finance/project-budgets` (`02-screens-and-navigation.md`); they reach My Day through `budgetCandidates` (`pbx_inbox`), sources `budgets` and `budget-projects` (`apps/web/src/lib/my-day/attention.ts`; see `04-flows-sales-to-warehouse-and-others.md` section 4). Do not look for a budget approval in `approvals`, and do not route one through `create_initial_approval`.


`pbx_approval_route(company, submitter)` returns `executive` if the submitter holds Budget `finance` in that company, else `finance`. Project Manager submits, so Finance decides; a Finance holder's own submission needs the company's CEO / CTO approver (`executive_approver`, an explicit grant; a title is not enough). The deciders list excludes everyone who prepared or submitted. Returns and rejections need a reason of three or more characters. A decision is final and once only. Additional requests, final expenses and closure follow the same split. Sources: `20261210000200_pbx_budget_functions.sql`; capability text in `peopleAccess.ts`. Hosted note: the owner holds `finance`, `executive_approver` and `manage_access` for Enginious LLC FZ and is the only eligible approver, so the approver right cannot be removed from them until a second is named (owner-reported, `docs/people-access-grant-rules-deployment.md`).

### 4.6 Scope-change approvers

`proj_decide_scope_change` authorises only `approve_scope` or founder in the project's company; membership is not required. People who hold it but are neither founder nor member cannot read the project tables, so migration #10 gives them a narrow page `/projects/scope-decisions/<id>` fed by `proj_scope_decisions_waiting()` and `proj_scope_decision_context(id)`.

| Sees | Does not see |
|---|---|
| Project reference and name, proposal title, **proposed** scope text, stated effect on dates, proposer's display name, status, whether it can still be decided; the Decide form (reason required) | Current scope, any other project field, members, tasks, budget, handover, files, discussion, the cost effect (`view_commercial` only), feedback, decision notes |

The proposer is never notified of their own proposal; the My Day row is the notice. Sources: `20261216000820_proj_scope_decision_context.sql`; `20261216000200_proj_scope_proposal_notifies_deciders.sql`; `docs/launch-p1d-deployment.md` section 2.

### 4.7 Mutable workflow records versus immutable ledgers

`approvals` rows are **mutable**: a decision updates `decision`, `decided_at` and `comments` once (`decide_leave_approval`; `20260926000000_phase3_leave_and_approvals.sql:293`); the `status` columns of requests, claims, handovers, transfers and budget versions also change by design. These are workflow state, not a ledger. Records verified as immutable are listed in `05-data-tests-and-release-ledger.md` section A.6 (inventory movements and movement lines, `inv_project_notes` and events by guard trigger; `leave_ledger` and `comp_day_ledger` by revoked privileges). `audit_log` is written only by trigger and has no write policy, but a guard trigger was not found: its immutability is `Unverified`.

## 5. Company isolation and data exposure

| Topic | Behaviour | Source |
|---|---|---|
| Company scope | HR roles and every module grant are tested against a company id. A company-scoped HR Admin gets nav links whose pages return only that company's rows. Module grant lookups never return another company's holders | spec 4.1.2; `20261216000910_module_access_managers.sql` |
| Cross-module separation | Sales never reads Projects data and vice versa; no `proj_` function reads HR tables or `employees.manager_id`. No Sales value, budget or payment term is copied into Projects | `docs/03-permission-matrix.md` 3.9 |
| Operations reads across modules (Phase 2B; branch `claude/projects-phase-2b-operations`, not merged; migration `20270102000100` not applied by Claude; on hosted it is treated as applied from the owner's report of 2026-11-12 that the signed-in Preview checks of PR #86 passed, `Unverified` by Claude) | Two allowlisted, company-checked reads. `ops_upcoming_work` returns named planning fields of **flagged** enquiries of the caller's Operations companies and never value, currency, budget note, payment terms, brief, scope, exclusions, risks, evidence, estimates, proposals, files or activity notes; an Operations Manager still cannot select one `crm_opportunities` row. `ops_overview` is for one company and refuses anyone who is not its Operations Manager or founder; another company's manager is refused. Sales reads Operations' planning row only for enquiries of companies it has Sales access to (`crm_ops_planning`, policy `ops_enquiry_planning_select`). `proj_projects_for_edition` and `proj_project_editions` return only projects the caller may already see | `supabase/migrations/20270102000100_ops_phase2b.sql`; `packages/rls-tests/test/ops-phase2b.rls.test.ts` (tests 1, 2, 4, 5); verify pack rows 7 and 14 |
| Shared contacts | `Unverified` current state: spec says Sales basic reads all organisations and contacts of every company (F-B-21); not re-checked | spec 4.1.3 |
| Inventory costs | `inv_costs` readable only with `view_costs` (founder implies it); not returned by any `inv_xshare_*` function | `inv_costs_select`; `docs/inventory-cross-company-receiving.md` |
| Hidden profile columns | `status_reason`, `status_changed_by`, `status_changed_at` unreadable except via `account_status_details()` (System Administrator); a column added later starts private | `20261216000400_...sql` |
| Letters storage | An employee reads a letter file only when a `generated_letters` row for that exact file has status `issued`. HR and CEO / CTO keep their read branches (the executive needs the file to decide) | `20261216000800_letters_storage_issued_only.sql` |
| Draft policy status | `preflight_phase2b_v2_policy_status()` returns rows only to people who may read that country's drafts; anonymous execute revoked | `20261216000700_...sql` |
| Anonymous | Nothing readable: table privilege on `profiles` revoked; `inv_xshare_*` and helper functions not executable by `anon`; only the public auth pages and one secret-protected cron route skip sign-in | `proxy.ts`; migrations above |

### 5.1 Cross-company inventory sharing

Sharing is `inv_company_sharing`, made by a founder of the **owning** company (`revoked_at is null`). `inv_check_sharing(owner, use)` refuses a dispatch otherwise. Receipt has **no** sharing check. Eleven functions (migration #15) let a warehouse operator of another company see the minimum needed to receive and trace. The six callable ones go to signed-in users only; the five helpers to nobody signed in. No table, column, policy or privilege changed, so a receiving operator still reads **zero rows** of the owner's base tables. Source: `docs/inventory-cross-company-receiving.md`; `20261218000100_inv_cross_company_receiving.sql`.

| Function | Returns to the receiving operator | Never returns |
|---|---|---|
| `inv_xshare_destinations()` | Warehouses of other companies the owner authorised (id, code, name, timezone, company, authorising owner) | Unauthorised companies' warehouses |
| `inv_xshare_units(location, code)` | For other companies' active units in transit to or on the shelf at a warehouse the caller operates: unit id, **barcode, serial**, item, category, condition, status, rented flag, **owner company**, place, bin (on shelf), transfer (in transit), usable here, **sharing revoked** | Cost, supplier, notes, photos, custody person, the owner's other units |
| `inv_xshare_counted_stock(location)` | Item, category, unit, condition, quantity, rented flag, status, owner, place, bin, transfer, sharing revoked | Cost; stock the receiver issued onward |
| `inv_xshare_transfers()` | Cross-company transfers the caller is party to: codes, status, companies, warehouses, times, carrier, reference, names of dispatcher and receiver, line counts, flag | Same-company transfers |
| `inv_xshare_transfer_trace(transfer)` | Header, units and counted lines the dispatch listed, dispatch and receipt events filed under either company | Anything for a stranger ("Transfer not found", same as non-existent) |
| `inv_xshare_availability(item, warehouse)` | Counts: physical at location, usable now, in transit, flag | Any other warehouse ("Location not found") |

Not returned by any of them: purchase or rental cost, supplier and rental supplier, notes, photos, employees, projects, requests, e-mail addresses, the owner's catalogue or stock counts, the owner's own movement history. An operator means `inv_can_operate` (founder of the warehouse's company, or an assigned `warehouse` holder, or `cross_location`); view-only, inactive, third-company and signed-out people get nothing.

**Sharing revoked.** New dispatch is refused; the Send form stops offering the revoked company's warehouses; a transfer already in transit stays visible (minimum fields) and **receivable**; equipment already on the receiver's shelf stays visible with `sharing_revoked` and `usable_here` false, so the screens say "Sharing revoked-contact owner"; the owner's own people never see that message; authorising again clears it. Source: same doc, "When the owner revokes sharing"; test `packages/rls-tests/test/inventory_cross_company_receiving.rls.test.ts` (line 280 case). Owner-reported: applied on V2 with 69 checks, 0 failing (`docs/launch-refinement-install-order.md` section 5).

## 6. Known limits recorded in the repo

| Limit | Detail | Source |
|---|---|---|
| `resolve_role_holders()` ignores country | Used to choose who is e-mailed about leave; a country-limited holder could be notified about another country's request. Notification only | `docs/launch-p1d-deployment.md` ("Noted, not changed") |
| Recovery Leave queue checks ignore country | The shared-queue decision check and the role-queue check in `create_initial_approval` compare company only; the web helper `isQueueDecisionEligible` matches `g.companyId` only. The SQL inbox calls `has_role(role, company)` without a country, which would not match a country-limited grant; how the two interact for such a grant is `Unverified` | `20261216000810_...sql` header ("shared-queue checks ... unchanged"); `apps/web/src/lib/approvals/pending.ts`; `20261216000600_...sql` |
| CEO sees the Recovery Leave card, not its step history | The card's "steps" evidence still reads `approvals` under the caller's own policy | `docs/launch-p1c-deployment.md` A15 "Not changed" |
| Open sessions last until token expiry | Sign-in is blocked by the ban; an access token already issued is still accepted by the data API until it expires. Row-level security still limits it to what that person could already do; module helpers already treat them as inactive. Real window length not measured (hosted step H4 not run) | `docs/people-access-account-controls-verification.md`; `20261216000300_...sql` header |
| Scope approver does not see current scope text | Owner decision left open: showing the "before" text to a non-member would reveal one more project field | `docs/launch-p1d-deployment.md` section 2 |
| Pending approvals are not re-routed | When an approver is deactivated, new requests skip them; existing ones stay assigned. No re-route action | `20261216000300_...sql` |
| Mid-transit revoke (as briefed) | The brief for this file said a mid-transit revoke hides the unit while receipt still works. **Stale:** the migration was corrected in place (commit `3b3cda1`): the receiver keeps the minimum view, with the revoked flag, and can receive | `docs/inventory-cross-company-receiving.md`; `git log` for `20261218000100_...sql` |
| Last access administrator | If the only eligible access manager is deactivated, the guard still counts their grant and nobody in the app can name another; owner-run SQL is the recovery | `docs/people-access-design.md` |
| System Administrator can grant itself HR roles | No second person is required; reported, not redesigned | spec 4.1.2 (F-G-03); `Unverified` for the current state |
| Acting PM and team head invisible to the menu | Navigation `managesProjects` reads `pm_user_id` only; rights still work through the database | spec 4.1.4; `nav-groups.ts`; `Unverified` after the later nav changes |
| R1 to R3 hosted proof | Hosted verify scripts read definitions only; rule behaviour is proved by repository tests, not hosted | `docs/people-access-grant-rules-deployment.md` |

## 7. Stale statements found while writing this file

| Where | Statement | Reality |
|---|---|---|
| `docs/03-permission-matrix.md` 3.3 | Claims over a threshold go to Finance | Default workflow is one manager step; threshold only if configured |
| `docs/03-permission-matrix.md` 3.6 | Sys Admin "F" on managing roles / user access | Still true for HR roles; module access is not included (`docs/people-access-design.md` decision 1) |
| `docs/people-access-grant-rules-deployment.md` | "Nothing here has been run on any hosted project" | Owner-reported applied on V2 (`docs/people-access-deployment-order.md`) |
| Spec section 4.1.6 | Deactivation does not set `is_active` | Fixed by migration #3 |
| Spec section 4.2.2 | Navigation levels for 17 personas | Written at `76c121b`; the "Me" group and later nav changes make parts stale. Use `02-screens-and-navigation.md` |
| Brief for this file | Mid-transit revoke hides the unit | Visible with a flag (section 6) |

Next: `04-flows-sales-to-warehouse-and-others.md`.
