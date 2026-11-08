# Sales: Reports

Status: written from the code at `main` `d4a9dc325dc669990e146ebb15eeb0cc3d2c11d4` (`../README.md` stamp row "Sales & CRM app map completed"). **Code read only; nothing was run.** Conventions as in `../README.md`; `Unverified` marks what code reading could not confirm. Route: `/sales/reports` (`apps/web/src/app/(app)/sales/reports/page.tsx`), menu entry "Reports" under Sales & CRM (`nav-groups.ts`). Calculations: `apps/web/src/lib/crm/reports.ts` (pure functions, no clock of their own: `now` is passed in), related test `apps/web/src/lib/crm/reports.test.ts` (assertions not re-read: `Unverified`). **There is no export, download or write action on this screen**: it is read-only, so it has no catalogue entry other than the read-only list in [`sales-action-catalogue.md`](./sales-action-catalogue.md).

## 1. Who sees what

Any Sales grant opens the page. Every figure is computed in the app from what the person's own session can read (`loadOpportunities`, `loadFollowUps`, then `crm_zoho_references` and `crm_closures` through the same session): row-level security limits each person to the companies they hold a grant for, so a person with a grant for one company sees only that company's figures, and nobody sees a figure for a company they have no grant for (`crm_has_access`, `20261115000100_crm_core_tables.sql`). There is no role-based hiding inside the page: **all open pipeline values, owners' names and won values are visible to every Sales grantee of the company** (values are described as "Visible to everyone with Sales access" on the edit form, `edit-details.tsx`). HR roles, Finance and CEO confer no Sales access (`sales/layout.tsx`).

## 2. Filters

| Control | What it does | Notes |
|---|---|---|
| From, To (dates, Dubai) | The report period. Default: the last 90 days ending today (Dubai). A reversed range is swapped (`resolvePeriod`) | The period applies to Won and lost (by closing date: `closed_at`, else `stage_changed_at`), Enquiries by source and Timeliness (by the date the enquiry was logged), the reopened-closures note and Won value. **It does not apply** to Open pipeline and Follow-ups (as of now) |
| Company (only with grants for more than one company) | "All companies" or one | Filters enquiries and follow-ups; Timeliness lists each company on its own |
| Apply / Reset | GET form to `/sales/reports`; Reset is shown when the period or company differs from the default | The address keeps the choice |

## 3. Report cards: definitions and sources

| Card | What it shows | Definition (function) | Source rows |
|---|---|---|---|
| Open pipeline by stage | Count and per-currency value of open enquiries in each of the six working stages plus On hold. Each currency on its own line, never added together; "No value recorded" when none carry a value | `openPipelineByStage` (open = not Won and not Lost) | `crm_opportunities` (`value`, `currency`, `stage`) |
| Open pipeline by owner | Same, per owner (person's name) | `openPipelineByOwner` | same |
| Follow-ups | Overdue, Due today, Upcoming (open follow-ups only; done and cancelled ignored), by Dubai day | `followUpCounts` | `crm_follow_ups` (open, newest 1000 loaded; follow-ups on an account with no enquiry are included in the count because they are loaded with the follow-ups) |
| Timeliness | Per company: the share of enquiries logged in the period answered within the company's first-response target in **working hours**, with median working hours and how many are still inside the target. A company without BOTH a response target and a working calendar reads "Not configured. <reason>. Only elapsed times are shown." Below it: "Elapsed time to first response": median clock hours, answered, awaiting | `timelinessByCompany`, `elapsedFirstResponse` | `crm_opportunities.first_response_at` (set by the first logged call, email or meeting, `crm_add_activity`), `crm_company_settings.response_target_hours` and `working_calendar` (Sales settings) |
| Won and lost | Won, Lost and Win rate for enquiries **closed** in the period. Won counts only a Won stage **with an evidence reference recorded** ("won with no evidence recorded, not counted as won" is shown separately); win rate = won as a share of won plus lost (shows "n/a" when none closed). Closures that were later reopened are not counted as outcomes and are reported in a separate sentence | `wonLostInPeriod`, `reopenedClosures`, `isCommerciallyWon` (`packages/domain`) | `crm_opportunities`; `crm_closures` rows with `reopened_at` (up to 5000) |
| Lost reasons | Lost reasons in the period with counts; "No reason recorded" when blank | `wonLostInPeriod` | `crm_opportunities.lost_reason` |
| Enquiries by source | Enquiries logged in the period per source (the stored source value, grouped case-insensitively; the card shows the stored id such as `agency_call`, not the friendly label) | `enquiriesBySource` | `crm_opportunities.source`, `created_at` |
| Won value | Commercially won in the period, per currency | `wonLostInPeriod.wonValue` | `crm_opportunities.value` at the time of reading (not `crm_closures.value_at_close`) |
| Won value against invoice and payment references | One row per won enquiry in the period: title, reference (link), won value, invoice reference and date, payment date and amount. A sentence counts how many have an invoice reference and how many a payment date. **These are references typed in by hand** on each enquiry's Commercial tab, not read from Zoho Books, and may be out of date | `wonValueRows`, `zohoSummary` | `crm_zoho_references` (up to 5000 rows) |

Every card shows its own "n = ..." line with how many records it rests on. Money is never added across currencies (`CurrencyTotals`, `currencyLines`).

## 4. Failed reads and limits

| Situation | What the page does |
|---|---|
| Enquiries or follow-ups cannot be read | A destructive alert "Could not load the reports. Reload the page; if it keeps happening, tell an administrator." and no figures |
| Zoho references cannot be read | An alert "Could not load the Zoho references." above the table; the other cards still show |
| `crm_closures` read fails | **No message.** The reopened-closures read ignores the error (`const { data } = ...`), so the note "N closures were later reopened" would silently show nothing and the Won / Lost counts are unaffected (see section 6) |
| No enquiries at all | "Not enough data yet" with a New enquiry link |
| 2000 or more enquiries | Warning "Only the newest 2,000 opportunities are included, so older figures may be incomplete." (`loadOpportunities` caps at 2000, newest first) |
| Reports for a person with no grant | The layout shows the access notice; the page does not render |

## 5. Reports elsewhere that count Sales data

My Day "Sales pipeline" widget and counts (`lib/my-day/attention.ts`, `lib/crm/my-day.ts`), the Clients & Agencies directory and its export Summary sheet (`sales-clients-and-agencies.md` sections 4 and 8) are separate and documented in their own files (`../02-screens-and-navigation.md`).

## 6. Observations (reported, not changed)

1. The Enquiries by source card prints the stored source id (for example `agency_call`, `website`) because `enquiriesBySource` groups on `o.source` and the page prints `s.source` without `crmSourceLabel`; the enquiry list prints friendly labels. Cosmetic inconsistency; a code comment on the function still says "free text as entered".
2. The `crm_closures` read in `reports/page.tsx` ignores its error (no "could not load").
3. Won value uses the enquiry's current `value`; a founder's later value edit on a Won enquiry therefore changes past figures (the closure keeps `value_at_close`, which the card does not use).
