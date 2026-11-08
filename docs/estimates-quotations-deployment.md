# Estimates & Quotations (part 1): deployment

One migration, applied by the owner in the SQL Editor of the hosted project. Claude runs no hosted SQL. Additive and idempotent (safe to run twice). It needs the Clients & Agencies migration (`20261219000100`) first, because it replaces five of that migration's functions (same behaviour plus the two identifier columns). The same migration also carries what part 2 (PDF and Excel export) needs: the exports render `crm_quotation_snapshots.content`, whose pictures are pinned copies (private bucket `quotation-assets`); the migration is not applied anywhere yet, so it was corrected in place rather than adding a second one.

| Order | File | Kind |
|---|---|---|
| 1 | `supabase/manual-sql/crm_quotes_00_preflight_readonly.sql` | read-only: every section B row must say OK, the last one "not applied yet". Section C is information (companies without Sales settings cannot start an estimate; companies with no legal name cannot issue) |
| 2 | `supabase/manual-sql/crm_quotes_05_preservation_check_readonly.sql` | read-only: keep the result |
| 3 | `supabase/migrations/20261220000100_crm_estimates_quotations.sql` | the change (writes) |
| 4 | `supabase/manual-sql/crm_quotes_05_preservation_check_readonly.sql` again | read-only: identical to step 2 (the migration only adds; it changes no proposal, approval, file, organisation or company value) |
| 5 | `supabase/manual-sql/crm_quotes_20_verify_readonly.sql` | read-only: every row must say OK (RLS on, no write grants for signed-in users, functions present, guard triggers present, private logo and `quotation-assets` buckets, the approval functions and `crm_approvals.quote_content_hash`, every company has standard terms and VAT choices; one INFO row says whether the pinned-asset delete guard on `storage.objects` could be installed) |
| rollback | `supabase/manual-sql/crm_quotes_90_rollback.sql` | writes; refuses while any issued quotation exists; keeps the identifier and issuer columns and the replaced functions (see the header of the file) |

## What it adds, and why a new table is needed

The quotation is not a second record: **every quotation is a `crm_proposals` row** (its version number, its status `draft/sent/superseded/accepted`, its commercial approval and its recorded "sent" fact are the existing ones). A proposal row can hold only a note and a file, so it cannot hold a priced bill of quantities (sections, lines, currency, VAT, bill-to, milestones, terms). `crm_quotations` is therefore a 1:1 extension of the proposal row, with `crm_quotation_sections`, `crm_quotation_lines` and the frozen `crm_quotation_snapshots`.

* **Client identifiers**: `crm_organisations.vat_trn`, `trade_licence_no` (text, trimmed, leading zeros kept, at most 40 characters). Replaced functions: `crm_create_organisation_profile` (two trailing arguments, old signature dropped), `crm_update_organisation`, `crm_import_fingerprint`, `crm_import_apply_item` (fill-only for the two columns).
* **Issuer details**: `companies.trn`, `address`, `phone`, `email`, `website`, `logo_path` (the legal name already existed); private bucket `company-logos`; `crm_set_company_logo` (System Administrator only). Edited on Admin, Companies (existing `companies_write` policy: System Administrator).
* **Estimates**: tables above plus `crm_quote_counters` (reference `QUO-<company code>-<year>-<nnnn>`, same pattern as the enquiry counter), `crm_quote_vat_choices` (seeded per company: Out of scope, 0%, 5%, 15%, 23%; nothing is a default), `crm_quote_terms_templates` (seeded per company with the six working-draft clauses). Functions: `crm_quote_create`, `crm_quote_save_header`, `crm_quote_save_section`, `crm_quote_delete_section`, `crm_quote_save_line`, `crm_quote_delete_line`, `crm_quote_reorder`, `crm_quote_issue`, `crm_quote_create_revision`, `crm_save_vat_choice`, `crm_save_terms_template`, and `crm_remove_file` (one added refusal: a picture used by an issued quotation cannot be removed).

## Rules (all enforced in the database)

* Edit, create, reorder and issue: the enquiry owner or a Sales founder (`crm_require_owner_or_founder`, the existing proposal rule), company scoped. Others are refused by the functions; tables are SELECT-only for people with a grant for that company.
* Issue needs: issuer legal name, currency, VAT choice, bill-to organisation, at least one item and no empty section, a validity date not in the past if given, consistent milestones (percentages add to 100 or amounts to the total incl. VAT). A draft can be saved incomplete.
* Approval: the existing commercial approval, **bound to the exact version reviewed**. `crm_quote_content_hash` fingerprints everything client-facing (never internal notes, never the day). With the company policy `required`: `crm_quote_request_approval` records the hash (and withdraws a waiting request for an older version); a founder approves through `crm_quote_decide_approval`, which needs the hash the reviewer screen was rendered with, equal to the current one (otherwise: "This quotation changed after you opened it ..."); a trigger on `crm_approvals` refuses to approve a quotation approval any other way; `crm_quote_issue` needs an `approved` approval whose bound hash equals the current hash, so any edit after the request or the decision needs a fresh approval. `crm_request_approval` / `crm_decide_approval` are unchanged for every other proposal. `not_required` and `not_configured` do not gate issuing (they never gated proposals).
* Pinned pictures: at issue the server copies the company logo and each item picture to immutable, content-addressed objects owned by the revision (`quotation-assets/<proposal>/<logo|line-<id>>-<sha256>.<ext>`, made before `crm_quote_issue(p_proposal, p_assets)`); the function refuses an issue whose assets are not pinned and records only the pinned paths and hashes in the snapshot. A trigger on `storage.objects` (installed only where the migration role may add it; the verify pack reports which) refuses to rename or delete a pinned object while its revision exists; the bucket has no policy for signed-in roles. **Verified on an isolated local Supabase stack with real Storage; hosted V2 is not yet verified** (see "Local release check" below). Check on the hosted project after applying.
* Display numbers 1, 1.1, 1.2, 2.1 (`lineDisplayNumber` in `packages/domain`, mirrored by `crm_quote_build_content`) and a separate `crm_quotations.exclusions` list (empty by default; copied to revisions; its own block in the snapshot, before the terms).
* Freeze: issuing builds the client-facing snapshot inside the database. Guard triggers refuse any change to the snapshot (even by a table owner) and to the header, sections and lines of an issued quotation. A revision is a new draft (same reference, revision + 1); issuing it marks earlier draft or sent revisions `superseded` without altering them.
* Internal notes live only in `crm_quotations.internal_notes`; they are never copied to the snapshot. There is no costing, supplier price or margin anywhere.

Tests: `packages/rls-tests/test/crm-quotations.rls.test.ts` (also runs pack files 00, 05, 20 and refuses the rollback while issued quotations exist), `packages/domain/test/quotations.test.ts`, `apps/web/src/lib/crm/quotations/model.test.ts`, `apps/web/src/lib/actions/quotations.test.ts`. Control reference: `docs/enginious-os/modules/sales-estimates-and-quotations.md`.

## Local release check (isolated Supabase stack with real Storage)

Run on a throwaway local Supabase stack in Docker (its own project id, ports and fresh volumes, fictional data only, Storage enabled; the app, the SQL connection and the Storage endpoint were each confirmed to be loopback addresses of that stack before every major step). **Hosted V2 was not touched and is not yet verified.** Nothing was sent, deployed or merged.

| Item | Tested commit |
|---|---|
| Estimates & Quotations (this branch) | `f90c915` |
| Existing CRM compatibility (account creation, profile edit, Excel import, enquiry and proposal flow) | `2fef1f1` (`main` at that time). This is the commit that was built and tested; it is **not** asserted to be the commit Vercel Production is serving (Vercel Production status is unverified) |

Result:
* Baseline: all migrations up to `20261219000100` applied; then the owner pack for this migration: preflight all OK, migration applied, verify pack 61 rows all OK, preservation check identical before and after.
* The pinned-asset delete guard on `storage.objects` **was installed** (the migration role is not a superuser, as on hosted; the table is owned by the Storage service role).
* Current `main` code (`2fef1f1`) on the migrated database: account creation, profile edit, Excel import (preview, confirm, re-upload creates nothing), the enquiry page and the existing proposal flow all passed, so the migration is backward compatible with that code.
* This branch (`f90c915`): logo and item-photo upload to real Storage, quotation built, approval requested and given, issued; PDF and Excel downloaded through the buttons. The pinned copies in `quotation-assets` have SHA-256 values matching the snapshot and the source files. After the company logo was replaced, re-exporting the same revision still showed the **original logo and item photo** in both files. **Totals match** in the PDF, the Excel file and the snapshot (4,800.50, VAT 240.03, total 5,040.53). The internal-notes marker is absent from both files.
* **Deleting a pinned asset is refused**: service role single delete, bulk delete and move: HTTP 500 with database code 55000; a signed-in user's single delete: 400 AccessDenied; a signed-in user's bulk delete: 200 with an empty list (nothing deleted); a SQL delete or update: "A pinned quotation asset cannot be renamed or deleted". Both pinned objects stayed with their hashes intact.

Still needs hosted verification (owner, after applying the migration): who owns `storage.objects` on hosted V2 and that the verify pack's INFO row says the guard was installed; Supabase Auth and e-mail behaviour (the local check used admin-created users); the hosted Postgres major version (the local stack ran 17); the approval-policy screen in Sales settings (the policy was set by SQL locally, the screen was not exercised).

## Estimates-only change (branch `feat/estimates-only`)

**No migration is needed and no owner SQL pack changes.** The applied migration `20261220000100_crm_estimates_quotations.sql` is untouched; deploy the app only. What changed: the wording (Estimate everywhere), a simpler three-step builder, the mandatory budgetary notice in both files, no standard terms or acceptance wording in client files, larger aspect-preserving photos, a boxed totals block, and "record as sent" refused for estimate rows in the app. Existing `QUO-` quotations and their frozen snapshots are not rewritten and export exactly as issued (a snapshot without the server-written marker `estimate-format:1` is treated as historical). New estimates are still numbered `QUO-...`.

Evidence at `158740c`: unit and export tests including a pre-change frozen fixture, and a local-stack browser flow (`apps/web/os-shell-checks/quotations-flow.mjs`) proving that finalising writes no booking, reservation, follow-up, reminder or Zoho row and changes no status or stage. **Not verified:** any hosted behaviour of this change, Vercel, real object storage for this change. Optional later migrations (owner decision, not required): `EST-` reference prefix (`create or replace function crm_quote_create`), and a database-level refusal of `crm_set_proposal_status('sent')` for a version that has a `crm_quotations` row.

## Issuer branding in estimate exports (branch `feat/estimate-issuer-branding`)

**No migration is needed and no owner SQL pack changes.** The Admin → Companies "Issuer details" screen already holds every field (legal name, TRN, a multi-line address, phone, email, website, logo), and the frozen snapshot already froze all of them, with the logo pinned by path and SHA-256 (`crm_quote_build_content`, applied migration `20261220000100`). Deploy the app only. What changed:

* **Header (PDF page one):** the profile logo on the left; legal name, the address lines as stored and `TRN: <value>` (omitted when empty) right-aligned on the right, with the estimate title, reference, revision and dates under that block. A profile with no logo prints no logo (the bundled ENGINIOUS logo is not used for estimates).
* **Footer (every PDF page):** a thin rule, then the estimate reference on the left, one centred line `Sales enquiries: <phone> · <email> · <website>` and `Page x of y` at the far right. "Sales enquiries:" is a fixed label in code; a missing part and its separator are omitted, and the whole line is omitted when all three are missing. The website is a real link to the stored value normalised to an absolute https URL (`www.example.ae` and `https://www.example.ae` both link to `https://www.example.ae`). Any other scheme (javascript:, data:, file:, ftp: and so on), a `//host` value, spaces or credentials are printed as plain text and never linked.
* **Excel:** the same header lines at the top and the same sales line as the last visible row of the sheet (label, phone and email in one cell, the website beside it as a real hyperlink cell; one plain cell when the website is not linkable), and the same line in the print footer (centre; a print footer cannot hold a link; the reference is dropped before the sales line if the 255-character footer limit would be exceeded).
* **How old documents stay as they were:** the format marker. Estimates now carry `estimate-format:2` (set by the server when a draft is saved, sent for approval or finalised). A snapshot marked `estimate-format:1` (finalised by the Estimates-only release) and a snapshot with no marker (a quotation issued earlier) render exactly as before: the old header with the contact line, no sales footer line, no link, and no value is ever read from the live company profile for a finalised revision. Tests: `export/legacy-regression.test.tsx` (pre-change legacy fixture) and `export/issuer-branding.test.tsx` with the new pre-change fixture `export/__fixtures__/estimate-frozen-v1.json` (PDF text, page count, Excel cells, print footer, file names identical). A draft that carries the `estimate-format:1` marker is moved to `2` when it is next saved, sent for approval or finalised; if it was already approved, the approval is bound to the old version and has to be requested again (the same rule as any edit).
* **Freeze:** nothing new is stored. A finalised revision reads the issuer fields from its own snapshot; editing the company profile afterwards changes nothing in its PDF or Excel, and the next revision picks the new profile up. Drafts show the live profile and stay marked Draft.
* The Admin → Companies button and dialog are now called "Issuer details" (they still said quotation).

Evidence: unit and export tests (header, footer on every page, omissions, multi-line address, link annotation and Excel hyperlink, unsafe schemes, freeze after a profile edit, new revision, legacy and format-1 regressions), and the local-stack browser flow `apps/web/os-shell-checks/quotations-flow.mjs` (Admin → Companies edit, finalise, edit again, re-export unchanged, new revision changed). **Not verified:** any hosted behaviour, Vercel, and logo upload and pinning against real object storage for this change (the local stack has none; the logo path is covered by tests with a storage seam, and earlier hosted-style Storage evidence is in "Local release check" above).

### Issuer details to enter (owner, on hosted V2, after the app is deployed)

**Claude entered nothing on hosted V2, seeded nothing for any entity and added no migration or SQL that writes these values.** Until you enter them, the exports show only what the profile holds (finalising still needs a non-blank legal name, the existing rule). Sign in as a System Administrator, open **Admin → Companies**, find the row **Enginious LLC FZ** (the exact name in the Companies list) and press **Issuer details**. Type exactly:

| Form field | Value |
|---|---|
| Legal name | `Enginious LLC FZ` |
| Tax registration number (TRN) | `100613846300003` |
| Address (a multi-line box; Enter starts a new line, line breaks are kept) | two lines: `Business Center 1, The Meydan Hotel / Nad Al Sheba,` then `Dubai 00000, U.A.E.` |
| Phone | `+971 50 7247728` |
| Email | `sales@enginious.ae` |
| Website | `https://www.enginious.ae` |
| Logo | in the same dialog, the second form "Upload logo": choose the official Enginious logo file (PNG, JPEG or WebP, under 900 KB). No logo file is committed with this change. |

Press **Save details**, then upload the logo. A revision finalised afterwards freezes these values; revisions finalised before keep what they were finalised with.

Optional read-only check (a SELECT, no writes; run it in the SQL editor to see what the profile holds):

```sql
select legal_name, trn, address, phone, email, website, logo_path is not null as has_logo
from companies
where legal_name = 'Enginious LLC FZ';
```
