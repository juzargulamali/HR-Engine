# Sales & CRM (Stage B) — deployment guide

This is the owner's runbook for the first working module of ENGINIOUS OS: **Sales & CRM**. It is written so you can run it
step by step in the Supabase SQL Editor of **Enginious HR Engine_V2** (the only project to use) and then decide when to merge.

**Nothing in this change runs Production SQL, imports data, merges, deploys, enables email, or contacts a client.** The pull
request is a draft. Every step below is yours to run, in this order, and each step has a check before the next one.

> **Honest status.** Verified locally: unit tests, real-PostgreSQL/RLS tests (PostgreSQL 16 **and** 17), lint, typecheck and a
> production build. **Not verified live:** nothing has run against your hosted Supabase project, Vercel, Microsoft 365 email or
> real people. Section 9 lists what to try yourself and what still needs a real day of use.

---

## 1. What this adds (and what it leaves alone)

| | |
|---|---|
| **Added** | A **Sales & CRM** area in the existing app (`/sales`): overview, opportunities, pipeline, follow-ups, proposals, clients, reports, settings, access. Seventeen new `crm_*` tables, controlled database functions, a private file bucket, a daily reminder job. |
| **Not touched** | Every HR table, policy, function, calculation, approval route and page. Attendance, Recovery Leave, leave, expenses, payroll and appraisals behave exactly as before. No HR role is created, changed or consulted. |
| **Separate access** | Sales access is its own table (`crm_company_grants`), **per company**. An HR admin, CEO or sys admin with no Sales grant sees nothing in Sales, and a Sales grant gives no HR access. Founders (Juzar, Rafi) grant access inside the app (Sales → Access). |
| **Future modules** | Projects & Tasks, Inventory, Vendors & Purchasing and Performance & KPIs appear in the menu as **Coming soon** (not links), only for people who have Sales access. |

## 2. Decisions built in (from your 2026-10-17 brief)

1. **Shared pipeline.** Everyone granted Sales for a company sees all opportunities of that company; a person granted two companies sees both. **Juzar/Rafi** (founders) assign and reassign owners; only the owner or a founder changes stage/value or closes an opportunity. A founder can delegate *assign owner* or *confirm availability* to someone.
2. **Existing companies, no duplicates.** The migration inserts **no company**. It seeds a Sales settings row only for an existing active company when it is the only active one in its country: `AE → UAE / AED`, `SA → KSA / SAR`, `PL → PL / EUR`. A country with two active companies is **not** guessed — a founder sets it in Sales → Settings. Any other quotation currency is allowed per opportunity.
3. **Equipment availability** is a dated check by someone a founder delegated (not a stock reservation, not commercial confirmation) and needs repeating if dates, technologies or quantities change. **Sales sees values and budgets.** **Files:** private uploads plus links, validated on the server (type, size, and the file's own bytes); **executables and macro-enabled files are refused** (and refused again by the database and the storage bucket).
4. **Duplicates** are a warning, never a block, and never triggered by a shared agency or client alone (title, dates, location and technologies are weighed too).
5. **Reminders are in-app first.** Owner emails exist but are **off** until you switch them on (§8). **No message is ever sent to a client.**
6. **Not configured stays "not configured".** Response-time KPIs need a target **and** a working calendar (both blank today → "Not configured"). **Commercial approval policy defaults to "not configured": nothing can be requested or approved**, and the screens never show approval as granted unless a founder recorded it.
7. **HR preserved.** No HR file is changed other than the shared menu (a Sales group and a Coming-soon group, shown only to people with Sales access) and the layout's access check.

## 3. Files

- `supabase/migrations/20261115000000_crm_access_audit_settings.sql` — grants, capabilities, CRM audit log, settings (+ seeding).
- `supabase/migrations/20261115000100_crm_core_tables.sql` — organisations, contacts, opportunities, follow-ups, activities, files, proposals, approvals, handover, reminders (read-only to clients).
- `supabase/migrations/20261115000200_crm_workflow_functions.sql` — create, edit, stage moves, hold/resume, won/lost, owner assignment, follow-ups.
- `supabase/migrations/20261115000300_crm_proposals_files_reminders.sql` — files, proposals, Zoho references, availability, approval (unconfigured), handover, reminders, `crm-files` bucket, people pickers.
- `supabase/manual-sql/crm_00_preflight_readonly.sql`, `crm_20_verify_readonly.sql` (read-only), `crm_30_bootstrap_founders.sql` (writes grants only), `crm_90_rollback.sql` (back-out; refuses while data exists).
- Application: `apps/web/src/app/(app)/sales/**`, `lib/crm/**`, `lib/actions/crm*.ts`, the `/api/cron/crm-reminders` route (04:00 UTC daily), domain logic in `packages/domain/src/crm*.ts`, tests.

## 4. Before you start (nothing is changed by these)

1. Confirm the Vercel project's Supabase variables point at **Enginious HR Engine_V2** (the recovery-windows guide §3 explains the fingerprint check; it applies unchanged).
2. If your Supabase plan offers backups/point-in-time recovery, note the time you start. The CRM migrations are **additive** (new tables/functions only) and `crm_90_rollback.sql` backs them out, so a backup is a comfort, not a requirement.
3. Decide the two founder logins (Juzar, Rafi). The preflight lists active CEO/CTO users to help.

## 5. The exact sequence (V2, by hand)

Run each file in the Supabase SQL Editor of **Enginious HR Engine_V2**, **the whole file, one at a time**, and stop at the first red result.

| Step | File | Kind | What you check afterwards |
|---|---|---|---|
| 1 | `supabase/manual-sql/crm_00_preflight_readonly.sql` | read-only | Section B all `OK`; section C `OK - no CRM tables…`; section D shows your companies and what will be seeded; section G `OK`. **Send me the result before step 2.** If something is not OK, stop. |
| 2 | `supabase/migrations/20261115000000_crm_access_audit_settings.sql` | writes | "Success". |
| 3 | `supabase/migrations/20261115000100_crm_core_tables.sql` | writes | "Success". |
| 4 | `supabase/migrations/20261115000200_crm_workflow_functions.sql` | writes | "Success". |
| 5 | `supabase/migrations/20261115000300_crm_proposals_files_reminders.sql` | writes | "Success". |
| 6 | `supabase/manual-sql/crm_20_verify_readonly.sql` | read-only | **Every row `PASS`** (rows 12–14 may read INFO only after someone changed settings). Compare section `I HR row counts` of step 1 — HR numbers must be identical. |
| 7 | `supabase/manual-sql/crm_30_bootstrap_founders.sql` | writes grants only | Edit the two emails first (it refuses placeholders). The final table lists the founders per company. Run step 6 again: row 19 stays `PASS`. |
| 8 | Merge the PR and let Vercel deploy | your decision | Only after steps 1–7 are green. |

If a migration fails partway: the files use `create … if not exists` / `create or replace`, so re-running the same file after fixing the cause is safe. To abandon the install entirely, §10.

## 6. Environment and hosting notes

- **Nothing new is required** for in-app reminders. The existing `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are used (the service role signs file links and runs the reminder job; it is never sent to a browser).
- `vercel.json` adds one daily cron (`/api/cron/crm-reminders`, 04:00 UTC = 08:00 Dubai). On the current Vercel plan a cron may run at most once a day, so reminders are also generated, throttled to once per 5 minutes, when anyone opens **Sales → Overview**. Email retries therefore happen on each daily run until a more frequent scheduler exists.
- `proxy.ts` lets **only** `/api/cron/crm-reminders` past the sign-in redirect (the route returns 401 without `CRON_SECRET`). **Finding for you, not changed here:** the older routes (`/api/cron/leave-accrual`, `comp-day-expiry`, `document-expiry`, `/api/ai/detect-balance-discrepancies`, `recovery-windows`) are still redirected to `/login` by the same proxy when called with no session, which is how Vercel calls them. Locally, a request to `/api/cron/leave-accrual` with a valid `Authorization: Bearer` header answers `307 → /login`. Please check Vercel → Cron Jobs → run history for those routes; if they show redirects, they have not been running, and exempting them is a separate decision for you because it would make the monthly/daily HR jobs start running.
- `next.config.ts` raises the server-action body limit to 21 MB so 20 MB uploads reach the server-side checks. This also applies to the existing upload forms, which keep their own 10 MB limit.
- No paid service, no new project, no credential change.

## 7. Smoke test after deploy (about 20 minutes, with test staff accounts only)

| Try this | Expected |
|---|---|
| Sign in as an HR admin or CEO **without** a Sales grant | No "Sales" menu item. Opening `/sales` shows "You do not have Sales access". |
| Sign in as Juzar/Rafi → Sales → Access → give a colleague Sales for **one** company | They see only that company's opportunities. Give them a second company: they now see both. Revoke: it disappears immediately. |
| Sales → Settings | Reference codes/currencies as in the preflight forecast. Response target, calendar blank → Reports shows "Not configured". Approval policy shows "not configured" with an explanation. |
| New enquiry with only an agency selected | Saves (owner = you, with a next action). Enter a similar one again → a "may be the same enquiry" warning that can be dismissed; a different brief from the same agency shows no warning. |
| As a non-owner colleague, open someone else's opportunity | Visible; no move/close/edit buttons. As Juzar/Rafi: reassign the owner; the old owner's open follow-ups move too. |
| Complete the only follow-up | The dialog insists on a next action or putting it on hold (reason + review date). |
| Upload a PDF; then try `a.exe`, `b.xlsm`, `c.exe.pdf` | PDF accepted (private; opens through a short-lived link). The others are refused with a plain message. |
| Try to request commercial approval | Refused: "rules are not configured". Nothing shows as approved. |
| Mark one test opportunity Won | Needs PO/authorised-email reference + date and a value; open follow-ups are cancelled; the handover page appears. |
| HR pages (leave, attendance, payroll…) | Unchanged. |

## 8. Turning on owner emails (later, deliberately)

Reminders appear in-app first. To enable emails: (1) confirm the Microsoft Graph variables already used by leave notifications are set; (2) set `CRM_REMINDER_FROM_EMAIL` (the mailbox the reminders are sent from) and `CRM_REMINDER_EMAILS=on` in Vercel; (3) in **Sales → Settings** tick *Owner emails* for **one** company only; (4) create a test follow-up due in the past for a test owner and call `/api/cron/crm-reminders` with the cron secret (or wait for 04:00 UTC); (5) check: the email arrives **once**; calling the route again sends **nothing more** (dedupe); with the mailbox deliberately wrong the row shows `failed` and is retried on the next run with backoff, stopping after 5 attempts; completing the follow-up stops its emails. Only then enable the other companies. Emails go only to the owner/assignee, never to a client.

## 9. What is and is not verified

- **Verified here:** the database rules (105+ real-Postgres tests on PostgreSQL 16 and 17: company scoping, HR separation, owner/founder rules, stage rules, hold/won/lost evidence, ownership, follow-up rules, availability recheck, approval never granted while unconfigured, file rules, reminders idempotency/retry, privileges), the domain logic, the menu, lint, typecheck, build.
- **Also verified locally, in a real browser:** the real app against a real PostgreSQL + PostgREST (the repository's local full stack: it enforces the real RLS policies, but it is **not** Supabase Auth or Storage). A founder created organisations, an enquiry, completed the only follow-up (forced to add a next action), moved stages, held and resumed, recorded availability (and saw "needs recheck" logic), added a link (http refused), saved a Zoho quote reference, closed as Won with a PO, opened the handover, and reminders appeared on the overview and from the cron route; a colleague saw the pipeline with no action buttons; an HR admin and a plain employee with no grant saw "You do not have Sales access" and no menu item. That run found and fixed one real bug (an untouched technologies row blocked saving).
- **Not verified live:** your Supabase project, Storage signing, Microsoft 365 delivery, Vercel cron, the screens against real data and real staff. The smoke test in §7 is the first live check.
- **Still your decisions:** commercial approval rules; response-time targets and the working calendar; who gets which capability; the Project Manager list when Projects arrives.

## 10. Rollback

1. Deploy the previous app version (the Sales menu disappears by itself when the tables are absent).
2. If no business data exists yet, run `supabase/manual-sql/crm_90_rollback.sql`. It **refuses** while opportunities, organisations, contacts, files, proposals or follow-ups exist (export first, then deliberately change one flag) and while the bucket contains files (empty it in the Storage UI first). It never touches an HR object.
3. Run `crm_00_preflight_readonly.sql` again: section C must show "no CRM tables or functions exist yet".
