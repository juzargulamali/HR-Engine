# Sales: Reports

Status: written from the code at `main` `d4a9dc325dc669990e146ebb15eeb0cc3d2c11d4` (`../README.md` stamp row "Sales & CRM app map completed"). **Code read only; nothing was run**, except the 2026-11-08 fixes of this screen (failed reads per card, readable source names; PR #68, merged as `ca3e4483ce4745e359ddb3377b52748175f3881f`), covered by `reports/page.test.tsx`, `reports.test.ts` and the local-stack walk-through `os-shell-checks/sales-crm-readiness-flow.mjs`. Conventions as in `../README.md`; `Unverified` marks what code reading could not confirm. Route: `/sales/reports` (`apps/web/src/app/(app)/sales/reports/page.tsx`), menu entry "Reports" under Sales & CRM (`nav-groups.ts`). Calculations: `apps/web/src/lib/crm/reports.ts` (pure functions, no clock of their own: `now` is passed in), related test `apps/web/src/lib/crm/reports.test.ts` (assertions not re-read: `Unverified`). **There is no export, download or write action on this screen**: it is read-only, so it has no catalogue entry other than the read-only list in [`sales-action-catalogue.md`](./sales-action-catalogue.md).

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
| **How the reports are read** (2026-11-11, Sales employee launch, branch `claude/admiring-cray-uky379`; no migration; not seen signed-in) | The enquiries are read completely (page by page) with the chosen **company applied in the database**; before this they were built from the newest rows one request returned (at most 1,000). The Zoho references are read only for the won enquiries in view; the reopened-closures note is read completely and now follows the chosen company too (it used to count every company). Definitions are unchanged: Won and Lost by closure date in the period, Won needs evidence, currencies never added together. A failed read still shows on its own card ("Could not load"), and no figure without the enquiries | `loadOpportunities(ctx, { company })`, `readForIds`, `readPaged` (`reports/page.tsx`) | `reports/page.test.tsx` (1 added: the company reaches the database for the enquiries and the closures) |
| Open pipeline by stage | Count and per-currency value of open enquiries in each of the seven working stages (Estimate sent next to Proposal sent, since 2026-11-11) plus On hold. Won and Lost reporting is unchanged: it counts closures, not stages passed through (`reports.test.ts` "the Estimate sent stage in reports"). Each currency on its own line, never added together; "No value recorded" when none carry a value | `openPipelineByStage` (open = not Won and not Lost) | `crm_opportunities` (`value`, `currency`, `stage`) |
| Open pipeline by owner | Same, per owner (person's name) | `openPipelineByOwner` | same |
| Follow-ups | Overdue, Due today, Upcoming (open follow-ups only; done and cancelled ignored), by Dubai day | `followUpCounts` | `crm_follow_ups` (open, newest 1000 loaded; follow-ups on an account with no enquiry are included in the count because they are loaded with the follow-ups) |
| Timeliness | Per company: the share of enquiries logged in the period answered within the company's first-response target in **working hours**, with median working hours and how many are still inside the target. A company without BOTH a response target and a working calendar reads "Not configured. <reason>. Only elapsed times are shown." Below it: "Elapsed time to first response": median clock hours, answered, awaiting | `timelinessByCompany`, `elapsedFirstResponse` | `crm_opportunities.first_response_at` (set by the first logged call, email or meeting, `crm_add_activity`), `crm_company_settings.response_target_hours` and `working_calendar` (Sales settings) |
| Won and lost | Won, Lost and Win rate for enquiries **closed** in the period. Won counts only a Won stage **with an evidence reference recorded** ("won with no evidence recorded, not counted as won" is shown separately); win rate = won as a share of won plus lost (shows "n/a" when none closed). Closures that were later reopened are not counted as outcomes and are reported in a separate sentence | `wonLostInPeriod`, `reopenedClosures`, `isCommerciallyWon` (`packages/domain`) | `crm_opportunities`; `crm_closures` rows with `reopened_at` (up to 5000) |
| Lost reasons | Lost reasons in the period with counts; "No reason recorded" when blank | `wonLostInPeriod` | `crm_opportunities.lost_reason` |
| Enquiries by source | Enquiries logged in the period per source (shown by its **readable name**: the stored source id is turned into its label with `crmSourceLabel`, for example `agency_call` shows "Agency call (outbound)"; free text from older records stays as entered; an id and its label are grouped together, case-insensitively) | `enquiriesBySource` | `crm_opportunities.source`, `created_at` |
| Won value | Commercially won in the period, per currency | `wonLostInPeriod.wonValue` | `crm_opportunities.value` at the time of reading (not `crm_closures.value_at_close`) |
| Won value against invoice and payment references | One row per won enquiry in the period: title, reference (link), won value, invoice reference and date, payment date and amount. A sentence counts how many have an invoice reference and how many a payment date. **These are references typed in by hand** on each enquiry's Commercial tab, not read from Zoho Books, and may be out of date | `wonValueRows`, `zohoSummary` | `crm_zoho_references` (up to 5000 rows) |

Every card shows its own "n = ..." line with how many records it rests on. Money is never added across currencies (`CurrencyTotals`, `currencyLines`).

## 4. Failed reads and limits

| Situation | What the page does |
|---|---|
| Enquiries cannot be read | "Could not load the reports ... No figure is shown because the enquiries they are built from could not be read. This is not a report with zero results." with Try again (keeps the period and company) and no figures |
| Follow-ups cannot be read (the enquiries could) | Only the **Follow-ups card** says "Could not load the follow-up counts ... not zero"; the other cards show |
| Zoho references cannot be read (there are won enquiries in view) | The "Won value against invoice and payment references" card says "Could not load the invoice and payment references" (no table, no "0 of N have an invoice reference", no "Not recorded" cells); the Won value card still shows the value |
| `crm_closures` read fails | The "Won and lost" card says "Could not load the count of closures that were later reopened"; the won and lost figures do not depend on it |
| Any of the three above | A report-level notice "This report is incomplete. Could not load: ..." naming the cards, so the page never reads as complete. The header sentence "Each figure says how many records it rests on" stays true: a card that failed shows no figure |
| No enquiries at all | "Not enough data yet" with a New enquiry link |
| 2000 or more enquiries | Warning "Only the newest 2,000 opportunities are included, so older figures may be incomplete." (`loadOpportunities` caps at 2000, newest first) |
| Reports for a person with no grant | The layout shows the access notice; the page does not render |

## 5. Reports elsewhere that count Sales data

My Day "Sales pipeline" widget and counts (`lib/my-day/attention.ts`, `lib/crm/my-day.ts`), the Clients & Agencies directory and its export Summary sheet (`sales-clients-and-agencies.md` sections 4 and 8) are separate and documented in their own files (`../02-screens-and-navigation.md`).

## 6. Observations

1. **Fixed (PR #68, merged as `ca3e4483ce4745e359ddb3377b52748175f3881f`):** the Enquiries by source card printed the stored source id; it now prints the readable name.
2. **Fixed (same branch):** the `crm_closures` read ignored its error; also `loadFollowUps` (shared with the Follow-ups page) ignored the errors of its enquiry and organisation reads and would silently drop follow-ups: both now fail the read (the Reports Follow-ups card and the Follow-ups page say "Could not load"). The ignored closures read is on the **Won and lost** card (the reopened-closures sentence), not on the source card.
3. Won value uses the enquiry's current `value`; a founder's later value edit on a Won enquiry therefore changes past figures (the closure keeps `value_at_close`, which the card does not use).
