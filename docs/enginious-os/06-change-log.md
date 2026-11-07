# 06. Change log

Reverse-chronological ledger of significant merged changes to ENGINIOUS OS (`main`), built from `git log --merges --first-parent origin/main` and the merge and squash commit messages, verified at `551f615` on 2026-11-04. Nothing here is taken from memory: where git history says only a title, only the title is given. Pull-request numbers not listed here have no merge commit on the first-parent history of `main` (Unverified why; they may be closed, squashed elsewhere or numbered for issues).

How to read an entry: `date | PR | merge SHA | what changed | migrations`. Migration file names are in `supabase/migrations/`; their purposes, install order and hosted status are in `05-data-tests-and-release-ledger.md`. A squash commit (no merge commit) is marked "squash".

Maintenance rule (from `README.md`): any change to behaviour, access, navigation, a flow, a migration or the tests adds an entry here in the same pull request.

## Launch-refinement release (owner-reported hosted state: migrations 1 to 15 applied and verified on V2)

### 2026-11-07 | Clients & Agencies, in draft PR | branch `feat/clients-agencies` (not merged)
* Summary: new Sales tab "Clients & Agencies" (`/sales/accounts`, `/sales/accounts/[id]`): editable directory with role (several roles on one organisation record), country, account owner (incl. Unassigned), lead source and exhibition filters; account page with direct versus through-agency work, won inquiries apart from completed projects, quotes ("Awaiting reply" only where recorded data supports it), follow-ups and last activity; account owner and follow-up assignee are separate. Shared server-side helpers for the Part 2 Excel import. Part 2 (same PR): Excel import with template download and a guided Upload, Preview, Confirm, Result flow (new, existing matches, empty-field fills, conflicts never overwritten, ambiguous matches not merged, safe reruns, owner e-mail verified or left Unassigned), and Excel export of filtered or all accounts with a read-only Summary sheet the import ignores. New dependency `exceljs` (apps/web). No migration in part 2 (the later corrections below changed the one migration in place).
* Migrations: `20261219000100_crm_clients_agencies` (additive: columns `roles`, `country_code`, `website`, `website_domain` on `crm_organisations`; table `crm_account_profiles`; six functions; `crm_create_organisation` re-defined with the same signature). Owner pack `supabase/manual-sql/crm_accounts_*`; not applied to any hosted project.
* Access: no access widened; account owner confers no right (`modules/sales-clients-and-agencies.md` section 5).
* Tests: `packages/rls-tests/test/crm-clients-agencies.rls.test.ts`, `apps/web/src/lib/crm/clients-agencies/*.test.ts`, `apps/web/src/lib/actions/clients-agencies.test.ts`, `nav-groups.test.ts`.
* Corrections added to the same PR (migration `20261219000100` corrected in place; still not applied to any hosted project; one owner pack): (1) import safety moved into the database (`crm_import_fingerprints`, `crm_import_apply`, table `crm_import_batches`, locks per normalised name and website domain, fill-only writes, batch key, unique contact e-mail per organisation); a stale preview applies nothing and the screen says "This preview is out of date" with "Run a fresh preview"; (2) Agency and End client pickers (Add enquiry, Quick Add, and new ones in Edit details) offer only organisations holding the role, enforced by trigger `crm_opportunities_party_roles`; (3) a dated follow-up can be placed on an account with no inquiry (`crm_follow_ups.organisation_id`, `crm_create_account_follow_up`), shown on Follow-ups, My Day, reports and the account page, independent of the account owner. Tests: `packages/rls-tests/test/crm-import-safety.rls.test.ts`, `inquiry-organisation-pickers.test.tsx`, `organisation-roles.test.ts`, `import.test.ts`, `account.test.ts`, `reports.test.ts`, `crmPermissions.test.ts`; browser flow `apps/web/os-shell-checks/clients-agencies-flow.mjs`. Details: `modules/sales-clients-and-agencies.md` section 9.

### 2026-11-07 | Clients & Agencies: pre-inquiry outreach, added to the same draft PR | branch `feat/clients-agencies` (not merged)
* Summary: an assigned sales worklist for new prospects and existing accounts, with no inquiry or placeholder deal: Sales leads (`assign_owner` / founder) select one or several accounts in the directory and "Assign outreach" to an eligible salesperson with a target date and optional objective (one result per account; one open outreach per account and company, a second assignment reassigns it with history kept); new Sales tab "Outreach" (`/sales/outreach`): My outreach and, for leads, All outreach (filters Assigned to, Status, Overdue only; sorted by next due); the account page gets an Outreach section: log a call, email or meeting with date, outcome (No answer, Spoke, Left message, Sent, Replied, Meeting held, Not interested) and note, set the next action and due date, an explicit status (Not started, In progress, Waiting for reply, Meeting booked, Inquiry raised, Closed; first activity moves Not started to In progress, linking an inquiry sets Inquiry raised, Closed needs a reason, a reply is never inferred), and Create or Link a real inquiry. History is append-only.
* Migrations: `20261219000100_crm_clients_agencies` corrected in place again (section 8: tables `crm_outreach`, `crm_outreach_events`; functions `crm_assign_outreach`, `crm_outreach_log`, `crm_outreach_set_next`, `crm_outreach_set_status`, `crm_outreach_link_inquiry` and two helpers). Still applied on no hosted project, so still one migration and one owner pack (`supabase/manual-sql/crm_accounts_00/05/20/90`; 20 and 90 extended, 05 comment only). `docs/clients-agencies-deployment.md` updated.
* Access: assigning needs the existing `assign_owner` capability; the assignee needs Sales access for the company; reads are the assignee's own rows and, for `assign_owner` holders, the company's (narrower than inquiries); no access widened and account ownership untouched in both directions (`modules/sales-clients-and-agencies.md` section 10).
* Tests: `packages/rls-tests/test/crm-outreach.rls.test.ts`, `apps/web/src/lib/actions/outreach.test.ts`, `apps/web/src/lib/crm/clients-agencies/outreach.test.ts`, `outreach-data.test.ts`, `nav-groups.test.ts`; browser journey `apps/web/os-shell-checks/clients-agencies-outreach-flow.mjs`.
* Not included (follow-ups): My Day row, notifications, export, reopening a closed outreach.

### 2026-11-07 | docs only | branch `docs/enginious-os-app-map`
* Summary: app memory (README and files 01 to 06) and `CLAUDE.md` added. Clarified: direct table writes under RLS in HR-core versus function-only writes in module areas; mutable workflow records versus immutable ledgers (`audit_log` immutability `Unverified`); unit condition `fair` is available on return or receipt; Inventory Today "Sales checks"; Budget approvals separate from `/approvals`; scheduler activation deferred by owner decision with hosted status `Unverified`. No app, database or test changes.

### 2026-11-04 | #57 | `28549dd90d6c234f417b31f7dabbf3900358cec0`
* **Merged** (merge commit of `feat/module-access-simplify` into `main`, 2026-11-04). Required CI green on the PR head `2200c36` and on `main` at `28549dd` (owner/coordinator-reported; not re-run by Claude). No migration. Sections 02 (People & Access screen), 03 (section 2.2a) and this entry re-verified against the merged code at `28549dd` (2026-11-07). Vercel Production status for `28549dd`: not verified by Claude (owner to confirm).
* Summary: People & Access, Module access simplified: one explicit "Access for company", compact module cards (No access only after a successful read; could not load; can't manage), working profiles mapped to existing capabilities, collapsed Advanced access in four groups, draft plus review before one Save changes, explicit Inventory warehouse scope, profile labels recognised from actual capabilities. Presets replaced in the UI by the single definition `packages/domain/src/accessProfiles.ts`.
* Migrations: none. Permissions, grant functions, approval independence, company isolation and audit unchanged.
* Tests: `packages/domain/test/accessProfiles.test.ts`, `apps/web/src/components/people-access/module-access-panel.test.tsx`, loader and server-action tests; `people-access-flow.mjs` 52 passed on the local stack.

### 2026-11-04 | #56 | `551f61581b18ea60693cd3d7e408891b5520f39e`
* Summary: My Day attention count; Inventory location versus ownership (equipment owned by one company can be kept in another company's warehouse); cross-company receiving (`inv_xshare_*`). Branch `feat/attention-count-and-warehouse-location`. Final commit on `main` at the time of this ledger.
* Migrations: `20261218000100_inv_cross_company_receiving` (#15; adds eleven functions, changes no table, policy or privilege).
* Related docs and tests (Unverified which files this merge added):  `docs/inventory-cross-company-receiving.md`, `docs/inventory-location-review.md`, RLS suites `inventory_cross_company_receiving`, `inventory_transfer_location`.

### 2026-11-04 | #55 | `941a82c88ca1291035574c87b2e8a64bbc2fdf79`
* Summary: Launch refinement 3/3, dispatch and return documents: frozen numbered dispatch notes and return checklists with PDF, acknowledgement and difference reporting. Behind a per-company switch that is OFF by default. Also carries the launch-batch install pack fix (only functions the changes build on are prerequisites).
* Migrations: `20261217000100_inv_project_notes` (#14; creates `inv_project_notes`, `inv_project_note_events` with frozen-row guard).

### 2026-11-04 | #54 | `e862212db4ae5cdf90368ad47d9febd8e470345e`
* Summary: Launch refinement 2/3, daily usability. Docs now link the authoritative install order instead of a second order table.
* Migrations: `20261216000900_proj_block_task_notifies_pm` (#12), `20261216000910_module_access_managers` (#13).

### 2026-11-04 | #53 | `bf9fb62611369c4cf127ccac404e1bd4ad01e719`
* Summary: Launch refinement 1/3, correctness and security. Adds the one authoritative install sequence (`docs/launch-refinement-install-order.md`), accurate labels for what each SQL file does, the corrected hosted checklist and the `canSeedPolicyDrafts` button fix. Fixes: Issue after Reserve, deactivation of inactive people, restricted profile status columns, project-lead list on the clock, recovery decider card data, draft policy status check, letter file readable once issued, approval routing by country scope, scope decision context, Finance waiting number.
* Migrations: `20261216000100` through `20261216000830` (#1 to #11; `20261216000100`, `…200`, `…300`, `…400`, `…500`, `…600`, `…700`, `…800`, `…810`, `…820`, `…830`).

### 2026-11-01 | #52 | `76c121bd0431afa0614efe60388f6c790c842309`
* Summary: Inventory for everyday warehouse use: Today, Stock, History and one request workspace. No database change.
* Migrations: none.

## People, access and the OS rollout (October 2026)

### 2026-10-27 | #51 | `d7528f7121871ccbb379241386dc288713a4a21b`
* Summary: Access grant rules R1 to R3: security migration and owner deployment pack. Message states the migration was already applied on V2.
* Migrations: `20261215000000_access_grant_rules`.

### 2026-10-27 | #50 | `217e566bb3ff03c2b1edbdff42018d1ec0c4cb5e`
* Summary: People & Access: one screen for accounts, job details, HR roles and module access. Message states no migration and no security rule changes; hosted account verification was pending and ran on Production right after the merge (`docs/people-access-hosted-test-runbook.md`; results in `docs/people-access-account-controls-verification.md`).
* Migrations: none.

### 2026-10-26 | #49 | `c3bdd2a3f8a26b7192778078ed69a1ac6b268a23` (squash)
* Summary: Project Budget & Expenses.
* Migrations: `20261210000000_pbx_access_audit_settings`, `…100_pbx_core_tables`, `…200_pbx_budget_functions`, `…300_pbx_funding_actuals_settlement`, `…400_pbx_views`.

### 2026-10-26 | #48 | `20d0abfeb4c22c7c32faed7738e1a15e333e3344`
* Summary: ENGINIOUS OS Stages 4 to 7: Sales, Inventory, People & HR and whole-app consistency.
* Migrations: none.

### 2026-10-26 | #47 | `ea54ac1aebcb7e87dad6ea630d4ef5f998c8a331`
* Summary: ENGINIOUS OS Stage 3: My Day (CEO overview with People & HR below). Migrations: none.

### 2026-10-26 | #46 | `4c02869ce6daf45b5e73b341d270e738580f8597`
* Summary: ENGINIOUS OS Stage 2: Projects & Tasks on the new design. Migrations: none.

### 2026-10-26 | #45 | `5d9d02c8729cc573c313a78fd5d1094e2b9e0ebe`
* Summary: ENGINIOUS OS Stage 1: shared design system and product branding. Migrations: none.

### 2026-10-25 | #43 | `025db417229f77a3ec2d2dea040607bf6a9bf875`
* Summary: Finishing pass: suggested site time zone, recorded check versus current availability, one handover process. Migrations: none.

### 2026-10-25 | #42 | `c7739f31f762351a252899d7c891a51c02c097d3`
* Summary: Escape closes an open menu without closing the side panel; browser audit for cut-off menus and dialogs. Migrations: none.

### 2026-10-25 | #41 | `5c3a41443af78f253420a188023852ce4ac3bb09`
* Summary: Inventory fixes from testing: cut-off menus and dialogs, Sales checks waiting for the warehouse, HR Assets tab shows Inventory equipment.
* Migrations: `20261201000900_inv_pending_sales_checks`.

### 2026-10-25 | #40 | `c55e06a02d278f1423275a2f05d2c5b9c76eaa7e`
* Summary: Inventory: Add item works on an empty catalogue. Migrations: none.

### 2026-10-25 | #39 | `70e5fcd856f9494dd5d9aa5c1a929ed98d313394`
* Summary: Inventory module: stock, requests, movements, QR labels, Sales, Projects and employee connections.
* Migrations: `20261201000000` to `20261201000800` (access and audit settings, catalogue and stock ledger, planning tables, shared helpers, stock functions, planning functions, employee legacy, count line remove, transfer destination check, project equipment unlinked).

### 2026-10-22 | #38 | `aa57b3854c14dc24b50b91a506f574b37043e6af` (squash)
* Summary: Simplify Sales & CRM and Projects & Tasks: table, optional board, quick add, side panel. Migrations: none.

### 2026-10-18 | #37 | `7612327237ef86d0bc09ababa05035f5b7df2c62`
* Summary: Projects & Tasks (Release 2): handover, delivery, calendars, site bookings, client timeline.
* Migrations: `20261120000000_proj_access_audit` to `20261120000600_proj_history_labels_upload_cleanup` (seven files).

### 2026-10-18 | #36 | `b8437afee3cdef7906588a12b948eeb58d913d6b` (merge commit message "Merge ENGINIOUS OS shell, real My Day and readable themes")
* Summary: ENGINIOUS OS shell in the real app: module navigation, real My Day, readable dark and light themes. Migrations: none.

### 2026-10-18 | #34 | `c0d7fa27a07cc4f32c010f28e4c6547584e5bfa1`
* Summary: Sales & CRM (Stage B): working module, migrations, tests and manual V2 deployment guide.
* Migrations: `20261115000000_crm_access_audit_settings`, `…100_crm_core_tables`, `…200_crm_workflow_functions`, `…300_crm_proposals_files_reminders`.

### 2026-10-18 | #33 | `03cee5711dfba49be5c9c58a87cae90d2b94cce0`
* Summary: ENGINIOUS OS Stage A design preview (sample data only) and roadmap v2. Migrations: none.

## Security hardening and Recovery Leave (early October 2026)

### 2026-10-05 | #30 | `cf535ac96c81122251f31e0eff815ec75931ad45`
* Summary: Harden table privileges across the public schema (TRUNCATE, TRIGGER, REFERENCES, MAINTAIN), including defaults for new tables. Migrations: `20261114000000_public_privilege_hardening`.

### 2026-10-05 | #29 | `9a5fa76a94edf4fcbe2fc5d00bad74fc014907b4`
* Summary: Harden ledger privileges on `leave_ledger` and `comp_day_ledger` (remove TRUNCATE, TRIGGER, REFERENCES and anon access). Migrations: `20261113000000_ledger_privilege_hardening`.

### 2026-10-05 | #28 | `f8603f24a41385d9b24a2caf1ed3d04e2ebf211c`
* Summary: Security Definer views fixed: `leave_balances` and `comp_day_balances` now run as the caller. Migrations: `20261112000000_balance_views_security_invoker`.

### 2026-10-04 | #26 | `e98c87b0f66d185813d9b9afa08e29754e13db14`
* Summary: Approvals menu entry shown to anyone with something waiting on their decision. Migrations: none.

### 2026-10-04 | #27 | `a658fd5def8490f676bec63d2fc8abf2742f9895`
* Summary: "No manager assigned" hidden for a CEO or CTO even when an HR Admin views the profile. Migrations: `20261110000000_employee_is_c_level`.

### 2026-10-04 | #25 | `86afc8d72e275791c6b99f15f01abcb9a9d71c0b`
* Summary: No "No manager assigned" callout for a CEO or CTO. Migrations: none.

### 2026-10-04 | #24 | `0609480fc5d9165c7eecae8f0c61825fa5bd4029`
* Summary: CEO and CTO requests need no approver. Migrations: `20261109000000_executive_requests_no_approver`.

### 2026-10-04 | #23 | `54f7ca2e515823e00707f77c40b44cac3851d3ab`
* Summary: Leave notification e-mails name the recipient and who decided. Migrations: none.

### 2026-10-03 | #22 | `35685de86f74eeedd6f628b1544fc9aa5acb1751`
* Summary: Recovery Leave 24-hour windows and automatic attendance register (dormant until activated). Migrations: `20261108000000_recovery_windows_attendance_redesign`.

### 2026-09-28 | #8 | `f1b2f88d1479cbe1eb0f0010d916905f058a826c`
* Summary: from branch name `qa/e2e-production-suite` (Playwright `packages/e2e-tests`; title only, content not inspected). Migrations: none in the merge diff checked here. Earlier PRs (#1 to #21 except the ones above) are not listed: not inspected for this ledger (Unverified).

## Documentation-only branches (not on `main`)

* `docs/enginious-os-app-map` (this memory, `docs/enginious-os/`, `CLAUDE.md`): built on `551f615`, no application change, no migration.
* `docs/launch-refinement-spec` (`docs/launch-refinement/specification.md`, written at `76c121b`): pre-release specification and defect register; partly stale after #53 to #56.

## Template entry (copy for every new change)

```
### YYYY-MM-DD | #PR | `full-merge-sha` (add "squash" if no merge commit)
* Summary: one line of what changed for a user or an owner (behaviour, access, navigation, flow, data or tests).
* Migrations: `file_name` (and its pack prefix) or "none".
* Files updated in `docs/enginious-os/`: 0X-....md (sections), plus 05 ledger rows if a migration or test changed.
* Hosted status: not applied / applied and verified (owner-reported, date) / not applicable.
* Tests added or changed: paths, and whether the browser flows were re-run (commit SHA).
```
