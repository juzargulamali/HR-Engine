# Sales: Settings (per company)

Status: written from the code at `main` `d4a9dc325dc669990e146ebb15eeb0cc3d2c11d4` (`../README.md` stamp row "Sales & CRM app map completed"). **Code read only; nothing was run** (except the 2026-11-08 hint text fix, covered by `settings-form.test.tsx`). Conventions as in `../README.md`; `Unverified` marks what code reading could not confirm. Route: `/sales/settings` (`apps/web/src/app/(app)/sales/settings/page.tsx`, `settings-form.tsx`, `quotation-defaults.tsx`). The VAT-choice control is also described, in the estimate context, in [`sales-estimates-and-quotations.md`](./sales-estimates-and-quotations.md) section 2.3; issuer branding is on Admin, Companies (same file, section 2.4). Catalogue entries: [`sales-action-catalogue.md`](./sales-action-catalogue.md).

## 1. Reaching the screen and who may change what

* Menu: Manage > Settings (and the phone tab strip) appears only for a person who holds the `manage_settings` capability for some company or is a Sales founder (`nav-groups.ts`, `sales/layout.tsx`: `hasCrmCapability(..., "manage_settings") || isAnyCrmFounder`). Typing the address without that still opens the page, but each company card is read-only ("You can read these settings but not change them").
* The page lists every company the person holds a Sales grant for, one settings card and one "Estimates" card each. A company with no settings row shows "Not set up yet" and a warning: "Enquiries cannot be recorded for a company until its reference code and default currency are set."
* Who may change: a company's card is editable for a Sales founder or the `manage_settings` capability for that company (`editable()` in `page.tsx`; database: `crm_upsert_settings` requires `crm_has_capability(company, 'manage_settings')`, `20261115000000_crm_access_audit_settings.sql`). **The approval policy is a separate right**: only `manage_approval_rules` (founder implies it) may change it; people without it see the policy as text and the form omits the field, so saving other settings leaves the stored policy untouched (`SettingsForm` `canEditApproval`; function: a non-null policy needs `manage_approval_rules`, else "Not allowed to change the commercial approval policy").
* Who may grant Sales access (a different screen): People & Access (`/people-access`), not this page; a line on this page links to it for holders of `manage_access`. Out of scope here (`../03-roles-access-and-approvals.md`).

## 2. Company settings form (`saveCrmSettings` -> `crm_upsert_settings`)

Catalogue: `sales.settings.save_company`. One form per company, one submit; the values are upserted into one row of `crm_company_settings` (`updated_by` is the person, the audit trigger logs it in the Sales audit trail). **Changing a setting affects only that company and takes effect on the next read; there is no preview or undo, and the old values are not kept except in the audit log.**

| Field | What it does and where it is used | Validation | Behind it |
|---|---|---|---|
| Reference code | 2 to 5 capital letters, **unique across companies**. Used in every new enquiry reference `OPP-<code>-<year>-<number>` (`crm_create_opportunity`) and estimate reference (`EST-<code>-...`, `crm_quote_create`). Changing it changes only references issued afterwards; existing references are not rewritten. The field hint on the page now shows "for example OPP-UAE-2026-0042 (the OPP- prefix is added for you)" (it used to omit the prefix; see section 6) | `/^[A-Z]{2,5}$/` (form and database check `crm_company_settings_code_format`); unique index `uq_crm_company_settings_code` | `settingsSchema` (`crm.ts`) |
| Default quote currency | Three-letter code that new enquiries start with (any enquiry can use another) | `/^[A-Z]{3}$/` | same |
| First-response target (working hours) | Used by the Timeliness card in Reports. Blank = "Not configured" | whole number 1 or more | same |
| Working days, Working day starts, Working day ends (Dubai time), Holidays | The working calendar used for response-time figures and for the "next working day" suggested for a next step. Stored only when days AND start AND end are all given; otherwise "Not configured". Holidays are dates `YYYY-MM-DD` separated by commas or spaces and only count with a calendar | The form refuses a partial calendar and holidays without a calendar; end must be after start; every holiday must be a date | `saveCrmSettings`, `parseWorkingCalendar` (`packages/domain`) |
| Duplicate window (days) | How far back a new enquiry is compared with earlier ones for the "may be the same enquiry" warning | 1 to 1095, default 180 | `crm_find_duplicate_candidates` reads it |
| Also email follow-up reminders to the opportunity owner | The company switch for owner e-mails. **Both this tick and the environment switches `CRM_REMINDER_EMAILS=on` and `CRM_REMINDER_FROM_EMAIL` must be on for any e-mail to leave** (`lib/crm/reminders.ts`); emails go out only with the daily run (cron `0 4 * * *` UTC = about 08:00 Dubai, `vercel.json`); a failed send retries on later runs. Hosted state and whether the schedule is active: `Unverified` (owner decision, `../README.md`) | boolean | `crm_company_settings.owner_email_enabled` |
| Commercial approval policy (Not configured, Not required, Required) and Note | Decides whether commercial approval can be requested and decided ([`sales-proposals-and-zoho.md`](./sales-proposals-and-zoho.md) section 2.2) and whether a finalised estimate needs a founder's approval of its exact content (`crm_quote_issue`). Default Not configured: nothing can be approved | Only the three values; policy needs `manage_approval_rules` | `crm_upsert_settings` |
| Save settings / Set up Sales for this company | Submits; the form keeps what was typed when a save is refused. Success: "Settings saved for <company>." | Refusals in words: "Not allowed to change CRM settings for this company", "Unknown or inactive company", "Reference code: 2 to 5 capital letters" | `saveCrmSettings` |

Read-only view (people without the right): the same values as a list, including the working calendar in words, plus "Last changed <date> by <person>". Failed read: the company list, settings and people come from `getCrmContext`; if they cannot be read the whole Sales layout says "Sales & CRM could not load" (`ctx.loadFailed`), never an empty or default form. The page's own read of `companies.default_currency` (used to prefill the currency of a company without settings) and of the VAT choices: the currency read ignores its error (an empty prefill); the VAT read shows "Could not load the estimate defaults" (`LoadError`).

## 3. Estimates card: VAT choices (`quotation-defaults.tsx`, `saveVatChoice` -> `crm_save_vat_choice`)

Catalogue: `sales.settings.save_vat_choice`. Per company, the list of VAT treatments Sales may pick on an estimate. Seeded for every company (existing and new, trigger `companies_quote_seed`, `20261220000100_crm_estimates_quotations.sql`): Out of scope (no VAT shown), 0%, 5%, 15%, 23%. A choice already used on an estimate keeps its copied label and rate there. The screen only **adds** a rate (Name up to 60 characters, Rate in percent); the database function can also edit and hide a choice (`p_id`, `p_active`) but **no screen exposes that** (`sales-estimates-and-quotations.md` section 3). Who: Sales founder or `manage_settings` ("Not allowed to change Sales settings for this company"). A hidden choice shows "hidden from the list" and is no longer offered.

## 4. Things that are NOT in Sales settings

| Item | Where it actually lives |
|---|---|
| Pipeline stages | Fixed in code and the database check: `CRM_STAGES` (`packages/domain/src/crmStages.ts`), `crm_opportunities.stage` check. Not editable |
| Enquiry sources | Fixed: `CRM_SOURCES` and the `source` check |
| Lost reasons, hold reasons, evidence types | Fixed lists `CRM_LOST_REASONS`, `CRM_HOLD_REASONS`, `CRM_EVIDENCE_TYPES` (same file) |
| Follow-up types | Fixed enum (`call, email, meeting, proposal, other`) |
| Standard terms template for estimates | **Removed from the editor.** The table `crm_quote_terms_templates` and function `crm_save_terms_template` still exist, seeded per company, but no app code calls `crm_save_terms_template` and estimates print no standard terms (grep at this commit; `sales-estimates-and-quotations.md` section 2.3). Current state therefore: stored, unused, unreachable from any screen |
| Estimate issuer details and logo (legal name, TRN, address, contacts, logo) | Admin > Companies, System Administrator only (`sales-estimates-and-quotations.md` section 2.4); catalogue `sales.company.save_issuer_details`, `sales.company.upload_logo` |
| Who has Sales access and capabilities | People & Access (`/people-access`), `crm_grant_access` / `crm_revoke_access` (`20261215000000_access_grant_rules.sql`); not catalogued here |
| Reminder e-mail environment switches | Environment variables `CRM_REMINDER_EMAILS`, `CRM_REMINDER_FROM_EMAIL` (hosted values `Unverified`) |
| Calendar and holiday data for My Day | Not Sales settings |

## 5. Tests

`apps/web/src/lib/actions/crm.test.ts` (settings parsing and refusal paths were not re-read: `Unverified`), RLS `packages/rls-tests/test/crm.rls.test.ts` ("settings need the manage_settings capability" is cited by the Estimates reference for the VAT function: `sales-estimates-and-quotations.md` section 2.3), `crm-quotations.rls.test.ts`. Not run in this pass.

## 6. Observations (reported, not changed)

1. **Fixed (PR #68, merged as `ca3e4483ce4745e359ddb3377b52748175f3881f`):** the Reference code hint said "for example UAE-2026-0042" while `crm_create_opportunity` builds `OPP-<code>-<year>-<4 digits>` (`format('OPP-%s-%s-%s', ...)`, `20261115000200_crm_workflow_functions.sql`, the only place an enquiry reference is built). The hint now says "for example OPP-UAE-2026-0042 (the OPP- prefix is added for you)". Only the text changed: the generator and the stored references are untouched (RLS test `crm-sales-write-rules.rls.test.ts` asserts a new reference matches `^OPP-UAE-\d{4}-\d{4}$`; `settings-form.test.tsx` asserts the hint).
2. The settings page reads `companies.default_currency` without checking its error (`page.tsx`), so a failed read only means an empty prefill for a company without settings.
3. `crm_save_terms_template` and the terms table remain installed with no caller (kept deliberately per the Estimates reference).

## 7. Sales & CRM upgrade (2026-11-14; draft PR #96, not merged; code read at `d016c28`)

Status, four facts kept apart: merged: no (draft PR #96). Required CI: has not run on a head. Hosted database: no migration and no SQL in this change. Production: not deployed. Unit tests: the full web suite passed locally at `d016c28` (356 files, 4,006 tests; reported by the builders, not re-run by the documentation author). Written from the code; how a screen looks or behaves in a browser is `Unverified (local browser pass in progress)`.

Layout, wording and guards only. `saveCrmSettings` -> `crm_upsert_settings` and `saveVatChoice` -> `crm_save_vat_choice` are unchanged, and so is who may change what (section 1). Where sections 2 and 3 differ from this section on layout, this section wins.

| Point | Behaviour | Source |
|---|---|---|
| One company at a time | The page shows ONE company's settings: the company in the address (`?company=<id>`), else the active Sales company (`sales-enquiries.md` section 9.1). With several companies and none to assume: "Choose a company above to see its Sales settings." Other companies that have no Sales settings yet are named with a link, so they are not missed | `pickSalesCompany`, `CompanySwitch` (`sales/settings/page.tsx`) |
| Blockers first | A list at the top of what the missing settings stop, each with a jump link: **Reference code and default currency are not set** (enquiries cannot be recorded and estimates cannot be numbered); **Commercial approval is not decided** (nobody can request or give an approval); **No VAT choice is in use** (an estimate cannot be issued). A missing response target or working calendar is not a blocker: it is shown on its own section as "Not configured". A person who cannot edit sees "See the setting" and whom to ask | `settingsBlockers` (`settings/blockers.ts`; each line cites the database refusal it restates); `blockers.test.ts` |
| Three groups | **Response targets** (first-response target, working days and hours in Dubai time, holidays, the e-mail reminder switch), **Commercial approval** (the policy and its note), **Estimates & VAT** (reference code, default quote currency, duplicate window), with the **VAT choices for <company>** block right below, which saves each choice as it is added. There is no fourth "Enquiries" group (open owner decision 18) | `SECTION`, `SECTION_NAME` (`settings-form.tsx`), `quotation-defaults.tsx` |
| Per-section save wording | Each section has its own save button and marks "Changes not saved yet". The save still writes the whole settings row in one call, so the button says so: "Also saves your changes under <other sections>."; before any settings exist: "The first save writes every section of this page together." A failed save: "Not saved for <company>. ... What you typed is still here: correct it and save again." | `settings-form.tsx` |
| Checks before saving | Working days, start and end must be given together or all left empty; holidays count only once the calendar is set | `settings-form.tsx` (`setClientError`) |
| Unsaved warning | Choosing another company or following any link with unsaved edits asks first | `settings-form.tsx` |
| Read-only view | "You can read these settings but not change them. Ask a founder, or someone allowed to manage Sales settings, to change them." | `page.tsx` |

Tests: `sales/settings/page.test.tsx`, `settings-form.test.tsx`, `blockers.test.ts`.

**Known risk at `d016c28`, `Unverified`:** the server page imports the constants `APPROVAL_POLICY_LABEL` and `APPROVAL_POLICY_EXPLANATION` from `settings-form.tsx`, a client file; in the real app a server page may not be able to read values exported from a client file, so the read-only view may fail there although the unit tests pass. At the time of writing QA held an uncommitted fix that moves them to a plain file (`settings/approval-policy.ts`); it is not part of `d016c28`.

## 8. Follow-up time zone (2026-11-15; draft PR from `claude/pr2-sales-ops-projects-handover`, not merged; CI not yet run; hosted SQL not applied; Production not deployed)

Source: `apps/web/src/app/(app)/sales/settings/{page.tsx,time-zone-form.tsx}`; `apps/web/src/lib/actions/crm.ts` (`setFollowUpTimeZone`); `supabase/migrations/20270113000500_crm_follow_up_time_zone.sql`. Tests: `packages/rls-tests/test/crm-follow-up-time-zone.rls.test.ts`; `apps/web/src/lib/crm/time-zone.test.tsx`.

| Control (label) | Who | What it does | Function | Failure |
|---|---|---|---|---|
| Panel **Follow-up time zone for <company>**: select **Time zone**, button **Save time zone** | People who may change that company's Sales settings (`manage_settings` or founder), once the company has settings | Sets the clock the company's follow-up deadlines are typed and shown on. The list is the common zones plus the company's own; names only | `setFollowUpTimeZone` -> `crm_set_follow_up_time_zone(company, zone)` (not `crm_upsert_settings`, which is unchanged and keeps the value) | Not allowed: "Not allowed to change CRM settings for this company"; an offset or unknown name: "Choose a time zone by its name, for example Asia/Dubai or Europe/Warsaw"; a database without the setting: the panel says the zone cannot be changed yet |
| Row **Follow-up time zone** in the read-only view | Anyone with Sales access to the company | "Europe/Warsaw (Warsaw time)" | reads `crm_company_settings.follow_up_time_zone` | |

Saving moves no deadline: each keeps its exact moment and is then shown on the new clock (a deadline saved as 11:00 Dubai reads 08:00 Warsaw in winter). The form says so and asks to tell the team first. The change is in the Sales audit log through the table's existing trigger. The working calendar ("Working day starts (Dubai time)") is a separate setting and is unchanged. Coverage row 105; catalogue `sales.settings.set_follow_up_time_zone`.

**Defaults and what still runs on the Dubai clock (owner decision, 2026-11-15).** The migration sets each existing company's zone once from its country code: UAE Asia/Dubai, Saudi Arabia Asia/Riyadh, Poland Europe/Warsaw; any other country stays on Asia/Dubai. A company whose settings are created later starts the same way. The panel and the read-only row both carry the sentence "Still on Dubai time for every company: the reminder for a hold's review date, the daily reminder for an enquiry with no next action, the dates of the Sales reports, and anything JARVIS saves or lists." The panel's example reads "a deadline saved as 10:00 Dubai reads 07:00 Warsaw in winter".
