# PR #79: owner-run rollout on the existing Supabase project (short)

**Context (owner decision, 2026-11-11).** The Vercel Preview of PR #79 and Production share one Supabase project. The owner applies migrations 24 and 25 there and runs the signed-in checks; Claude runs no hosted SQL and has no signed-in access. An isolated test project was considered and dropped. Everything below marked "expect" is what a pass looks like; hosted results are owner-reported once sent.

## 1. Hosted SQL, in this order (SQL editor of the project)

| # | File | Kind | Expect |
|---|---|---|---|
| 1 | `supabase/manual-sql/crm_event_first_edition_00_preflight_readonly.sql` | read-only | rows 1 to 3 `OK`; row 4 `not installed yet`; row 5 is a count |
| 2 | `supabase/migrations/20261227000100_crm_event_first_edition.sql` | **changes the database** (adds one function) | "Success. No rows returned" |
| 3 | `supabase/manual-sql/crm_event_first_edition_20_verify_readonly.sql` | read-only | rows 1 to 4 `OK`; row 5 is a count |
| 4 | `supabase/manual-sql/crm_estimate_sent_00_preflight_readonly.sql` | read-only | rows 1 to 5 `OK`; row 6 `not installed yet`; rows 7 to 9 are counts |
| 5 | `supabase/migrations/20261228000100_crm_estimate_sent_stage.sql` | **changes the database** | "Success. No rows returned" |
| 6 | `supabase/manual-sql/crm_estimate_sent_20_verify_readonly.sql` | read-only | rows 1 to 10 `OK`; row 11 `0 / 0` |
| 7 | `supabase/manual-sql/jarvis_20_verify_readonly.sql` | read-only | every check `OK`; the `INFORMATION` lines show the pilot as it is now (they are not checks) |

Stop at the first row that does not say what is expected and send it. Any `STOP` in a preflight means do not apply the migration. Both migrations are idempotent, but there is no reason to run one twice.

**Safe with the app Production runs today (before #79 is deployed):** migration 24 only adds a function the current app never calls. Migration 25 leaves the six existing stages, their order, their gates and JARVIS's moves as they are. **One rule until Production has #79: do not move any enquiry to Estimate sent from the Preview.** The current Production app does not know that stage and would show such an enquiry with the raw name `estimate_sent`, in the first lane of the board.

Rollback, if ever needed: `crm_event_first_edition_90_rollback.sql` (drops the function, deletes nothing); `crm_estimate_sent_90_rollback.sql` (stops while any enquiry is at Estimate sent; deletes the estimate-sent records, export `crm_estimate_sends` first).

## 2. Preview checks (after step 7; signed in on the PR #79 Preview; three checks, clearly labelled records)

Every record name starts with `QA #79` so it can be found and archived.

| # | Do | Expect |
|---|---|---|
| A | Sales, Events & Exhibitions, **Add event**: name `QA #79 Cross Show`, type Exhibition, 30 March 2027 to 2 April 2027, city `QA`, save once | The event page opens with the 2027 edition selected; the list shows one `QA #79 Cross Show` edition |
| B | **Add enquiry** (Quick Add): type a title `QA #79 draft`, a next action, and under more details an event start and end and a brief. In Event / Exhibition type `QA #79 Cross Show 2028`, press **Create event or edition**. The form opens with that text and your dates. Change the name to `QA #79 Cross Show`: it shows the existing event; press **Add an edition to QA #79 Cross Show**, set 28 to 31 March 2028, save | Back on the enquiry form: title, next action, dates and brief exactly as typed, and Event / Exhibition shows `QA #79 Cross Show · 2028 · ...` selected. **Then close the form without saving the enquiry**: no enquiry is created, and the 2028 edition exists on the event page |
| C | Events & Exhibitions, **Calendar**; go to March 2027, then **Next** | `QA #79 Cross Show` on 30 and 31 March, and on 1 and 2 April; choosing the name opens the 2027 edition (not 2028). **Today** returns to the current month |

Not in this small test (covered by the automated tests): a refused save leaving no orphan event; the full New enquiry page; the phone layout.

**Clean up after A to C:** open `QA #79 Cross Show` and press **Archive** (the archive button in the header; the person who added it or a founder). The event and both editions stay in history, disappear from the default list and calendar, and are no longer offered when linking an enquiry. Nothing can be deleted from the screen. No enquiry or organisation was created by A to C.

## 3. After the Preview checks pass and Production serves #79 (the owner asks for the merge; merge commit; required CI green on the exact head)

One check in Production, as the pilot user or any Sales owner:

| # | Do | Expect |
|---|---|---|
| D1 | Add an enquiry `QA #79 estimate test` for a fictional organisation (reuse an existing test organisation if there is one; otherwise add `QA #79 Fictional Client`). Move it to Qualified | Move stage lists **Estimate sent** with "Record an estimate as sent first (Estimates tab)" and it cannot be chosen |
| D2 | Estimates tab: create an estimate, fill currency, VAT, bill-to and one item, **finalise** | The revision shows Finalised; **no** "Sent to client" badge; the enquiry is still at Qualified |
| D3 | **Record estimate as sent** on that revision: keep today's date and leave "Move the enquiry to Estimate sent" ticked | The row shows `Sent to client <date>` on **that** reference and revision; the enquiry is at **Estimate sent**; Activity & history has "Estimate <reference> revision 1 recorded as sent to the client on <date>" and "Stage changed from Qualified to Estimate sent" |
| D4 (optional, read-only SQL) | `select s.reference, s.revision, s.sent_on, s.proposal_id = q.proposal_id as same_revision, q.issued_at is not null as finalised from crm_estimate_sends s join crm_quotations q on q.proposal_id = s.proposal_id order by s.recorded_at desc limit 1;` | One row: the reference and revision of D3, `same_revision` true, `finalised` true |

**Clean up after D:** the app has no delete for an enquiry, an estimate or an organisation. Mark the enquiry **Lost** with the reason "QA #79 test record" (it then counts as one Lost enquiry in Reports for that period, and its `EST-` number stays used), and rename the organisation, if you created one, so it reads as a test entry. If true removal is wanted, ask for a cleanup SQL: none is provided here because it has not been written or tested.

## 4. What was verified before this (not on hosted)

Required CI on the PR head; the automated tests; and, on a disposable local PostgreSQL built from every migration: the two preflights, both migrations, both verifiers and the JARVIS verifier (70 of 70 checks, before and after), plus A, B (the database part), C (the dates) and D through the same database functions as a signed-in ordinary Sales user. **Not verified by anyone yet:** A to D in a browser, and the hosted database.
