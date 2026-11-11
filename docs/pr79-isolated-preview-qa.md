# PR #79: Preview QA on an isolated Supabase test project (owner runbook)

**Why this exists.** The Vercel Preview of PR #79 uses the same Supabase database as Production (owner-reported, 2026-11-11). PR #79 needs two migrations (install-order rows 24 and 25) and its QA creates records, so it must not be tested there. The signed-in browser stack could not be run in the build session (running the downloaded data-service binary is refused there), so the browser QA needs a place of its own: a new, empty Supabase project that only this PR's Preview points at.

**Status: prepared, not carried out.** Claude has no Supabase or Vercel access and created nothing. Every step below is the owner's. Whether the whole migration chain applies to a brand-new hosted project from empty is `Unverified` (it applies from empty on a plain local PostgreSQL 16 with the test stubs, which is how the local QA below was run).

Nothing here touches the Production project. Do not copy any Production data into the test project.

## 1. Create the test project (about 15 minutes)

1. In Supabase, create a **new project** (any name that says it is a test, for example "enginious-pr79-qa"). Keep its URL, its anon key and its service-role key.
2. Apply the schema: from a checkout of the branch `claude/events-first-edition-calendar`, link the Supabase CLI to the **new** project (check the project ref twice) and push the migrations. They run in file-name order and include rows 24 and 25.

```bash
supabase link --project-ref <the NEW test project's ref>
```

```bash
supabase db push
```

   If a migration stops with an error, do not work around it: send the file name and the message.
3. Authentication, Users, **Add user** (twice), each with a password you choose and "Auto Confirm User" on:
   `qa.founder@enginious-qa.example` and `qa.sales@enginious-qa.example`. These addresses are fictional; no e-mail is sent to them.
4. SQL editor of the **test** project: run `supabase/manual-sql/qa_isolated_project_seed_fictional.sql`. It stops, changing nothing, if the database already has a company (so it cannot seed a database that is in use) or if the two sign-ins are missing. Expect: 1 company, 2 employees, 2 Sales grants (1 founder), Sales settings 1, and `0 / 0 / 0`.
5. Read-only checks in the same editor; every numbered check must say OK:
   `crm_event_first_edition_20_verify_readonly.sql` (rows 1 to 4), `crm_estimate_sent_20_verify_readonly.sql` (rows 1 to 10), `jarvis_20_verify_readonly.sql`.

## 2. Point only this PR's Preview at it

In Vercel, project `hr-engine-web`, Settings, Environment Variables: add these for the **Preview** environment, **limited to the branch `claude/events-first-edition-calendar`** (the branch field), so Production and every other Preview keep their values:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the test project's URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the test project's anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | the test project's service-role key |

Leave everything else as it is. Do not add JARVIS, reminder e-mail or Microsoft variables for this branch: JARVIS stays off in the test project and nothing is sent. Then **redeploy** the branch's latest Preview (the two `NEXT_PUBLIC_` values are read when the app is built). If sign-in redirects to the wrong address, set the test project's Authentication, URL configuration, Site URL to the Preview address.

Proof you are on the test project before you click anything: signed in as `qa.sales@enginious-qa.example`, Sales, Enquiries is empty and the company is "Fictional QA Events LLC".

## 3. The browser checks (fictional records only)

Signed in as `qa.sales@enginious-qa.example` unless stated.

| # | Do | Expect |
|---|---|---|
| 1 | Sales, Events & Exhibitions, **Add event**: "Fictional Cross Show", Exhibition, 30 March 2027 to 2 April 2027, Riyadh, SA. Save once | The event opens with that edition selected. One event, one edition |
| 2 | Add event again with the same name | The form shows the existing event and offers to add an edition to it; no second event |
| 3 | Add event "Fictional Orphan" with the end date before the start date | Refused in words; the event list has no "Fictional Orphan" |
| 4 | On the event page, **Add next edition**: 28 to 31 March 2028 | A second edition; the first keeps its dates |
| 5 | Add enquiry (Quick Add): type a title, a next action, event dates and a brief; in Event / Exhibition type "Fictional Tech Week", press **Create event or edition**, save the new event | Back on the enquiry form with every field as typed and the new edition selected; no enquiry saved yet. Then save the enquiry |
| 6 | Repeat 5 on the full New enquiry page; once press Cancel in the event form, once cause a refusal (duplicate name) | The draft is unchanged both times |
| 7 | Events & Exhibitions, **Calendar**, go to March 2027, then Next | "Fictional Cross Show" on 30 and 31 March, and on 1 and 2 April; choosing it opens the 2027 edition. Check on a phone too |
| 8 | On a new enquiry at Qualified: Estimates tab, create and finalise an estimate | No "Sent to client" badge; Move stage lists Estimate sent with "Record an estimate as sent first" |
| 9 | **Record estimate as sent** on that revision, keep "Move the enquiry to Estimate sent" ticked | Badge "Sent to client <date>" on that exact revision; the enquiry is at Estimate sent; the timeline names the reference and revision |
| 10 | On another enquiry: move it to Negotiation (it needs a Zoho quote reference at Quote sent), then finalise an estimate and record it as sent | No move is offered; a line says the stage stays; afterwards the enquiry is still at **Negotiation** and the revision shows the badge |
| 11 | As `qa.founder@...`: open the Board | Ten lanes, Estimate sent next to Proposal sent |

## 4. Afterwards

Remove the three branch-limited variables in Vercel (or leave them until the PR is merged), and pause or delete the test project. The Production project still needs migrations 24 and 25 applied by the owner before the merged app's new actions work there (`docs/launch-refinement-install-order.md` rows 24 and 25).

## 5. What was already checked without a browser (2026-11-11, local, fictional data)

On a disposable local PostgreSQL 16 built from every migration plus the local test seed, by Claude:

* Both preflights passed; migrations 24 and 25 applied (25 applied twice in the automated test: idempotent); `crm_event_first_edition_20_verify_readonly.sql` rows 1 to 4 OK; `crm_estimate_sent_20_verify_readonly.sql` rows 1 to 10 OK; `jarvis_20_verify_readonly.sql` 70 of 70 checks OK before and after (its 4 other lines are informational).
* As a signed-in ordinary Sales user, through the same database functions the screens call: an event and its first edition in one call; a refused edition and a duplicate name left one event, one edition and no orphan; a later edition on the same event; an enquiry linked to it; the edition 30 March to 2 April 2027 falls on 30 and 31 March and 1 and 2 April; a draft estimate refused; finalising recorded nothing; at Negotiation the move was refused and the record alone was made, the record's revision id equal to the estimate's, the stage still Negotiation, the estimate's proposal row still `draft`, the timeline line carrying the revision; an estimate-first enquiry moved from Qualified to Estimate sent.
* The seed file above: refused on a database with companies, refused without the two sign-ins, seeded once on an empty database, refused on a second run.

**Not checked by anyone yet:** every row of section 3 in a real browser, signed in.
