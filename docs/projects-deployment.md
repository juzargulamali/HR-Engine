# Projects & Tasks (Release 2) — deployment guide

This is the owner's runbook for **Projects & Tasks**, the second module of ENGINIOUS OS. It is written so you can run it step by
step in the Supabase SQL Editor of **Enginious HR Engine_V2** (the only project to use) and then decide when to merge.

**Nothing in this change runs Production SQL, creates Production data, grants anyone real access, merges, deploys, enables a
scheduled job, sends e-mail, or contacts a client.** The pull request is a draft. Every step below is yours to run, in this
order, and each step has a check before the next one. Design and decisions: [projects-design.md](./projects-design.md).

> **Honest status.** Verified locally: unit tests, real-PostgreSQL/RLS tests, lint, typecheck, a production build, and real-browser
> checks against a **throwaway local database** (see §9 for exactly what). **Not verified live:** nothing has run against your hosted
> Supabase project, Supabase Storage (the local stack has none, so the real upload path is untested end to end), Vercel, or real
> people. §9 lists what to try yourself and what still needs a real working week.

---

## 1. What this adds (and what it leaves alone)

| | |
|---|---|
| **Added** | A **Projects & Tasks** area in the existing app (`/projects`): directory, My Work, calendars, handovers, per-project Overview, Milestones & tasks, Timelines & site, Calendar, People, Discussion, Feedback & changes, Documents (incl. client timeline PDF), History, completion. Thirty-two new `proj_*` tables, controlled database functions, two private storage buckets. |
| **Not touched** | Every HR table, policy, function, calculation, approval route and page; every Sales table and function; the legacy `projects` and `project_allocations` tables (and their reimbursement/timesheet references). Attendance, Recovery Leave, leave, expenses, payroll and appraisals behave exactly as before. |
| **Separate access** | Projects access is its own table (`proj_company_grants`), **per company**, independent of HR roles and of Sales grants. People without it do not see the module. Founders grant access inside the app (Projects → Access). |
| **Shell change** | The "Projects & Tasks — Coming soon" menu entry becomes a real module shown only to people with Projects access (or a Sales relationship to a project). One light query in the app layout reads the person's own grants; it degrades to "no access" if the tables do not exist yet. |
| **Sales page** | The opportunity's Handover page gains a "Project handover" panel below the existing CRM handover (which is unchanged). |

## 2. Decisions built in (see decisions 30–41 in `08-decisions-log.md`)

Separate `proj_` tables; own capability grants; three data tiers (summary / member-only / restricted) in different tables; no commercial
data copied into Projects; a recorded Sales relationship (CRM ownership changes never alter it); exactly-one-project idempotent
acceptance and a frozen handover snapshot; revocable membership that cuts every path at once; project roles never touch HR;
dates as plain dates and site events in the site's time zone; site-conflict rules (physical bookings only, allowances included,
override with reason, hidden projects never named); immutable issued client timelines (issued ≠ sent ≠ accepted); completion needs
client evidence and explicit handling of unfinished work; in-app notifications and modest polling only.

## 3. Files

- `supabase/migrations/20261120000000_proj_access_audit.sql` — capabilities, grants, audit log, settings, people pickers.
- `…000100_proj_core_tables.sql` — projects, details, members, teams, Sales links, handovers, milestones, deliverables, tasks, history; visibility helpers; RLS (SELECT only).
- `…000200_proj_projects_handover_functions.sql` — handover (prepare, submit, assign PM, clarify, accept, withdraw), internal projects, PM and temporary leadership, status, members, teams.
- `…000300_proj_delivery_functions.sql` — milestones, deliverables, tasks (review, blocking, dependencies, history).
- `…000400_proj_plans_site_calendar_discussion.sql` — timelines, external dependencies, site bookings, calendars, discussion, notifications.
- `…000500_proj_feedback_plans_files_completion.sql` — feedback and scope changes, issued client timelines, files (quarantine flow), completion and reopening, the two buckets.
- `supabase/manual-sql/proj_00_preflight_readonly.sql`, `proj_05_preservation_check_readonly.sql`, `proj_20_verify_readonly.sql` (read-only), `proj_30_bootstrap_founders.sql` (writes grants only), `proj_80_safe_disable_and_restore.sql`, `proj_90_rollback.sql`.
- Application: `apps/web/src/app/(app)/projects/**`, `lib/projects/**`, `lib/actions/projects*.ts`, `components/projects/**`, domain logic in `packages/domain/src/proj*.ts`, `project*.ts`, tests.

## 4. Before you start (nothing here changes anything)

1. **Sales & CRM must already be installed** (migrations `20261115000000`–`300` and their verification), because Sales-link visibility
   and the handover use it. The public privilege hardening (`20261114000000`) should be applied too.
2. Run `proj_00_preflight_readonly.sql` in the SQL Editor of V2. Every row in section **B** must say OK, section **C** must say "no
   Projects tables or functions exist yet", section **G** must say neither bucket exists. Section **D** shows the reference code each
   company will get (copied from its Sales settings; a company with no Sales settings needs a founder to set one in Projects → Access).
3. Run `proj_05_preservation_check_readonly.sql` unchanged ("snapshot" mode). Keep the whole result and the **paste** column; it
   fingerprints everything that is not a `proj_` object (HR, Sales and the legacy projects tables).

## 5. The exact ordered sequence

| Step | What | Check |
|---|---|---|
| 1 | Preflight (§4.2) and snapshot (§4.3) | All OK; paste lines saved |
| 2 | Run, **one at a time and in this order**, the six migration files in `supabase/migrations/` named `20261120000000_…` to `20261120000500_…` | Each ends without an error |
| 3 | `proj_20_verify_readonly.sql` | Every row **PASS** (the last row is information) |
| 4 | `proj_05_preservation_check_readonly.sql` in "compare" mode (paste the saved lines where it says) | Summary says **PASS: nothing HR, Sales or the legacy projects own changed** |
| 5 | Merge the pull request when you are ready; Vercel deploys the app | The app opens; **people without Projects access see no Projects menu** |
| 6 | Edit the emails in `proj_30_bootstrap_founders.sql`, run it | It lists the founders it granted. **This is the step that gives real people access.** |
| 7 | In the app: Projects → Access (founder) to grant people access; set a company's reference code if it has none | See §7 |

If a company has no Projects reference code, no project can be created for it (nothing is guessed). Sales's existing codes are copied
only for companies that already have Sales settings.

## 6. HR and Sales preservation checks

- **Structure and history:** step 4 above. It proves no table, column, constraint, index, policy, function, trigger, view, enum,
  privilege or storage rule outside `proj_*` changed, and that every HR/Sales row that existed at the snapshot still exists
  (append-only ledgers and both audit logs are checked by content).
- **Row counts:** compare section **I** of the preflight with the same section after the install. They must be identical except
  `notifications`, which only grows when people use Projects.
- **Behaviour:** the repository's HR and Sales test suites run unchanged in CI (see §9). Project assignment never creates attendance,
  awards Recovery Leave, changes `manager_id`, or reads an HR table: verify check 14/15 scan every `proj_` function for that.

## 7. Setting it up in the app (simple instructions)

**Founders (Projects → Access).** Choose the company, pick a person, tick nothing for plain *Projects access* (the directory), or tick
capabilities: *Assign Project Managers*, *Manage access*, *Decide scope changes*, *See commercial effects*, *Read the audit trail*,
*Reopen completed projects*, *Confirm overlapping site bookings*. Only a founder can give founder or manage-access rights. Everyone who
should be a PM, department head or team member needs at least plain access first.

**Founders / PM assigners.** *Projects → Handovers*: when Sales submits a handover, pick the Project Manager. *New internal project*: name, owner, priority, ongoing or finite.

**Project Managers.** Accept the handover (or ask Sales to clarify). Then, in the project: **People** (add members, create department teams with a head, appoint temporary leadership), **Milestones & tasks** (milestones, deliverables per department), **Timelines & site** (use the suggested timelines or your own; book people on site; record external dependencies), **Documents** (issue the client timeline once client-facing items are marked), **Feedback & changes**, and finally **Complete project** with the client's confirmation.

**Department heads.** In *Milestones & tasks*, distribute tasks to your team, review tasks that need review, accept your team's deliverables.

**Everyone else.** *My Work* shows your tasks, reviews waiting for you and notifications; update your tasks, comment, and use the project's **Discussion**.

**Sales.** On an opportunity's *Handover* page: prepare the delivery brief (**no prices, budgets or PO details**), submit it, answer the PM's clarification if asked. You then see that project's summary and handover status only; the PM can add you as a member if you should take part.

## 8. Switching off and rolling back

- **Pause without losing anything (preferred):** `proj_80_safe_disable_and_restore.sql` revokes every active Projects grant (marked
  `SAFE-DISABLE <time>`); the menu disappears, every page and function refuses, members lose access at once. Nothing is deleted. Section 2 of the
  file restores exactly those grants. Sales relationships are separate: they lapse with Sales access.
- **Full back-out:** `proj_90_rollback.sql` removes every Projects table, function and the two bucket records, and nothing else.
  **Limitation once data exists:** it refuses to run while any project, handover, task, message, file, plan, milestone, completion
  or booking exists; after you export that data and set the flag, **the history (handover snapshots, issued client timelines, completion
  evidence, discussion) is destroyed for good.** Empty both buckets in the Storage UI first. Project notifications are removed from the shared table.
- **App side:** deploying the previous app version hides the module (the tables being absent also produces a plain "not installed" notice).
- The legacy `projects` / `project_allocations` tables are never changed, so an expense claim's project reference is unaffected by any of this.

## 9. What was tested, and what was not

See the table at the end of the pull request description for the test counts of the final commit. In summary:

| Layer | Tested locally | Not tested |
|---|---|---|
| Database (real PostgreSQL 16, every migration applied in order, Supabase-style default grants) | Company isolation, three data tiers by direct table access, Sales link rules, handover (idempotent and concurrent acceptance, frozen snapshot, no commercial data), membership/revocation/temporary leadership, department heads, task review/dependency/date/history rules, calendars (privacy, time zones, DST, date-only deadlines), site overlaps (allowances, override, hidden projects, concurrent confirmation), discussion (membership, retries, mentions, tombstones, notifications), scope changes and restricted cost data, issued timelines (immutability, outdated, issued/sent/accepted), files (validation, no client policies), completion/reopening, internal projects, privilege hygiene, HR and Sales unchanged | PostgreSQL 17 (run it if you want); behaviour under real production data volume |
| Owner SQL | Preflight, preservation check (snapshot/compare), verify, bootstrap (refuses placeholders), safe disable/restore, rollback (refuses with data, idempotent), all rehearsed on a throwaway Supabase-shaped database | Running them on V2 (yours to do) |
| Application | Typecheck, lint, unit tests, production build; real browser against the local full stack (throwaway DB + PostgREST + local sign-in) with the personas of §10, desktop and phone, dark and light | Hosted Supabase Auth and **Storage** (private upload through the quarantine bucket is covered by database tests and unit tests, not end to end), the Vercel preview, real users, real e-mail (none is sent) |

## 10. Environment and schedulers

**No new environment variable, no new scheduled job, no new e-mail.** The upload flow reuses the existing server-side Supabase service
key (already required by Sales). `proj_expire_upload_intents()` exists for a future housekeeping run but nothing calls it. Deadline reminders and
e-mail are deliberately not built; adding them needs a scheduled route and your separate authorisation (see `05-automation-rules.md` §5.1b).

## 11. Known limitations

- Discussion updates by polling (about every 8 s while the tab is visible), not push; it shows the latest 100 messages.
- No deadline reminders or overdue digests (by decision); notifications appear in My Work only.
- Completed or archived projects are read-only for everything except reopening.
- A removed member's earlier discussion messages stay (author name kept); their project notifications are deleted.
- Sales people's names in the Sales-relationship list are shown only to founders and PM assigners (others see "Sales colleague").
- Uploads need Supabase Storage and the service key on the host; abandoned uploads are not swept automatically.
- Timeline bars are a secondary view: the table is always the primary, accessible form.
