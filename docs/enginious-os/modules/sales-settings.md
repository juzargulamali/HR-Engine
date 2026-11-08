# Sales: Settings (per company)

Status: written from the code at `main` `d4a9dc325dc669990e146ebb15eeb0cc3d2c11d4` (`../README.md` stamp row "Sales & CRM app map completed"). **Code read only; nothing was run.** Conventions as in `../README.md`; `Unverified` marks what code reading could not confirm. Route: `/sales/settings` (`apps/web/src/app/(app)/sales/settings/page.tsx`, `settings-form.tsx`, `quotation-defaults.tsx`). The VAT-choice control is also described, in the estimate context, in [`sales-estimates-and-quotations.md`](./sales-estimates-and-quotations.md) section 2.3; issuer branding is on Admin, Companies (same file, section 2.4). Catalogue entries: [`sales-action-catalogue.md`](./sales-action-catalogue.md).

## 1. Reaching the screen and who may change what

* Menu: Manage > Settings (and the phone tab strip) appears only for a person who holds the `manage_settings` capability for some company or is a Sales founder (`nav-groups.ts`, `sales/layout.tsx`: `hasCrmCapability(..., "manage_settings") || isAnyCrmFounder`). Typing the address without that still opens the page, but each company card is read-only ("You can read these settings but not change them").
* The page lists every company the person holds a Sales grant for, one settings card and one "Estimates" card each. A company with no settings row shows "Not set up yet" and a warning: "Enquiries cannot be recorded for a company until its reference code and default currency are set."
* Who may change: a company's card is editable for a Sales founder or the `manage_settings` capability for that company (`editable()` in `page.tsx`; database: `crm_upsert_settings` requires `crm_has_capability(company, 'manage_settings')`, `20261115000000_crm_access_audit_settings.sql`). **The approval policy is a separate right**: only `manage_approval_rules` (founder implies it) may change it; people without it see the policy as text and the form omits the field, so saving other settings leaves the stored policy untouched (`SettingsForm` `canEditApproval`; function: a non-null policy needs `manage_approval_rules`, else "Not allowed to change the commercial approval policy").
* Who may grant Sales access (a different screen): People & Access (`/people-access`), not this page; a line on this page links to it for holders of `manage_access`. Out of scope here (`../03-roles-access-and-approvals.md`).

## 2. Company settings form (`saveCrmSettings` -> `crm_upsert_settings`)

Catalogue: `sales.settings.save_company`. One form per company, one submit; the values are upserted into one row of `crm_company_settings` (`updated_by` is the person, the audit trigger logs it in the Sales audit trail). **Changing a setting affects only that company and takes effect on the next read; there is no preview or undo, and the old values are not kept except in the audit log.**

| Field | What it does and where it is used | Validation | Behind it |
|---|---|---|---|
| Reference code | 2 to 5 capital letters, **unique across companies**. Used in every new enquiry reference `OPP-<code>-<year>-<number>` (`crm_create_opportunity`) and estimate reference (`EST-<code>-...`, `crm_quote_create`). Changing it changes only references issued afterwards; existing references are not rewritten. The field hint on the page shows "for example UAE-2026-0042", which omits the real `OPP-` prefix (see section 6) | `/^[A-Z]{2,5}$/` (form and database check `crm_company_settings_code_format`); unique index `uq_crm_company_settings_code` | `settingsSchema` (`crm.ts`) |
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

1. The Reference code hint ("for example UAE-2026-0042") and the stored reference format differ: `crm_create_opportunity` builds `OPP-<code>-<year>-<4 digits>` (`format('OPP-%s-%s-%s', ...)`), so a real reference is `OPP-UAE-2026-0042`.
2. The settings page reads `companies.default_currency` without checking its error (`page.tsx`), so a failed read only means an empty prefill for a company without settings.
3. `crm_save_terms_template` and the terms table remain installed with no caller (kept deliberately per the Estimates reference).
