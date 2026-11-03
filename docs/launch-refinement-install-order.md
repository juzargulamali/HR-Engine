# Launch refinement: the one installation order (packages 1, 2 and 3)

**Nothing here has been run on any hosted project.** This page is the single list; the per-package guides (`docs/launch-p1b-deployment.md`, `launch-p1c`, `launch-p1d`, `launch-p2`, `launch-p3`) explain each change and agree with it. If a guide and this page ever differ, this page wins and the guide is a bug.

**Prerequisites.** The stack is three pull requests in order: package 1 (#53) is merged first, then package 2 (#54), then package 3 (#55). Apply the migrations **in file-name order** (the timestamps sort in install order across all three). A migration may be skipped only if the module it belongs to is not in use; nothing else may be reordered. Every migration is additive and idempotent (safe to run twice) and **none inserts or edits existing rows** (they replace functions and add objects; the one new column, #14's switch, is added as false for every company).

For each migration use the same five steps from its owner pack in `supabase/manual-sql/` (`<prefix>_00_preflight_readonly.sql`, `_05_preservation_check_readonly.sql`, apply, `_20_verify_readonly.sql`, then `_05` again for the compare); rollback is `<prefix>_90_rollback.sql`. All of those are read-only except the rollback, which restores the earlier function definitions.

| # | Migration (`supabase/migrations/`) | Owner pack prefix | Package | Needs |
|---|---|---|---|---|
| 1 | `20261216000100_inv_issue_to_employee_consumes_reservation.sql` | `inv_emp_issue` | 1b (A7) | Inventory |
| 2 | `20261216000200_proj_scope_proposal_notifies_deciders.sql` | `proj_scope_notify` | 1b (A11) | Projects |
| 3 | `20261216000300_account_deactivation_inactive_people.sql` | `deact` | 1c (A12) | |
| 4 | `20261216000400_profiles_status_columns_restricted.sql` | `profstat` | 1c (A13) | |
| 5 | `20261216000500_attendance_lead_candidates.sql` | `leadpick` | 1c (A14) | |
| 6 | `20261216000600_recovery_decider_inbox.sql` | `reccard` | 1c (A15) | |
| 7 | `20261216000700_policy_status_role_check.sql` | `polstat` | 1c (A16) | |
| 8 | `20261216000800_letters_storage_issued_only.sql` | `letters` | 1c (A17) | |
| 9 | `20261216000810_approval_routing_country_scope.sql` | `apprscope` | 1d | #3 (`user_is_active`) |
| 10 | `20261216000820_proj_scope_decision_context.sql` | `scopectx` | 1d | Projects |
| 11 | `20261216000830_pbx_decisions_waiting_count.sql` | `pbxwait` | 1d | Project budgets |
| 12 | `20261216000900_proj_block_task_notifies_pm.sql` | `blocknotify` | 2 | Projects |
| 13 | `20261216000910_module_access_managers.sql` | `modaccess` | 2 | the modules' access tables |
| 14 | `20261217000100_inv_project_notes.sql` | `inv_notes` | 3 | Inventory, Projects |

Fourteen migrations (11 in package 1, 2 in package 2, 1 in package 3). The latest migration before this stack is `20261215000000_access_grant_rules.sql`.

## The only files that write data (all optional, all owner-run, none run by this work)

| File | What it does | State |
|---|---|---|
| `deact_30_align_deactivated_accounts_OPTIONAL_writes.sql` | sets the active flag for accounts deactivated before #3 | **UNRUN. Owner decision; skipping it breaks nothing.** |
| `inv_notes_30_switch_one_company_OPTIONAL_writes.sql` | switches dispatch notes on for **one** company (the switch is off for every company after #14) | **NOT run.** Owner-run only, after #14 is verified. |
| `inv_notes_80_switch_off_writes.sql` | switches dispatch notes off again for every company | Not run. The safe first response to any note problem. |

Everything else in the packs is read-only SQL. The scheduled-job activation is deferred and is not part of this stack.

## How this order was checked (reproducible)

```bash
# 1. file names strictly increasing, no duplicate timestamps, the 14 above are the only ones from 20261216 on
ls supabase/migrations | sort -c && ls supabase/migrations | cut -c1-14 | sort | uniq -d   # prints nothing
ls supabase/migrations | awk '$0>="20261216"' | wc -l                                         # 14
# 2. every launch migration is named in a package guide, and every .sql a guide names exists
# 3. a throwaway database built from every migration (packages/e2e-tests/local-stack/build-db.sh scratch_db),
#    then the 14 applied again twice with ON_ERROR_STOP: clean, then each owner pack's *_20_verify_readonly.sql
#    ends "OK ... 0 failing" (14, 11, 49, 9, 7, 8, 9, 3, 14, 11, 7, 12, 11, 77 checks, in the table's order)
```
