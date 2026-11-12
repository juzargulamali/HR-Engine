# 05. Data model, tests and release ledger

Verified at `551f615` (main, merge of PR #56), 2026-11-04. Read-only inspection of the repo: no database, server, test or hosted system was run. Conventions are in `README.md`. Hosted facts are **owner-reported** unless stated.

## A. Data model reference

### A.0 How to read this section

* Every module table carries a `company_id` (the owning company) unless a row says otherwise; RLS is enabled on every module table (e.g. `supabase/migrations/20261201000100_inv_catalogue_stock_ledger.sql` enables it in a loop).
* Table lists below are taken from `create table` statements in the migrations (grep), not from `schema/schema.sql`. RLS summaries are one-line paraphrases of the migration headers: **the policy SQL is the authority**; read it before relying on a summary.
* **Write paths differ by area.** Sales, Projects, Inventory and Budget tables take no direct writes (SELECT policies only; writes are SECURITY DEFINER functions). HR-core tables accept some direct writes from the signed-in user under RLS policies, triggers and column privileges: for example `reimbursement_claims` (owner insert as `draft`, update while draft, cancel, delete draft) and `policy_versions` (insert/update guarded by `guard_policy_version_update()`). Always read the table's policies before assuming either.
* Module access is a per-company grant row (`crm_company_grants`, `proj_company_grants`, `inv_company_grants`, `pbx_company_grants`), written only through `*_grant_access` / `*_revoke_access` SECURITY DEFINER functions (`20261215000000_access_grant_rules.sql` and the four `*_access_audit_settings` migrations). Each module also has `*_company_settings`, `*_audit_log`, `*_reference_counters`.

### A.1 HR core (phases 0 to 6, `20260922000000` to `20261114000000`)

| Table | Purpose | Ownership | RLS summary |
|---|---|---|---|
| `profiles` | 1:1 with `auth.users`; display name, `account_status`, `is_active`, status reason | user id | Directory readable by signed-in users; status columns restricted (`20261216000400_profiles_status_columns_restricted.sql`); self-update guard `guard_profiles_self_update()` |
| `user_roles` | HR roles `(user_id, role, company_id?, country_code?)` | company or country | Writes by System Administrator only; revocation guarded (`20261030000000_guard_role_grant_revocation.sql`) |
| `employees` | HR master record (no salary, bank, ID numbers) | `company_id`, `manager_id` | Self, manager chain, scoped HR Admin; self-update guard (`20261009000000_fix_employee_self_update_guard.sql`) |
| `employment_contracts`, `compensation_details`, `identity_documents` | Versioned contract, pay and ID data, separate RLS tiers | via employee | HR Admin, Finance, owner read per table (per `docs/02-database-schema.md` 2.3) |
| `approvals` | Polymorphic append-only decision log (leave, claims, timesheets, letters, recovery) | entity | Approver and requester; routing by `resolve_approver*` (`20261216000810_approval_routing_country_scope.sql`) |
| `leave_requests`, `leave_ledger`, `comp_day_ledger` | Requests and append-only ledgers; balances are views (`leave_balances`, `comp_day_balances`) | employee | Self, manager chain, HR; ledger privileges hardened (`20261113000000`), views `security_invoker` (`20261112000000`) |
| `policy_versions`, `policy_leave_types`, `public_holidays` | Country policy engine, draft/active/superseded | country | Two-person activation by trigger `guard_policy_version_update`; draft status check `policy_status_role_check` (`20261216000700`) |
| `attendance_records`, `attendance_sessions`, `attendance_segments`, `attendance_session_corrections` | Clocking and corrections | employee | Self, manager, HR |
| `recovery_windows`, `recovery_window_allocations`, `recovery_window_revisions`, `recovery_credit_requests`, `recovery_periods`, `recovery_alerts`, `recovery_processor_runs` | Recovery Leave windows (24-hour model) and the processor | employee | Self, HR; decider card via `recovery_decider_inbox()` |
| `reimbursement_claims`, `reimbursement_claim_lines`, `timesheets`, `timesheet_entries` | Expense claims and timesheets | employee | Owner on draft, approver, Finance |
| `letter_templates`, `generated_letters`, `payroll_export_runs`, `payroll_export_lines` | Letters and payroll export | company | HR, Finance; employee reads own letter file only once **issued** (`20261216000800`) |
| `audit_log`, `notifications`, `ai_drafts` | Audit trail, in-app notices, AI suggestions | company / user | `audit_log` written by triggers and functions; Unverified here whether it is still insert-only (`docs/02-database-schema.md` 2.7) |
| `employee_loans`, `employee_insurance_policies`, `employee_career_events`, `termination_settlement_inputs` | Later HR additions | employee | HR Admin / Finance / owner read |

Key SECURITY DEFINER helpers: `has_role`, `is_manager_of`, `same_company`, `current_employee_id`; `user_is_active`, `account_deactivation_blockers`, `account_holdings`, `set_account_status` (`20261216000300`); `resolve_approver`, `resolve_approver_for_company`, `resolve_role_holders`, `create_initial_approval`, `recovery_route_request`; `module_access_managers(p_module)` (`20261216000910`); `attendance_lead_candidates()` (`20261216000500`).

### A.2 Sales & CRM (`20261115000000` to `…0300`)

Tables: `crm_organisations`, `crm_contacts`, `crm_opportunities` (`company_id`, `owner_id`), `crm_opportunity_contacts`, `crm_opportunity_events`, `crm_activities`, `crm_follow_ups`, `crm_reminders`, `crm_proposals`, `crm_files`, `crm_upload_intents`, `crm_handovers`, `crm_approvals`, `crm_closures`, `crm_zoho_references`, `crm_company_grants`, `crm_company_settings`, `crm_audit_log`, `crm_reference_counters`.
RLS: access needs a `crm_company_grants` row for the company; founders see everything in the company, others see what they own or are granted (`crm_can_edit_contact` and siblings, 69 functions with the `crm_` prefix). Workflow changes go through functions (stage moves, hold, close, reopen, handover), not direct writes. Key functions: `crm_grant_access`, `crm_revoke_access`, `crm_cancel_follow_up`.

### A.3 Projects & Tasks (`20261120000000` to `…0600`, plus `20261216000200/820/900`)

Tables: `proj_projects` (`company_id`), `proj_project_details`, `proj_project_members`, `proj_teams`, `proj_tasks`, `proj_task_events` (append-only history), `proj_task_comments`, `proj_task_dependencies`, `proj_task_collaborators`, `proj_milestones`, `proj_deliverables`, `proj_handovers` (frozen update guard), `proj_sales_links`, `proj_scope_changes`, `proj_scope_change_commercial`, `proj_site_bookings`, `proj_plan_items`, `proj_issued_plans`, `proj_messages`, `proj_message_tombstones`, `proj_message_mentions`, `proj_feedback`, `proj_files`, `proj_upload_intents`, `proj_completions`, `proj_change_log`, `proj_external_dependencies`, `proj_read_state`.
RLS: grant row per company; project members, Project Manager and founders see detail; summary-only access exists (`proj_can_view_summary` vs `proj_can_view_details`). Key functions: `proj_accept_handover`, `proj_handover_for_opportunity`, `proj_decide_scope_change`, `proj_block_task` (now also tells the PM, `20261216000900`), `proj_complete_project`, `proj_can_manage`, `proj_can_book`, `proj_revoke_access`. Scope decisions: `20261216000820_proj_scope_decision_context.sql` adds the decider's read of the scope change; `20261216000200` notifies deciders.

### A.4 Inventory (`20261201000000` to `…0900`, `20261216000100`, `20261217000100`, `20261218000100`)

**Condition and availability (as coded).** Individual units may be `good, fair, needs_inspection, damaged, unserviceable` (`inv_valid_condition`); counted balances only `good, needs_inspection, damaged`. A unit returned or received as **good or fair** is reported `available`; the other conditions are held, and counted stock is available only when `good` (`inv_return_from_project`, `inv_transfer_receive`; `20261201000300_inv_stock_functions.sql`). `inv_movements` and `inv_movement_lines` are immutable (A.6); `inv_requests`, `inv_transfers` and `inv_units` status/condition columns are mutable workflow state.

| Table | Purpose | Ownership column | RLS summary |
|---|---|---|---|
| `inv_items`, `inv_categories`, `inv_technologies`, `inv_technology_components`, `inv_kit_contents` | Catalogue | `company_id` | Browse for anyone with access; edits guarded (`inv_items_guard`) |
| `inv_units` | Serialised units, barcode, owner and condition | `company_id` (owner), location separate | `inv_units_guard` trigger; owner and holder differ from location (PR #56) |
| `inv_locations`, `inv_bins`, `inv_operator_locations` | Warehouses and who may operate where | `company_id` per location (code unique per company) | Operator rows decide who can move stock |
| `inv_balances` | Counted stock by item, location, holder (`holder_kind`) | `company_id` | Read needs `inv_can_view_stock`; written only by stock functions |
| `inv_movements`, `inv_movement_lines` | The immutable stock ledger | `company_id` | Frozen (A.6) |
| `inv_requests`, `inv_request_lines`, `inv_reservations` | Planning: project and employee requests, reservations | `company_id` | `inv_can_see_request`, `inv_can_edit_request`; Sales sees only availability checks |
| `inv_transfers` | Between warehouses and projects | `company_id` | Destination check (`20261201000700`); cross-company via `inv_xshare_*` (11 functions) |
| `inv_counts`, `inv_count_lines` | Stock counts | `company_id` | Operators |
| `inv_company_sharing` | Which other company may use a company's stock | `company_id`, `use_company_id` | Audited |
| `inv_project_notes`, `inv_project_note_events` | Dispatch and return notes | `company_id` | Frozen (A.6); gated by company switch `inv_project_notes_enabled(uuid)`, off by default |
| `inv_costs` | Unit costs | `company_id` | Founder or explicit view-costs grant only |

Also: `inv_availability_checks`, `inv_rentals`, `inv_idempotency`, `inv_import_log`, `inv_label_prints`, `inv_company_grants`, `inv_company_settings`, `inv_audit_log`, `inv_reference_counters`. Key functions: `inv_receive_stock`, `inv_adjust_stock`, `inv_reserve`, `inv_dispatch_to_project`, `inv_return_from_project`, `inv_return_unused`, `inv_issue_to_employee` (consumes the request's own reservation since `20261216000100`), `inv_return_from_employee`, `inv_transfer_dispatch`, `inv_transfer_receive`, `inv_transfer_between_projects`, `inv_make_project_note`, `inv_set_project_notes`, `inv_xshare_availability`, `inv_xshare_transfers`, `inv_xshare_transfer_trace`, `inv_xshare_units`. Legacy HR `assets` and `asset_assignments` are guarded by `inv_legacy_guard_*` triggers (`20261201000500_inv_employee_legacy.sql`).

### A.5 Project Budget & Expenses (`20261210000000` to `…0400`)

Tables: `pbx_budgets` (`company_id`), `pbx_budget_versions`, `pbx_budget_rows`, `pbx_categories`, `pbx_rates`, `pbx_funding`, `pbx_payments`, `pbx_actual_submissions`, `pbx_actual_rows`, `pbx_company_grants`, `pbx_company_settings`, `pbx_audit_log`.
RLS: grant row per company plus per-record read helpers (`pbx_can_read_budget`, `pbx_can_read_budget_header`, `pbx_can_read_submission`, `pbx_can_read_version`, `pbx_can_view_company`). Writes through functions: `pbx_submit_budget`, `pbx_lock_budget`, `pbx_record_funding`, `pbx_record_payment`, `pbx_record_receipts`, `pbx_submit_actuals`, `pbx_settlement_*`, `pbx_can_decide`, `pbx_can_close_settlement`, `pbx_decisions_waiting_count` (Finance menu number, `20261216000830`), `pbx_grant_access`, `pbx_revoke_access`.

### A.6 Frozen and append-only tables, and their guards

Two kinds of record exist: **immutable ledgers and histories** (rows below with a guard trigger or revoked UPDATE/DELETE) and **mutable workflow records** whose status or decision columns change by design (for example `approvals`, `leave_requests`, `reimbursement_claims`, `inv_requests`, `proj_handovers` before submit, `inv_transfers.status`, budget versions). Only the tables listed below were verified as guarded.

| Table | Guard | Source |
|---|---|---|
| `inv_project_notes` | Trigger `inv_project_notes_frozen_row` (before update or delete) and `…_frozen_truncate` run `inv_project_notes_frozen()`: every column frozen, truncate refused | `20261217000100_inv_project_notes.sql` lines 121 to 136 |
| `inv_project_note_events` | Same function, same two triggers; history only grows. A correction is a NEW note citing the old one | same |
| `inv_movements`, `inv_movement_lines` | Triggers `inv_movements_immutable`, `inv_movement_lines_immutable` (before update or delete) run `inv_ledger_immutable()` | `20261201000100_inv_catalogue_stock_ledger.sql` lines 349 to 360 |
| `proj_handovers` | Trigger `proj_handovers_frozen` (before update) runs `proj_handover_frozen()` | `20261120000100_proj_core_tables.sql` line 315 to 328 |
| `proj_task_events` | Append-only history by design (comment in the migration) | `20261120000100_proj_core_tables.sql` line 251 |
| `leave_ledger`, `comp_day_ledger` | Append-only by privilege, not by trigger: UPDATE and DELETE revoked from `authenticated`; TRUNCATE, TRIGGER, REFERENCES and `anon` access removed | `20261113000000_ledger_privilege_hardening.sql` (header), `20260926000000_phase3_leave_and_approvals.sql` |
| `audit_log` | No insert, update or delete policy; rows are written only by trigger function `write_audit_log()` (SECURITY DEFINER). No guard trigger against update or delete was found in the migrations, so immutability for the service role and for hosted privileges is **Unverified** | `20260929000000_phase6_letters_payroll_audit_ai_drafts.sql` lines 574 to 657 |
| `approvals` | **Not immutable.** A mutable workflow record: `decide_leave_approval` and its siblings `update approvals set decision, decided_at, comments` once. No guard trigger was found. Do not treat it as a ledger (see `03-roles-access-and-approvals.md` section 4.7) | `20260926000000_phase3_leave_and_approvals.sql:293` |

### A.7 Storage buckets

All buckets are private. From `insert into storage.buckets` in the migrations:

| Bucket | Created in | Notes |
|---|---|---|
| `employee-documents`, `identity-documents` | `20260924000000_phase1_…` | Path starts with company and employee ids; HR Admin and owner per policy |
| `receipts` | `20260927000000_phase4_…` | Claim receipts; owner, approver, Finance, HR |
| `letters` | `20260929000000_phase6_…` | `letters_select` narrowed so an employee reads their own file only once issued (`20261216000800`); HR Admin branch and CEO/CTO read policy unchanged |
| `insurance-documents` | `20261019000000_loans_and_insurance.sql` | 10 MiB, pdf and image types |
| `crm-files`, `crm-quarantine` | `20261115000300_crm_…` | 20 MiB, allowed-type list `crm_allowed_mime_types()`; quarantine has no policies, never readable by users, server validates then moves or deletes |
| `proj-files`, `proj-quarantine` | `20261120000500_proj_…` | Same pattern |
| (none) | | No Inventory or Budget bucket exists in the migrations (labels and PDFs are generated, dispatch notes are table rows) |

`20261011000000_upload_validation.sql` sets size and type limits on the earlier buckets.

### A.8 Stale statements in `docs/02-database-schema.md` (written pre-launch; the design reasoning in 2.3 to 2.5 still reads true)

* **Stale** (2.2): role list omits `cto` (`20261017000000_add_cto_role.sql`, `20261018000000_cto_role_parity.sql`).
* **Stale** (2.4): the overtime to comp-day conversion on timesheet approval was removed (`20261010000000_remove_timesheet_overtime_conversion.sql`).
* **Stale or unsupported** (2.5): `leave_balances` "materialized nightly". No `materialized` appears in the migrations; balances are views made `security_invoker` by `20261112000000`.
* **Stale** (2.9): table lists an `assets` bucket and omits `insurance-documents`, `crm-*`, `proj-*`. No `assets` bucket is created in the migrations (Unverified for the hosted project). Letters policy changed (above).
* **Incomplete**: the document covers HR only; Sales, Projects, Inventory and Budget tables are not described there (use A.2 to A.5).
* **Unverified**: 2.7 audit_log "insert-only" and 2.8 soft-delete behaviour were not re-checked here.

## B. Migration ledger

### B.1 Counts and layout

95 files in `supabase/migrations/` (`ls | wc -l`). Phase 0 to 6 foundations from `20260922000000`; module families: CRM `20261115*`, Projects `20261120*`, Inventory `20261201*`, Budget `20261210*`, Access grant rules `20261215000000`, launch stack `20261216000100` to `20261218000100`. Owner install packs live in `supabase/manual-sql/` named `<prefix>_00_preflight_readonly`, `_05_preservation_check_readonly` (run twice), `_20_verify_readonly`, `_90_rollback`; optional writes are `_30` and `_80`. Rule: never edit an applied migration; add a new one.

### B.2 The last 32 migrations (the whole Inventory, Budget and launch tail), oldest first

| Migration | Purpose (from file name and header) |
|---|---|
| `20261201000000_inv_access_audit_settings` | Inventory grants, audit log, company settings |
| `20261201000100_inv_catalogue_stock_ledger` | Catalogue, units, balances, immutable movement ledger |
| `20261201000200_inv_planning_tables` | Requests, reservations, transfers, counts |
| `20261201000250_inv_shared_helpers` | Shared permission helpers |
| `20261201000300_inv_stock_functions` | Receive, adjust, issue, dispatch, return functions |
| `20261201000400_inv_planning_functions` | Planning functions and Projects triggers (`inv_proj_projects_import`, `…_release`) |
| `20261201000500_inv_employee_legacy` | Employee equipment; guards on legacy HR assets |
| `20261201000600_inv_count_line_remove` | Remove a count line |
| `20261201000700_inv_transfer_destination_check` | Destination rule for transfers |
| `20261201000800_inv_project_equipment_unlinked` | Project equipment not linked to a request |
| `20261201000900_inv_pending_sales_checks` | Sales checks waiting for the warehouse (PR #41) |
| `20261210000000_pbx_access_audit_settings` | Budget grants, audit, settings |
| `20261210000100_pbx_core_tables` | Budget tables |
| `20261210000200_pbx_budget_functions` | Submit, decide, lock budget |
| `20261210000300_pbx_funding_actuals_settlement` | Funding, payments, actuals, settlement |
| `20261210000400_pbx_views` | Budget views |
| `20261215000000_access_grant_rules` | Rules for who may grant module access (PR #51; applied on V2 before the launch stack) |
| `20261216000100_inv_issue_to_employee_consumes_reservation` | Issue after Reserve no longer refused |
| `20261216000200_proj_scope_proposal_notifies_deciders` | Scope proposal notifies deciders |
| `20261216000300_account_deactivation_inactive_people` | Deactivation clears `is_active`, refuses last CEO/CTO cases |
| `20261216000400_profiles_status_columns_restricted` | Status reason columns unreadable to signed-in roles |
| `20261216000500_attendance_lead_candidates` | Project-lead picker for the clock |
| `20261216000600_recovery_decider_inbox` | Recovery decider card data |
| `20261216000700_policy_status_role_check` | Draft status visible to drafters only |
| `20261216000800_letters_storage_issued_only` | Letter file readable once issued |
| `20261216000810_approval_routing_country_scope` | Approval routing respects country scope (needs #3) |
| `20261216000820_proj_scope_decision_context` | Scope decision context for deciders |
| `20261216000830_pbx_decisions_waiting_count` | Finance waiting number |
| `20261216000900_proj_block_task_notifies_pm` | PM told when a task is blocked |
| `20261216000910_module_access_managers` | "Who can grant access" lookup |
| `20261217000100_inv_project_notes` | Frozen dispatch and return notes, switch default off |
| `20261218000100_inv_cross_company_receiving` | Eleven `inv_xshare_*` functions, no table changes |

### B.3 The 15 launch migrations (`docs/launch-refinement-install-order.md`, authoritative)

| # | Migration | Pack prefix | PR | Merge SHA |
|---|---|---|---|---|
| 1 | `20261216000100_inv_issue_to_employee_consumes_reservation` | `inv_emp_issue` | #53 | `bf9fb62` |
| 2 | `20261216000200_proj_scope_proposal_notifies_deciders` | `proj_scope_notify` | #53 | `bf9fb62` |
| 3 | `20261216000300_account_deactivation_inactive_people` | `deact` | #53 | `bf9fb62` |
| 4 | `20261216000400_profiles_status_columns_restricted` | `profstat` | #53 | `bf9fb62` |
| 5 | `20261216000500_attendance_lead_candidates` | `leadpick` | #53 | `bf9fb62` |
| 6 | `20261216000600_recovery_decider_inbox` | `reccard` | #53 | `bf9fb62` |
| 7 | `20261216000700_policy_status_role_check` | `polstat` | #53 | `bf9fb62` |
| 8 | `20261216000800_letters_storage_issued_only` | `letters` | #53 | `bf9fb62` |
| 9 | `20261216000810_approval_routing_country_scope` | `apprscope` | #53 | `bf9fb62` |
| 10 | `20261216000820_proj_scope_decision_context` | `scopectx` | #53 | `bf9fb62` |
| 11 | `20261216000830_pbx_decisions_waiting_count` | `pbxwait` | #53 | `bf9fb62` |
| 12 | `20261216000900_proj_block_task_notifies_pm` | `blocknotify` | #54 | `e862212` |
| 13 | `20261216000910_module_access_managers` | `modaccess` | #54 | `e862212` |
| 14 | `20261217000100_inv_project_notes` | `inv_notes` | #55 | `941a82c` |
| 15 | `20261218000100_inv_cross_company_receiving` | `inv_xshare` | #56 | `551f615` |

Rules: apply in file-name order; #9 needs #3 (`user_is_active`). The batch (`launch_batch_00/20/21/22/90`, built by `scripts/build-launch-batch.mjs`, checked by `npm run check:launch-batch`) installs 3 to 14 only; #15 has its own pack. `check:launch-batch` is not a CI step (`.github/workflows/ci.yml`). Sequence per change: preflight, snapshot, apply, verify (last row `0 failing`), compare (`PASS`).

### B.4 Hosted status (owner-reported, V2; not run or checked by Claude)

* #1 and #2: applied; verify and preservation compare passed.
* #3 to #14: installed through the batch; reported applied and verified before #15.
* #15: applied. Verify **69 checks, 0 failing**. Preservation compare **PASS**; 9 schema fingerprints and 8 table fingerprints unchanged; 6 protected functions unchanged; exactly 11 functions added.
* Production Ready at `551f615` (owner statement quoted in `README.md`). Source: `docs/launch-refinement-install-order.md` section 5.

**Files NOT run (owner decisions, still open):** `deact_30_align_deactivated_accounts_OPTIONAL_writes.sql` (optional; skipping breaks nothing); `inv_notes_30_switch_one_company_OPTIONAL_writes.sql` (switch dispatch/return notes ON for one company; stays off); `inv_notes_80_switch_off_writes.sql` (switch off everywhere, first response to any note problem; not needed while off); scheduler packs `recovery_windows_30_enable_scheduler.sql` and `recovery_windows_40_disable_and_reconcile.sql`, and any other scheduled-job activation (deferred). Other write or setup files, never run by this repo's process on hosted: `crm_30_bootstrap_founders`, `inv_30_bootstrap_founders`, `proj_30_bootstrap_founders`, `pbx_30_bootstrap_access`, `inv_80`, `pbx_80`, `proj_80` (safe disable and restore) and every `_90_rollback`. Whether older packs were run on V2 is outside this document (Unverified).

## C. Test map

### C.1 Layers

| Layer | Where | Count at `551f615` | Runs in CI |
|---|---|---|---|
| Domain unit tests (vitest) | `packages/domain` | 40 test files (leave days, deduction, annual entitlement, recovery windows and credit, final settlement, birthdays, business time, claim lines, contracts, policies, inventory codes, `invPermissions`, `crmPermissions`, `crmStages`, `crmDuplicates`, `crmFiles`, `crmDeadlines`, `projPermissions`, `projectPlan`, `projectCalendar`, `projectLifecycle`, `projectBudget`, `peopleAccess`, `passwordPolicy`, `scheduledDay`, `addMonthsClamped`, `compDayExpiry`) | Yes (`npm test`, workspaces) |
| Web unit and component tests (vitest) | `apps/web` | 191 test files: `src/app` 58, `src/components` 49, `src/lib/inventory` 20, `src/lib/actions` 14, `src/lib/crm` 10, `src/lib/projects` 9, `src/lib/my-day` 5, `src/lib/pdf` 4, `src/lib/budget` 4, `src/lib/policies` 2, `src/lib/people-access` 2, `src/lib/leave` 2, 12 single files (proxy matcher and config, next config, weather, focus trap, nav, auth, approvals, attendance, email, leave ledger, recovery) | Yes (`npm test`) |
| Database policy tests | `packages/rls-tests/test` | 55 files, real Postgres 16 | Yes (job `rls-policies`, `npm run test:rls`) |
| Playwright suites | `packages/e2e-tests`, `packages/e2e-account-security` | see C.4 | No |
| Browser flow scripts | `apps/web/os-shell-checks` | see C.3 | No (local stack only) |

### C.2 RLS and database tests by module (`packages/rls-tests/test/*.rls.test.ts`, one line each)

* **HR foundations:** `phase0`, `phase1`, `phase2`, `phase3`, `phase4`, `phase5`, `phase6` (the original phase suites: identity, contracts and pay tiers, policy engine, leave and approvals, claims and timesheets, performance and documents, letters and payroll); `employee_user_link`; `claim_line_numbering`; `revoke_role_grant`.
* **Policy:** `phase2b_v2_policy_drafts`, `leave_policy_configuration`, `policy_visibility`, `policy_company_only_hr`, `policy_status_role_check`.
* **Approvals and routing:** `approval_routing_scope`, `executive_requests`, `recovery_decider_card`, `module_access_managers`.
* **Attendance and Recovery Leave:** `attendance_clocking_and_recovery_routing`, `attendance_presence_sync`, `clock_lead_candidates`, `recovery_leave_stage2_cutover`, `recovery_windows_engine`, `recovery_windows_lifecycle`, `recovery_windows_operations`, `recovery_windows_policy`.
* **Accounts and privileges:** `account_deactivation`, `account_security_controls`, `profiles_status_columns`, `access_grant_rules`, `access_grant_rules_preservation`, `balance_views_security`, `ledger_privilege_hardening`, `public_privilege_hardening`, `letters_pending_storage`.
* **Events & Exhibitions (PR #72, merged as `0d598a9574ad5464573325f2b8200c151083b7e9`; migration applied on hosted V2 by the owner, owner-reported 13 of 13 verifier checks; Vercel Production not verified by Claude; status corrected 2026-11-10):** migration `20261224000100_crm_events_outreach.sql` (tables `crm_events`, `crm_event_editions`, `crm_event_observations`; columns `crm_organisations.outreach_priority` (+ `_by`, `_at`) and `crm_opportunities.event_edition_id`; ten functions (adds `crm_archive_edition`, `crm_archive_event`, `crm_import_events`; there is **no delete function or delete grant**: archive is the only removal); shared reference data readable with any Sales grant, function-only writes; the two enquiry functions are untouched). Owner pack `supabase/manual-sql/crm_events_20_verify_readonly.sql`, `crm_events_90_rollback.sql`; install and decisions `docs/events-outreach-deployment.md`; tests `packages/rls-tests/test/crm-events-outreach.rls.test.ts`, browser flow `apps/web/os-shell-checks/events-outreach-flow.mjs`.
* **Events: first edition in one save, create from an enquiry, calendar (branch `claude/events-first-edition-calendar`, 2026-11-11; PR #79, merged as `f9388b9`):** migration `20261227000100_crm_event_first_edition.sql` (install-order row 24; additive, one function `crm_add_event_with_edition`; applied on hosted by the owner 2026-11-11, owner-reported; the three Preview checks A to C passed, owner-run and owner-reported (`docs/pr79-owner-rollout.md` section 5)). Tests: `packages/rls-tests/test/crm-event-first-edition.rls.test.ts` (7, real PostgreSQL: both rows in one call, no orphan on any refusal including a failure inside the second write, duplicate and archive rules, grants), `apps/web/src/lib/actions/events.test.ts` (4 added), `apps/web/src/lib/crm/events/model.test.ts` (7 added: name key, labels, calendar), `apps/web/src/components/sales/event-edition-dialog.test.tsx` (5: the form, and Create event or edition from Quick add with the draft kept). Reference: `modules/sales-events-and-exhibitions.md` sections 3.1, 3.2, 3.5; `modules/sales-enquiries.md` section 3.4.
* **Estimate sent stage and Record estimate as sent (PR #79, branch `claude/events-first-edition-calendar`, 2026-11-11; merged as `f9388b9`):** migration `20261228000100_crm_estimate_sent_stage.sql` (install-order row 25; applied on hosted by the owner 2026-11-11, owner-reported, with the JARVIS verifier passing afterwards; **no signed-in check of the stage yet** (planned in Production after PR #79 is deployed)): stage value `estimate_sent` (three widened checks), table `crm_estimate_sends` (select with `crm_has_access(company_id)`; no write privilege), `crm_record_estimate_sent`; `crm_stage_index`, `crm_move_stage`, `crm_generate_reminders` and `jarvis_change_stage` replaced. Tests: `packages/rls-tests/test/crm-estimate-sent-stage.rls.test.ts` (18, real PostgreSQL: estimate-first, proposal-first then estimate, refusals that write nothing, never backwards, hold / resume / Lost / reopen / Won, the guard, the replaced bodies compared with the installed ones, verify and rollback packs), `packages/domain/test/crmStages.test.ts` (2 added), `apps/web/src/app/(app)/sales/opportunities/[id]/estimate-sent.test.tsx` (10), `apps/web/src/lib/actions/proposal-estimate.test.ts` (4 added), `apps/web/src/lib/crm/reports.test.ts` (2 added), `apps/web/src/lib/crm/enquiry-list.test.ts`, `apps/web/src/lib/jarvis/enquiry-stage.test.ts` (1 added) and `sales-queries.test.ts` (the stage as a lookup filter). Reference: `modules/sales-pipeline-and-stages.md` sections 1 to 3.2; `modules/sales-estimates-and-quotations.md` section 2.1; catalogue `sales.estimate.record_sent`.
* **Delivery Plan, Projects & Tasks Phase 2 part 1 (2026-11-12; merged in PR #84, merge commit `e12c22f`, required CI green on head `4ca6da3`; ONE additive migration `20261231000100_proj_delivery_plan.sql`, install-order row 28, **applied on hosted with its preflight and verify packs, owner-reported**; Production `Unverified`; safe in either order; guide `docs/projects-delivery-plan-deployment.md`):** tables `proj_dp_state`, `proj_dp_items`, `proj_dp_lines`, `proj_dp_delegations`, `proj_dp_corrections`, `proj_dp_changes` (SELECT for readers of the project's details; no direct writes); functions `proj_dp_plan`, `proj_dp_save_item`, `proj_dp_remove_item`, `proj_dp_save_line`, `proj_dp_remove_line`, `proj_dp_delegate`, `proj_dp_release`, `proj_dp_raise_correction`, `proj_dp_decide_correction`, `proj_dp_decide_change`, `proj_dp_apply_import` and five internal helpers. `proj_dp_release` calls the existing `proj_create_task`, `inv_create_request` and `inv_add_request_line`; no existing table, policy or function is changed. Tests: `packages/rls-tests/test/proj-delivery-plan.rls.test.ts` (12); web: `lib/projects/delivery-plan/model.test.ts`, `excel/excel.test.ts`, `excel/routes.test.ts`, `components/projects/delivery/delivery-plan-view.test.tsx`. Map: `modules/projects-delivery-plan.md`.
* **Project Closeout Report, Projects & Tasks Phase 2 part 2 (2026-11-12; merged in PR #84, merge commit `e12c22f`, required CI green on head `4ca6da3`; ONE additive migration `20270101000100_proj_closeout_reports.sql`, install-order row 29, **applied on hosted with its preflight and verify packs, owner-reported**; Production `Unverified`; apply after row 28; guide `docs/projects-closeout-report-deployment.md`):** table `proj_closeout_reports` (one draft per project by a unique index; approved versions frozen with their snapshot; read-only to signed-in users, managers only, through row-level security); functions `proj_closeout_evidence` (the allowlisted snapshot), `proj_closeout_save_draft` (refuses evidence that differs from the snapshot it takes itself), `proj_closeout_save_edits`, `proj_closeout_approve` (refused in the database while a statement is blocked), `proj_closeout_discard_draft`, `proj_closeout_claim` and `proj_closeout_finish` (tables `proj_closeout_generations` and `proj_closeout_usage`: one provider call per project and reviewed content, at most 10 calls per project per day) and the internal `proj_closeout_require_manager`, `proj_closeout_text_blocks`, `proj_closeout_blocks`. No existing table, policy or function is changed. App: a new outbound source `project_closeout_evidence` and rule `projects.closeout.draft` in `APP_AI_RULES` (not a JARVIS capability; `lib/jarvis/rulebook.ts`, `outbound.ts`). Tests: `packages/rls-tests/test/proj-closeout-reports.rls.test.ts` (12); web: `lib/projects/closeout/closeout.test.ts` (35, simulated provider), `claims.test.ts` (7, with `claim-cases.json` shared with the database test), `components/projects/closeout/closeout-workspace.test.tsx` (8), `lib/pdf/closeout-document.test.tsx` (2). **Recorded runs:** head `4ca6da3` (the merged head): required CI green (read from GitHub); full database suite run locally by Claude: 75 files, 1,966 passed; web 3,177; domain 516. Head `7d0e01f`: required CI `lint-typecheck-test` and `rls-policies` green (read from GitHub, 2026-11-12); full database suite run locally by Claude on that head: 75 files, 1,965 tests passed. **No live Anthropic call was made.** Map: `modules/projects-closeout-report.md`.
* **Projects & Tasks Phase 1 (branch `claude/admiring-cray-uky379`, 2026-11-11; PR #82, merged as `30c7895adc75f834a60b00ed3bca7015b1654282`; ONE additive migration `20261230000100_chat_project_groups.sql`, install-order row 27, **applied on hosted by the owner with the preflight and verify passing and the signed-in Preview tests passed (all owner-reported 2026-11-11, not verified by Claude)**; Production smoke check pending; guide `docs/chat-deployment.md` "Release 2"):** `chat_groups` gains `project_id` and kind `project`; `chat_messages` gains `source`, `source_id` (unique); functions `chat_project_group` (new), `chat_my_groups` (three more columns), `chat_is_member`, `chat_group_members`, `chat_post` (replaced; Sales rules unchanged); triggers that mirror `proj_messages` into Chat and clean up a deleted project's group. No Projects table, policy or function is changed. Tests: `packages/rls-tests/test/chat-project-groups.rls.test.ts` (12); web tests for the launcher, the Discussion address, Work attention, My Work lists, task next step, Handovers, Completion; database suite 73 files / 1,942 at `15c0f7f`. Map: `modules/projects-*.md`.
* **Sales employee launch (branch `claude/admiring-cray-uky379`, 2026-11-11; PR #80, merged as `3ff55925116ccb9f33bb6d2d69c8ec236e2bc07f`; ONE additive migration `20261229000100_crm_enquiry_list.sql`, install-order row 26, **applied on hosted by the owner with the preflight and verify passing and signed-in Preview QA passed (all owner-reported 2026-11-11, not verified by Claude)**, safe in either order; nothing hosted changed):** bounded Enquiries list and board (`crm_enquiry_list`: one page or the first cards per lane, with exact counts; fallback to the complete read), period-scoped Reports reads, corrected quick-filter scope and counts, deliberately emptied event dates kept, the edition written into the new delivery brief's notes for the Project Manager; and, from the first pass: complete, scoped enquiry reads (search and filters before the row limit; Reports by company), list quick filters, the enquiry guide (next action, where it stands, delivery handover, latest activity), one timeline with a Comments and notes view, event dates from the chosen edition in all three forms, Create event or edition in Edit details, handover and availability facts. Tests added: `packages/rls-tests/test/crm-enquiry-list.rls.test.ts` (9, real PostgreSQL), `apps/web/src/app/(app)/sales/opportunities/page.test.tsx` (6), `apps/web/src/lib/crm/opportunity-scope.test.ts` (11), `lib/crm/events/edition-dates.test.ts` (10), `app/(app)/sales/opportunities/[id]/enquiry-guide.test.tsx` (20), and additions in `enquiry-list.test.ts` (3), `reports/page.test.tsx` (1), `handover/page.test.tsx` (2), `components/sales/event-edition-dialog.test.tsx` (3), `sales/new/inquiry-organisation-pickers.test.tsx` (3). Reference: `modules/sales-enquiries.md` sections 2, 3.5, 4.0, 4.1, 4.3; `modules/sales-close-and-handover.md` section 2.3; `modules/sales-reports.md`.
* **Chat (PR #73, merged as `296b74814b8851c08b20a73b19e82d5eecea167f`; migration applied on hosted V2 by the owner, owner-reported 7 of 7 verifier checks; Vercel Production not verified by Claude; status corrected 2026-11-10):** migration `20261225000100_chat_sales_groups.sql` (tables `chat_groups`, `chat_messages`, `chat_message_mentions`, `chat_read_state`, no privilege for signed-in users; five app functions `chat_my_groups`, `chat_group_members`, `chat_messages`, `chat_post`, `chat_mark_read` and six internal helpers; three Sales groups seeded and bound to the one active company of their country). Membership is computed from `crm_company_grants`; restricted shared items are resolved per reader. Owner pack: `supabase/manual-sql/chat_20_verify_readonly.sql`, `chat_90_rollback.sql`, `docs/chat-deployment.md`. Tests: `chat-sales-groups.rls.test.ts`, `model.test.ts`, `chat-launcher.test.tsx`, flow `chat-sales-groups-flow.mjs`.
* **JARVIS milestone 3 (PR #74, merged 2026-11-10 as `b7fc31e`; required CI green on head `6302a67`; Production: the owner confirmed it is serving the release. Memory migration `20261226000100`: applied by the owner on the hosted database the pilot uses; memory verifier rows 1 to 6 `OK` (preferences / pending suggestions `0 / 0`); JARVIS verifier every check `OK` (`enabled=true`, `writes_enabled=true`, one pilot user, one pilot company, one completed ledger action, proof key set). All owner-run and owner-reported on 2026-11-10; not independently verified by Claude. The counts do not establish who the pilot user and company are; see `docs/jarvis-deployment.md` "Release of PR #74". Not retested: the last two fixes (the Brief summary the live model writes, and a "here" follow-up keeping the current screen's guide) have automated coverage only and were not manually retested after their final changes):** migration `20261226000100_jarvis_memory_suggestions.sql` (tables `jarvis_preferences`: one row per person per preference, a CHECK allowing only the closed set of pairs; `jarvis_knowledge_suggestions`: suggested corrections for review; RLS on, no policy, no table privilege; functions `jarvis_pref_list`, `jarvis_pref_set`, `jarvis_pref_delete`, `jarvis_suggest_correction`, all `auth.uid()`-scoped and requiring `jarvis_my_access().is_available`). Owner pack `supabase/manual-sql/jarvis_memory_00_preflight_readonly.sql`, `_20_verify_readonly.sql`, `_30_suggestions_review_readonly.sql`, `_90_rollback.sql`. Tests: `packages/rls-tests/test/jarvis-memory.rls.test.ts` (13, real PostgreSQL: memory isolation and deletion, the closed set, suggestions, the overdue follow-ups read as two people with different company access, the pack and rollback); `apps/web/src/lib/jarvis/assistant-rules.test.ts` (rulebook, outbound gate, protected information, lookup scope, memory, knowledge publication), additions to `help-answer.test.ts`, `create-from-brief.test.ts` (one realistic brief), `classifier.test.ts` (routing) and `components/jarvis/jarvis-launcher.test.tsx`. The published guidance is generated from `docs/enginious-os/staff-guidance/` by `scripts/build-jarvis-knowledge.mjs` (`npm run build:jarvis-knowledge`; the web tests run its `--check`). Reference: `modules/jarvis.md` section 0, `modules/jarvis-rulebook.md`.
* **JARVIS Stages 2 to 4 (PR #77, merged 2026-11-11 as `720f785`; required CI green on head `3db3a1a`; signed-in Preview check owner-reported; no migration; Production smoke check owner-verified 2026-11-11 (owner-run, owner-reported: "Show my open enquiries" as the pilot user; company, count and links correct; not seen by Claude), Vercel deployment status not separately reported, see `docs/jarvis-deployment.md` "Release of PR #77"; nothing hosted changed by Claude):** Sales lookups, count-based summaries and scope wording read existing tables through the person's own session under the existing policies (`crm_has_access`, `crm_has_any_access`); explicit column lists with no financial column in `apps/web/src/lib/jarvis/sales/projection.ts`. Tests: `apps/web/src/lib/jarvis/sales-queries.test.ts` (routing, lookups, summaries, provider-bound requests with sentinels, the gate by origin, scope draft), `apps/web/src/components/jarvis/jarvis-launcher.test.tsx` (the three cards), `packages/rls-tests/test/jarvis-sales-queries.rls.test.ts` (the reads on a real PostgreSQL: columns, company isolation, revoked grant, exact count). Reference: `modules/jarvis.md` section 15.
* **Sales & CRM:** `crm`; **JARVIS:** `jarvis` (pilot controls, the atomic ledger-backed wrappers of every write action, ledger, concurrency, stale versions, usage limit, owner pack, rollback: `jarvis.rls.test.ts` and `jarvis-actions.rls.test.ts`; the confirmation boundary, every wrapper called directly with an invented, altered, expired or foreign proof, with the browser's review token in many arrangements, and the register-organisation acknowledgement omitted, changed or extra: `jarvis-proof.rls.test.ts`, with shared vectors for both derived keys and both artefacts in `supabase/tests/jarvis-proof-vectors.json`).
* **Projects:** `projects`, `project_block_notifies_pm`, `project_scope_decider`, `project_scope_decision_context`.
* **Inventory:** `inventory_stock`, `inventory_planning`, `inventory_counts`, `inventory_employees`, `inventory_employee_reserve_issue`, `inventory_shared`, `inventory_transfer_location`, `inventory_replay`, `inventory_disable`, `inventory_preservation`, `inventory_project_notes` (39 tests per `docs/launch-p3-deployment.md`), `inventory_cross_company_receiving`.
* **Budget:** `project_budget`, `pbx_waiting_and_pm_state`.

### C.3 Browser flows (`apps/web/os-shell-checks/`, local stack only, not in CI, write to the database they drive: reseed first)

| Script | What it proves | Seed |
|---|---|---|
| `sales-actions.mjs` | Real Sales operations end to end (create, stages, hold, links, proposal, Won and handover, reopen, reports) | `seed/sales.sh` |
| `sales-workspace.mjs`, `workflow-steps.mjs` | Simplified Sales workspace: follow-ups, table, board, side panel, Quick Add, authorisation edges | `seed/scenario.sh` |
| `projects-flow.mjs` | Projects end to end: handover, acceptance, team, tasks, plan, bookings, scope change, client timeline PDF, completion, reopen | `seed/base.sh` |
| `projects-workspace.mjs` | Projects directory, board, My Work, panels, isolation, revoked grants | `seed/scenario.sh` |
| `my-day-checks.mjs`, `my-day-coordination.mjs` | One greeting, People & HR below, each figure equals what that person's own session can read; read-only | `seed/my-day.sh` (`scenario.sh` plus Inventory) |
| `rollout-checks.mjs` | Row and card click rules, status cues, back links, phone stacked tables, no-access and not-found cards | `seed/my-day.sh` |
| `people-access-flow.mjs` | People & Access by role: founder presets, stale form, database refusal, access manager, last-manager protection, HR Admin edits | `seed/budget.sh` |
| `budget-flow.mjs` | Project Budget & Expenses flow (not described in the README; Unverified in detail) | `seed/budget.sh` |
| `inventory-workspace-flow.mjs`, `inventory-returns-and-links-flow.mjs` | Warehouse Today, request workspace Prepare, Send out, Receive back; partial dispatch and return; old links and QR addresses | `seed/inventory.sh` |
| `inventory-transfer-location-flow.mjs` | Location versus ownership: Dubai to Riyadh through Send, In transit, Receive | `seed/inventory.sh` |
| `inventory-flow-1` to `-5`, `inventory-project-notes-flow.mjs` | Stock to reconcile; employee issue; Sales checks; transfers, conflicts, time zones; access by person and direct PostgREST calls; dispatch notes with PDF and switch off | `seed/inventory.sh` (`RESEED=1`) |
| `inventory-smoke.mjs`, `inventory-a11y.mjs`, `a11y-states.mjs` | Screens open; keyboard, axe, and "could not load" never shown as empty (stops PostgREST) | `seed/inventory.sh` / scenario |
| `inventory-scan-camera.mjs` | Scanning with a SIMULATED camera (ffmpeg video), not a phone | `seed/inventory.sh` |
| `nav-smoke.mjs`, `shell-checks.mjs`, `phone-fit.mjs`, `overflow-audit.mjs`, `contrast-audit.mjs`, `page-survey.mjs`, `row-click.mjs` | Navigation per persona, 360/390 px fit, contrast, every page surveyed | local stack |
| `jarvis-flow.mjs` | JARVIS part 1 on the isolated stack with the SIMULATED provider: default OFF (no launcher), the documented SQL pilot switch, the launcher only for pilot people with a Sales grant, open/Escape/focus, "what can you do?", brief to review card to clarification to edit to confirmation (double click) to the real reference, a lost answer then "Checking the original result" (exactly one enquiry), a likely duplicate, refusals (payroll text, company moved out of the pilot, grant revoked after the review, write kill switch), JARVIS off again and ordinary Sales unchanged, a DIRECT platform-API call by an eligible pilot person with an invented proof refused for every write wrapper, and the review tokens lifted from the browser session refused as proofs by every wrapper; desktop and phone, light and dark screenshots | `seed/jarvis.sh` |
| `*screenshots*.mjs`, `inventory-concept-checks.mjs` | Screenshots; concept checks on fictional data, no database | none |

Seeds (`apps/web/os-shell-checks/seed/`): `base.sh` (Sales and Projects grants and one Won enquiry), `sales.sh`, `scenario.sh` (full sample scenario, runs `base.sh`), `inventory.sh` (runs `base.sh`), `budget.sh`, `my-day.sh`. Each resets the database; run exactly one before a check. Inventory and budget grants beyond the base personas were not enumerated here (Unverified).

### C.4 Playwright suites (not in CI)

* `packages/e2e-tests/tests/`: `read-only` (15 specs: smoke, rbac, isolation, auth, policies, payroll, assets, holidays, audit log, account security, mobile), `mutating` (7 specs: leave, attendance, clock, reimbursements, document upload, account status, audit verification), `recovery-windows` (4 specs), `local-stack/10-policy-activation-gate.spec.ts`, plus `baseline` and `reconcile` capture scripts. CI refuses to let the recovery-windows specs be part of a Production project (step "E2E project isolation").
* `packages/e2e-account-security/tests/`: `read-only`, `mutating`, `local-auth` (invitation, reset, access). Results and what they prove: `docs/people-access-account-controls-verification.md`.

### C.5 CI (`.github/workflows/ci.yml`; on push to main and on pull requests)

* Job `lint-typecheck-test` (Node 22): `npm ci`, Lint, Typecheck, Unit tests (`npm test`, runs domain and web vitest), Build `apps/web`, E2E project isolation check, Secrets audit (`npm run check:secrets`: service-role key never in the client bundle).
* Job `rls-policies`: Postgres 16 service, `npm run test:rls` (`RLS_TEST_ADMIN_URL` local).
* Not in CI: Playwright suites, `os-shell-checks`, `check:launch-batch`, any hosted check.

### C.6 The local stack and what it can and cannot prove

`packages/e2e-tests/local-stack` (`reset.sh`, `build-db.sh`, `seed.sql`, `gateway.mjs`, `local-auth.mjs`): a throwaway Postgres built from the migrations, PostgREST, and a gateway that **stands in for the auth server (NOT Supabase Auth)**: fixed local password, HS256 tokens, and in `local-auth.mjs` bans, sessions, invite and recover whose "e-mails" are written to `local_auth.outbox`.
* **Can prove:** the app's screens and server actions, RLS and function behaviour on real Postgres, the order of calls and the app's handling of each answer, and that the database (not the page) refuses wrong-role actions.
* **Cannot prove:** how hosted Supabase Auth behaves (e-mail delivery, link format and expiry, real ban and session revocation timing, token validity window), Vercel behaviour (asset and font loading, cron), real phones and cameras, hosted data shape.

### C.7 Seeded fictional personas (`packages/e2e-tests/local-stack/seed.sql`, local only)

| Email | Person | Role | Company |
|---|---|---|---|
| `hr1@e2e.local` | Hugo Drafter | HR Admin, unscoped (drafts policies) | Enginious Local AE |
| `hr@e2e.local` | Hana Resources | HR Admin, unscoped (second activator) | Local AE |
| `ceo@e2e.local` | Cleo Chief | CEO (company-scoped); founder in module seeds | Local AE (AED) |
| `mgr@e2e.local` | Max Manager | Line Manager (Sales manager and Project Manager in module seeds) | Local AE |
| `emp@e2e.local` | Eve Employee | Employee, managed by Max | Local AE |
| `admin@e2e.local` | Sam Sysadmin | System Administrator | Local AE |
| `lead@e2e.local` | Leo Lead | Employee, department head and project lead in the Projects seed | Local AE |
| `pol.exec@e2e.local` | Piotr Prezes | CEO grant for Poland (country scope) | Enginious Local PL (PLN) |
| `pol.worker@e2e.local` | Pola Pracownik | Employee, managed by Piotr | Local PL |

Module roles of these personas in the Sales, Projects and Budget seeds are as described in `apps/web/os-shell-checks/README.md`. Hosted tests used `hrtest.admin@enginious.ae` and one disposable `e2e-test-employee@enginious.ae` (per `docs/people-access-account-controls-verification.md`); do not reuse them as fixtures.

### C.8 Hosted and manual checklists

* `docs/launch-refinement-hosted-checklist.md`: before and after rows for the launch stack, scheduler baseline (Vercel cron and `pg_cron` recorded separately, nothing activated), and section D, what is not hosted-verified (issued timeline PDF asset loading; dispatch and return notes).
* `docs/people-access-hosted-test-runbook.md` and `docs/people-access-account-controls-verification.md`: hosted account test on Production 2026-10-27 after PR #50 (`217e566`): invitation e-mail arrived, first password and reset worked, an existing session was sent to sign-in on its next navigation, a fresh sign-in was refused while deactivated, reactivation worked, the disposable account was deleted, fingerprints before and after identical (12 real accounts, all Active). Owner-reported.
* `docs/projects-staff-test-checklist.md` (sections A to L, access to phones) and `docs/recovery-windows-staff-test-checklist.md` (A to F): staff acceptance lists. No result sheet is stored in the repo (Unverified whether staff completed them).
* `docs/inventory-location-review.md` with `supabase/manual-sql/inv_locations_review_readonly.sql`: read-only review of duplicate locations.

### C.9 Coverage gaps (do not read any of these as tested)

* Interrupted saves (connection lost mid-save, double submit under a dropped connection): no script covers them.
* A real phone: scanning, camera permission prompts, touch behaviour. Only emulated widths (360/390 px) and a synthetic camera were run.
* Real Supabase Auth: the local stack uses a stand-in. Hosted evidence covers only the observed items in C.8.
* Hosted e-mail: link expiry, content and landing place were not recorded; resend invitation, password reset ending another session, and the administrator-sent reset e-mail were not separately verified on Production.
* Token window: whether a deactivated account's already-issued token still reads data through the data API is unmeasured.
* Dispatch and return notes: verified locally only; no hosted run (switch off).
* The browser flow scripts were **not re-run on the final merged commit `551f615`** (they are local-only and manual); the last full-run commit is not recorded in this repo (Unverified).
* Broader user and security testing is planned separately and is **not done**.
* Deferred items have no hosted tests: scheduled jobs and the Recovery Leave scheduler (activation deferred by owner decision; hosted status `Unverified`).

## D. Current-state snapshot (at `551f615`)

* **Built and merged:** HR core, Recovery Leave windows (scheduler activation deferred by owner decision; hosted status `Unverified`), Sales & CRM, Projects & Tasks, Inventory (including cross-company receiving and location versus ownership), Project Budget & Expenses, People & Access with grant rules, My Day with the attention count, the launch-refinement correctness, usability and dispatch/return packages. Module detail in `01-overview-and-modules.md`.
* **Hosted (owner-reported):** launch migrations 1 to 15 applied and verified on V2; Production Ready at `551f615`.
* **Deferred or off:** dispatch and return notes switch OFF for every company; scheduled jobs (leave accrual, comp-day expiry, document expiry, balance discrepancy, recovery scheduler, Vercel crons) activation deferred by owner decision and not changed by this stack; hosted scheduler status `Unverified` (owner to check Vercel cron and `pg_cron` histories); `deact_30` unrun.
* **Known limits:** `docs/02-database-schema.md` is stale (A.8); browser flows are local only; hosted evidence is thin where listed in C.9; no staff checklist results are stored.
* **Open owner decisions:**
  1. Duplicate "Dubai" locations: run the read-only review and decide (`docs/inventory-location-review.md`, `supabase/manual-sql/inv_locations_review_readonly.sql`). Code cannot tell separate facilities from duplicates.
  2. Whether the current scope text may be shown to scope approvers who are not project members (the decision page shows only the proposed scope today; `docs/launch-p1d-deployment.md` line 42).
  3. Scheduled jobs: when and whether to activate (deferred; baseline in `docs/launch-refinement-hosted-checklist.md` section C).
  4. Switching dispatch and return notes on for a company (`inv_notes_30`), a separate decision after verification.
  5. `deact_30`: align deactivated accounts after review of the affected accounts.
  6. Cross-project expense copying: listed as an open owner decision in the hand-off; not described in any repo doc found. Unverified.
  7. A next-expiry line: likewise listed in the hand-off; no repo doc found. Unverified.
